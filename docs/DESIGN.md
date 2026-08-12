# GridSync — Real-Time Collaborative Spreadsheet Engine

**Positioning for resume/interviews:** A fullstack CRDT-based collaborative spreadsheet — the same
class of problem as Google Sheets' live editing — built without any pre-built CRDT/OT library, with
horizontally scalable WebSocket fan-out and a frontend that runs real conflict-resolution logic, not
just a REST client.

This project directly closes the fullstack gap left by Notifly and JournalApp (both backend-only) by
forcing genuine frontend engineering: client-side CRDT merge, optimistic UI, virtualized rendering.

---

## 1. Architecture Overview

```
┌─────────────┐  WebSocket (STOMP)   ┌──────────────────┐   Redis Pub/Sub   ┌──────────────────┐
│  Client A   │◄────────────────────►│ Spring Boot Node 1│◄──────────────────►│ Spring Boot Node 2│
│ (React/TS)  │                      └──────────────────┘                    └──────────────────┘
│ Local CRDT  │                               │                                        │
│ + IndexedDB │                               ▼                                        ▼
└─────────────┘                      ┌────────────────────────────────────────────────┐
                                      │              PostgreSQL                        │
                                      │  op_log (source of truth) + grid_state (cache) │
                                      └────────────────────────────────────────────────┘
```

Key idea: the server is **not the authority on merge logic** — it's a relay and persistence layer.
Every client (and the server, for replay/history) runs the *same* deterministic merge function. That's
what makes it a CRDT system instead of a "central lock" system. This is the single most important
concept to be able to explain in an interview: convergence doesn't depend on a coordinator, it depends
on the merge function being commutative, associative, and idempotent.

---

## 2. Data Model

### Row and Column identity (fractional indexing)
Each row/column gets an immutable `PositionKey` — a base-62 string, not an integer index.

- Insert between key `"a0"` and `"a1"` → generate `"a0V"` (midpoint string). No existing row/column
  is renumbered.
- Two clients inserting at the same spot concurrently → append a random tiebreak char to the generated
  key, then sort lexicographically. Deterministic, no coordination needed.
- **Why this matters in interviews:** explains you understand why array-index-based ordering breaks
  under concurrency — a classic "sounds obviously fine until you think about it" bug.

```java
record RowId(String positionKey, UUID id) {}
record ColumnId(String positionKey, UUID id) {}
record CellId(UUID rowId, UUID colId) {}
```

### Cell value (LWW-Register)
```java
record CellValue(
    String value,
    HybridLogicalClock hlc,   // (physicalTime, logicalCounter, replicaId)
    UUID replicaId
) {}
```

Merge rule (this IS the CRDT — write this function once, use it everywhere: server, client, replay):
```java
CellValue merge(CellValue a, CellValue b) {
    int cmp = a.hlc().compareTo(b.hlc());
    if (cmp != 0) return cmp > 0 ? a : b;
    // tie on identical HLC: replicaId as deterministic tiebreak
    return a.replicaId().compareTo(b.replicaId()) > 0 ? a : b;
}
```

**Why HLC and not wall-clock timestamp:** wall clocks drift across machines and can go backward
(NTP correction). HLC combines physical time with a logical counter so causally-related events are
always ordered correctly even if physical clocks disagree — this is a real production technique
(used in CockroachDB, MongoDB). Worth a full Obsidian note on its own; flag it as a system-design
topic, not just implementation detail.

