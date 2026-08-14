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

