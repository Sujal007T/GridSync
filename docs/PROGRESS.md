# Progress Log

## Scaffolding (2026-08-12)

- Set up a monorepo structure with `/backend` and `/frontend`.
- **Backend**: Spring Boot, Java 21, Gradle.
  - Dependencies: `web`, `data-jpa`, `postgresql`, `flyway`, `websocket`, `data-redis`, `testcontainers`.
  - Configured Flyway for schema migrations. Disabled Hibernate `ddl-auto` (`validate` mode).
  - Created an empty baseline migration `V1__baseline.sql`.
  - Configured Testcontainers for integration tests (will use real Postgres and Redis).
- **Database/Infra**: Added a `docker-compose.yml` at root running Postgres 16 and Redis 7.
- **Frontend**: Scaffolded React + TypeScript using Vite.
  - Added `.env.example` for environment configurations (API and WebSocket URLs).
  - Configured Vitest for unit testing.
- **CI/CD**: Added a GitHub Actions workflow `.github/workflows/ci.yml` that runs `./gradlew test` and `npm test` on every push.

## Phase 1: Core CRDT (2026-08-13)
- Implemented HybridLogicalClock, CellValue, and CrdtMerger.
- HybridLogicalClock.now() handles system clock jumping backward (NTP correction) by preserving the last known physical time and incrementing the logical counter to guarantee monotonicity.
- Implemented pure CrdtMerger.merge() function that evaluates only the provided CellValues.
- Documented decision: merge() explicitly omits incoming physical time validation against server time. Time validation is a separate concern (Phase 4 WebSocket boundary) that will REJECT ops with excessive future skew, rather than silently clamping/rewriting timestamps, to prevent local client state from diverging from server state.


## Phase 2: Fractional Indexing (2026-08-14)
- Implemented PositionKey as a base-62 fractional-indexing generator.
- Added exact string midpoint logic (midpoint(left, right)) to keep keys optimally short.
- Implemented generate(left, right) which calculates the midpoint and appends a single random base-62 character to function as a collision tiebreaker for concurrent inserts, eliminating the need for central coordination.
- Wrote pathological tests (1,000 sequential inserts at start, end, and middle) to assert that key length grows reasonably (under 300 chars) and never triggers exhaustion/crashes, preventing slow-render bugs in production.


## Phase 3: Persistence and Idempotency (2026-08-15)
- Added Flyway migration \V2__persistence.sql\ for \op_log\, \grid_state\, and \snapshots\ schemas.
- Added a \UNIQUE\ constraint on \(sheet_id, op_id)\ to \op_log\ strictly scoped to the sheet.
- Added a \CREATE INDEX\ on \op_log(sheet_id, seq)\ to optimize subsequent reconnect-catch-up queries.
- Created JPA entities and repositories: \OpLogRepository\ and \GridStateRepository\.
- Implemented \SheetService.applyOpTransactional(...)\ marked with \@Transactional\ to atomically insert into \op_log\ and upsert into \grid_state\ via \CrdtMerger.merge()\ in one transaction.
- Verified via a Testcontainers integration test that inserting the same \Op\ twice with the same \op_id\ is intercepted by an idempotency check as a clean no-op, preventing double-merges or duplicate row bugs.


## Spring Boot Version Note
- The project is currently pinned to Spring Boot 4.1.0 in \uild.gradle\. Although Phase 0 originally scoped Spring Boot 3.x, the Initializr zip pulled down 4.1.0. This has been confirmed and explicitly kept as the deliberate working version moving forward unless instructed otherwise.


## Concurrency Bug Fixes (Pre-Phase 4)
- **Bug 1 (Lost Update on \grid_state\)**: Two concurrent transactions updating the same cell could both read the same base state, resulting in a silent overwrite of the merged result. Fixed by switching the \indById\ lookup in \pplyOpTransactional\ to a pessimistic lock (\@Lock(LockModeType.PESSIMISTIC_WRITE)\) via \GridStateRepository.findWithLockBySheetIdAndRowIdAndColId\. A concurrent threaded test confirms that both ops are properly sequenced and merged into the final state.
- **Bug 2 (Idempotency Race)**: Two concurrent identical ops could both pass the initial \existsBySheetIdAndOpId\ check before either committed, leading to an uncaught \DataIntegrityViolationException\ breaking the second application instead of gracefully resolving as a no-op. Fixed by wrapping the \opLogRepository.saveAndFlush\ in a specific try/catch block and annotating the method with \@Transactional(noRollbackFor = DataIntegrityViolationException.class)\ to prevent Spring from throwing an \UnexpectedRollbackException\ to the caller. A concurrent test validates that submitting the same \op_id\ exactly simultaneously resolves cleanly.


## Phase 3: Idempotency Fix (2026-08-15)
- **Why the try/catch approach failed**: Catching \DataIntegrityViolationException\ in Java successfully hid the exception from the caller, but failed to address the fact that PostgreSQL immediately aborts the current transaction when the unique constraint is violated. Even with Spring's \
oRollbackFor\, any subsequent commands sent to Postgres on that connection (including the final \COMMIT\) would fail with 'current transaction is aborted'.
- **The Native Query Fix**: Replaced the entire exists-check + insert + try/catch with a single atomic native SQL query using \INSERT ... ON CONFLICT DO NOTHING\. This correctly handles concurrency inside the database engine without poisoning the active connection/transaction.
- **First-Insert Races**: Documented that the pessimistic write lock on \grid_state\ currently does not handle the edge case of two concurrent transactions attempting the *first-ever* insert for a specific cell, because \indWithLock\ returns empty for both and neither can lock a non-existent row, leading to a primary key collision on insert. Handling this generically within JPA is tricky, so it is left explicitly unhandled for now until row/col creation is serialized or a secondary fallback strategy is needed.