### Postgres tables
```sql
-- append-only source of truth
CREATE TABLE op_log (
    seq         BIGSERIAL PRIMARY KEY,
    sheet_id    UUID NOT NULL,
    op_type     TEXT NOT NULL,   -- CELL_SET, ROW_INSERT, ROW_DELETE, COL_INSERT, COL_DELETE
    payload     JSONB NOT NULL,
    hlc_physical BIGINT NOT NULL,
    hlc_logical  INT NOT NULL,
    replica_id  UUID NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- materialized current state, rebuilt from op_log, used for fast page load
CREATE TABLE grid_state (
    sheet_id UUID,
    row_id   UUID,
    col_id   UUID,
    value    TEXT,
    hlc_physical BIGINT,
    hlc_logical  INT,
    replica_id   UUID,
    PRIMARY KEY (sheet_id, row_id, col_id)
);

-- periodic snapshot so history/revert doesn't replay from seq 0 every time
CREATE TABLE snapshots (
    sheet_id UUID,
    seq      BIGINT,
    state    JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

This op-log + materialized-view split is the same event-sourcing shape you used in Notifly — reuse
the pattern, apply it to a new domain. Consistency of engineering principles across projects is a
good thing to reuse; the CRDT merge logic is what's actually new.

---

## 3. Backend Plan (Spring Boot)

**Stack:** Java 21, Spring Boot 3.x, Spring WebSocket (STOMP over SockJS), Spring Data JPA, Postgres,
Redis (pub/sub, not caching this time).

### Package structure
```
com.gridsync
├── crdt/
│   ├── HybridLogicalClock.java
│   ├── CellValue.java
│   ├── PositionKey.java          // fractional indexing generator
│   └── CrdtMerger.java           // the single merge function, used everywhere
├── ws/
│   ├── SheetWebSocketConfig.java // STOMP config
│   ├── SheetController.java      // @MessageMapping handlers
│   └── RedisRelay.java           // pub/sub fan-out across nodes
├── persistence/
│   ├── OpLogRepository.java
│   ├── GridStateRepository.java
│   └── SnapshotService.java      // periodic snapshot + replay-from-snapshot
├── history/
│   └── ReplayService.java        // rebuild state at any point in time
└── sheet/
    ├── SheetService.java         // apply op, merge, persist, broadcast
    └── SheetController.java      // REST: create sheet, load initial state, list history
```

### The horizontal scaling piece (the actual differentiator)
Problem: WebSocket sessions are stateful and pinned to whichever server node the client connected to.
If Client A is on Node 1 and Client B is on Node 2, a naive broadcast only reaches clients on the same
node.

Fix: every node publishes accepted ops to a Redis channel (`sheet:{sheetId}`). Every node subscribes
to that channel and pushes to its *locally connected* WebSocket sessions for that sheet. This is a
standard pattern for scaling real-time systems horizontally — same conceptual shape as how Slack/
Discord fan out messages across gateway nodes. Being able to explain this in an interview (with a
diagram) is worth more than most of the CRDT theory, because it's a systems problem, not an algorithm
problem.

```java
// on receiving an op from a client
CellValue merged = crdtMerger.merge(existing, incoming);
gridStateRepository.save(merged);
opLogRepository.append(op);
redisTemplate.convertAndSend("sheet:" + sheetId, op);  // fan out to ALL nodes

// each node's Redis listener
@Override
public void onMessage(Message message, byte[] pattern) {
    Op op = deserialize(message);
    messagingTemplate.convertAndSend("/topic/sheet/" + op.sheetId(), op); // to local WS clients
}
```

### Offline reconnect handling
Client tracks the last `seq` it has seen. On reconnect, it sends `lastSeenSeq`; server responds with
`op_log WHERE seq > lastSeenSeq AND sheet_id = ?`, client replays them through the same merge function
it already has. No special-casing needed — reconnect is just "catch up the op log," because the merge
function is idempotent and order-independent by construction.

### History / revert
`ReplayService` finds the nearest snapshot before the target time, then replays `op_log` forward from
there. `SnapshotService` runs periodically (e.g. every 500 ops) to keep replay bounded — this avoids
replaying the entire history from op #1 on every history request, same idea as event-sourcing snapshotting.

---

## 4. Frontend Plan (React + TypeScript)

**Stack:** React + TypeScript, stomp.js (WebSocket client), idb (IndexedDB wrapper for offline queue),
Zustand for state (skip Redux — unnecessary ceremony for this scope).

### Why the frontend has to run real logic, not just render JSON
The entire point of fixing the fullstack gap is that this app is *broken* if the frontend is dumb.
A cell edit must appear instantly for the user who typed it (optimistic update) before the server even
responds — waiting for a round-trip on every keystroke is unusable. That means the exact same
`CrdtMerger.merge()` logic has to exist in TypeScript too, applied locally the instant a remote op
arrives, and reconciled if the optimistic local guess turns out to lose the merge.

```typescript
// crdt/merge.ts — ported 1:1 from the Java version, same tiebreak rules
export function merge(a: CellValue, b: CellValue): CellValue {
  const cmp = compareHlc(a.hlc, b.hlc);
  if (cmp !== 0) return cmp > 0 ? a : b;
  return a.replicaId > b.replicaId ? a : b;
}
```

### Grid rendering — virtualization
Rendering 10,000 cells as real DOM nodes will visibly lag. Build a windowed grid: only render the
rows/columns currently in the viewport (plus a small buffer), recycle DOM nodes on scroll. This is a
legitimate frontend performance topic — worth being able to explain the "why" (DOM node count vs.
data size, reflow cost) in an interview, not just that you used a library.

- Roll your own basic windowing first (learn the mechanics), then you can mention `react-window` as
  what you'd swap to for a battle-tested version in production — shows you understand the tradeoff
  of build-vs-use, not just that you copied a library.

### Offline queue
```typescript
// on local edit while offline
await db.put('pendingOps', op);
applyLocally(op); // optimistic

// on reconnect
const pending = await db.getAll('pendingOps');
pending.forEach(op => ws.send(op));
await db.clear('pendingOps');
```

### Component shape
```
<SheetPage>
  <PresenceBar />          // who's online, live cursor colors (stretch goal, cheap, high visual payoff)
  <VirtualizedGrid>
    <Cell />                // optimistic local state + merge on remote update
  </VirtualizedGrid>
  <HistoryPanel />          // scrub to any past point, calls /sheets/{id}/history?at=timestamp
</SheetPage>
```

Presence is worth doing — it's a *separate*, ephemeral, non-persisted pub/sub channel
(`presence:{sheetId}`, ttl-based, not going through op_log), and having both a durable CRDT channel and
an ephemeral presence channel in the same system is a nice thing to point at when asked "how would
this scale / what else did you consider."

---

## 5. Convergence Proof (requirement 6 — the formal test)

```java
@Test
void convergesRegardlessOfApplicationOrder() {
    List<Op> ops = generateRandomOps(200, seed = 42);
    GridState replicaA = new GridState();
    GridState replicaB = new GridState();

    applyInOrder(replicaA, ops);
    applyInOrder(replicaB, shuffle(ops, seed = 99));

    assertEquals(replicaA.serialize(), replicaB.serialize());
}
```

Run this with multiple random seeds (property-based style, or just a loop of 50 random shuffles) —
that's what makes it "prove convergence formally" rather than "test one example." This single test
is one of the strongest resume bullets in the whole project because it's concrete, verifiable, and
exactly what a backend/distributed-systems interviewer wants to hear you say you did.

---

## 6. Build Order (phased, so it stays functional at every step)

1. **HLC + LWW-Register + merge function**, pure unit tests, no networking yet. Prove correctness
   in isolation first — this is the algorithmic core, get it right before touching infra.
2. **Fractional indexing for rows/columns**, unit tested independently.
3. **Single-node WebSocket broadcast**, Postgres persistence, no Redis yet. Get one working
   collaborative grid between two browser tabs.
4. **Frontend: virtualized grid + optimistic local apply + remote merge.** This is the biggest
   single chunk of new work relative to your existing projects — budget the most time here.
5. **Offline queue + reconnect replay.**
6. **History/snapshot/revert.**
7. **Redis pub/sub multi-node scaling** — do this last, once single-node correctness is proven, so
   you're not debugging distributed fan-out and merge logic at the same time.
8. **Convergence test suite** — technically can be written from step 1 onward and extended as more
   op types are added; don't leave it for the very end.
9. **Stretch: presence indicators.**

Given your current crunch (JournalApp EC2 deployment + resume finalization + interview prep active),
this is realistically a **post-application-cycle build** — but having this plan locked now means you
can start step 1 in short focused sessions without re-deriving the design each time.

---

## 7. Draft Resume Bullets (fill in real numbers once built)

- Built a real-time collaborative spreadsheet engine implementing a custom CRDT (LWW-Register +
  Hybrid Logical Clock) from first principles — no external CRDT/OT library — supporting concurrent
  multi-user editing with guaranteed convergence, verified via randomized order-independence testing
  across [N] simulated operations.
- Designed fractional-indexing-based row/column ordering to support concurrent structural edits
  (insert/delete) without renumbering or index collisions, avoiding O(n) broadcast on every insert.
- Scaled WebSocket-based real-time sync horizontally across multiple Spring Boot nodes using Redis
  Pub/Sub fan-out, decoupling client-session locality from broadcast delivery.
- Built a TypeScript/React frontend running the same CRDT merge logic client-side for optimistic
  updates, with a virtualized grid renderer handling [N]-cell sheets and an IndexedDB-backed offline
  edit queue with reconnect replay.