- **GridState First-Insert Race Resolved**: Handled the edge case where two concurrent transactions attempt to insert the first-ever edit for a new cell. Instead of attempting a pessimistic lock (which fails because the row doesn't exist) and racing on the insert, we now execute a blind \INSERT INTO grid_state ... ON CONFLICT DO NOTHING\ with the raw incoming \CellValue\. If it returns 1, we won the race and we're done. If it returns 0, the row already exists (either from a prior op or a concurrent thread that just won the race), so we fall through to the pessimistic lock + \CrdtMerger.merge()\ path. This brilliantly ensures \CrdtMerger\ logic remains entirely in Java and is never duplicated into complex SQL.


## Phase 4: Single Node STOMP & Auth (2026-08-15)
- Implemented JWT auth on STOMP CONNECT frame via JwtAuthInterceptor.
- Added WebSocketMessageBroker config enabling /topic and /queue brokers, setting message size limits to 64KB, and configuring SockJS fallback.
- **Authorization & Error Delivery**: Intercepted STOMP SEND and SUBSCRIBE commands on `clientInboundChannel` via `SheetAccessInterceptor` to enforce real-time sheet-level authorization. This error delivery deliberately does NOT rely on `StompSubProtocolErrorHandler` or `@MessageExceptionHandler` (which cannot catch `ChannelInterceptor.preSend()` exceptions). Instead, we manually inject `@Lazy SimpMessagingTemplate` to call `convertAndSendToUser(...)` targeting `/queue/errors` BEFORE throwing the exception. This ensures the error is strictly scoped to the offending principal's session via Spring's `UserDestinationMessageHandler`.
- **HLC Validation Isolation**: Implemented `HlcValidator` to reject ops with HLC physical time exceeding a 5-minute future skew to protect CRDT convergence. The isolation guarantee is proven by `HlcValidatorTest`, a standalone unit test with zero dependency or reference to `CrdtMerger`. The merge path is architecturally incapable of being reached from a rejected op.
- **Payload Validation Integrity**: Implemented strict payload validation (`@Size(max=2000)`) via a manual `Validator` bean in `SheetWebSocketController.receiveOp()`. A test-integrity proof was performed: the manual wiring was commented out and `testPayloadSizeLimit_ValidationWorks` explicitly failed with `AssertionFailedError: Should receive an error frame`, proving Spring STOMP silently swallows `@Size` without manual invocation. The wiring was restored and the test passed, confirming it actively protects the endpoint.
- **Verification Run Results**: The Phase 4 verification run successfully executed all 24 tests (`BUILD SUCCESSFUL`), including the Phase 3 concurrency regression tests (`testApplyOpConcurrentLostUpdate`, `testApplyOpConcurrentIdempotency`, `testApplyOpConcurrentFirstInsertRace`), which all passed. The test classes executed were: `BackendApplicationTests`, `CrdtMergerTest`, `HlcValidatorTest`, `HybridLogicalClockTest`, `PositionKeyTest`, `SheetServiceTest`, and `WebSocketIntegrationTest`.

## Pre-Phase 5: Error Correlation Fix (2026-08-17)
- **Standardized Error Payload**: Standardized the STOMP error payload shape to `{ "error": string, "opId": string }` across all three rejection paths.
  - *SheetAccessInterceptor*: Added JSON parsing to `preSend()` to extract the `opId` from the STOMP frame body before throwing.
  - *HlcValidator & Manual Validator*: Introduced a custom `OpRejectedException` to carry the `opId` to the `@MessageExceptionHandler`.
- **Why order-based fallback was rejected**: We explicitly decided against rolling back "the last pending op" on the frontend if `opId` is missing. Multiple ops can be in-flight concurrently across different cells (or rapid edits to the same cell), making order-based guessing inherently race-prone and liable to roll back the wrong cell's state. Correlation strictly by `opId` is mandatory.

## Phase 5: Client-Side CRDT & STOMP Wiring (2026-08-17)
- **TypeScript CRDT Port**: Ported `HybridLogicalClock`, `CellValue`, and `CrdtMerger` from Java 1:1, including the full verification suite testing monotonicity, identical HLC tiebreaking, and normal ordering.
- **STOMP Client Service**: Added `@stomp/stompjs` and `sockjs-client`. Wired up `stompClient.ts` to connect to the backend (with JWT `connectHeaders`), subscribe to the sheet's broadcast topic, and listen on `/user/queue/errors` for op rejections.
- **Zustand Optimistic Store**: Scaffolded `useSheetStore.ts` to manage the local `cells` map. Implemented `setCellValueOptimistic` which applies the edit locally, stores the old value in a rollback map keyed by `opId`, and sends the op. Implemented `applyRemoteOp` to merge incoming remote changes using `CrdtMerger`.
- **Concurrent Error Rollback Test**: Wrote a dedicated Zustand test (`useSheetStore.test.ts`) that submits two optimistic edits for two different cells in quick succession. The backend rejects the second op. The store perfectly rolls back the second cell without touching the optimistic (and perfectly valid) state of the first cell, proving the `opId` correlation prevents state corruption.
