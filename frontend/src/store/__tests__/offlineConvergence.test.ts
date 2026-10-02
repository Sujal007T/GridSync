/**
 * offlineConvergence.test.ts — Suite 2: Offline-Reconnect Convergence
 *
 * SCOPE: CELL_SET ops ONLY.
 * Structural ops (ROW_INSERT, ROW_DELETE, COL_INSERT, COL_DELETE) are NOT tested here
 * because they are not persisted in op_log or grid_state (documented limitation,
 * Phases 6 and 8). This limitation is intentional and must not be silently bypassed.
 *
 * What this proves:
 *   A replica that goes offline partway through a sequence of ops, accumulates local
 *   pending ops, then reconnects and applies catch-up ops via the same CrdtMerger.merge()
 *   path used by stompClient.ts CONVERGES to the same final state as a replica that
 *   was online the entire time.
 *
 *   The partition point (which ops were missed) is varied across multiple seeded runs
 *   to confirm convergence holds regardless of WHERE in the sequence the offline window
 *   fell. Any CI failure is reproducible from its seed value.
 *
 * Runs automatically in CI via the existing GitHub Actions npm test job.
 * Uses mulberry32 seeded PRNG — no Math.random().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CellValue } from '../../crdt/CellValue';
import { HybridLogicalClock } from '../../crdt/HybridLogicalClock';
import { merge } from '../../crdt/CrdtMerger';
import type { Op, OpLogDto } from '../../api/stompClient';

// Mock out stompClient and offlineQueue so store tests don't touch real I/O
vi.mock('../../api/stompClient', () => ({
  stompClient: { sendOp: vi.fn(), updateLastSeenSeq: vi.fn() },
}));
vi.mock('../../api/offlineQueue', () => ({
  enqueuePendingOp: vi.fn().mockResolvedValue(undefined),
  removePendingOp: vi.fn().mockResolvedValue(undefined),
  getAllPendingOps: vi.fn().mockResolvedValue([]),
}));

// Lazy import the store AFTER mocks are registered
import { useSheetStore } from '../useSheetStore';

// --- Seeded PRNG (mulberry32) ---
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 5 fixed cell IDs
const CELL_IDS = [
  'row-1:col-1',
  'row-1:col-2',
  'row-2:col-1',
  'row-2:col-2',
  'row-3:col-1',
];

const REPLICAS = [
  'aaaaaaaa-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000002',
];

// Build a test Op for a CELL_SET
function makeOp(seq: number, cellId: string, value: string, replicaId: string, rand: () => number): {
  op: Op;
  dto: OpLogDto;
  cellId: string;
} {
  const [rowId, colId] = cellId.split(':');
  const physicalTime = 1000 + Math.floor(rand() * 300);
  const logicalCounter = Math.floor(rand() * 5);
  const hlc = new HybridLogicalClock(physicalTime, logicalCounter, replicaId);
  const opId = `op-${seq}-${replicaId.slice(0, 8)}`;
  const payload = JSON.stringify({ rowId, colId, value });

  const op: Op = {
    sheetId: '00000000-0000-0000-0000-000000000001',
    opId,
    opType: 'CELL_SET',
    payload,
    hlc,
  };

  const dto: OpLogDto = {
    seq,
    opId,
    opType: 'CELL_SET',
    payload,
    hlcPhysical: physicalTime,
    hlcLogical: logicalCounter,
    replicaId,
  };

  return { op, dto, cellId };
}

// Apply a list of Ops directly through the store's applyRemoteOp (same path as stompClient)
function applyOpsToStore(ops: Op[]): void {
  for (const op of ops) {
    useSheetStore.getState().applyRemoteOp(op);
  }
}

// Read current cell state from the store
function readState(): Record<string, CellValue> {
  return { ...useSheetStore.getState().cells };
}

// Stable serialiser: key-order independent
function serializeState(cells: Record<string, CellValue>): string {
  return Object.keys(cells).sort().map(k => {
    const v = cells[k];
    return `${k}=${v.value}@${v.hlc.physicalTime}.${v.hlc.logicalCounter}.${v.hlc.replicaId}`;
  }).join('|');
}

// Reset store before each test
beforeEach(() => {
  useSheetStore.setState({
    sheetId: '00000000-0000-0000-0000-000000000001',
    replicaId: REPLICAS[0],
    cells: {},
    error: null,
    optimisticRollbacks: {},
    lastSeenSeq: 0,
  });
  vi.clearAllMocks();
});

describe('offlineConvergence — offline-reconnect catch-up (Suite 2)', () => {
  /**
   * For each seed:
   *   1. Generate N total ops (remote from both replicas).
   *   2. The "always-online" replica (stateOnline) applies ALL ops via applyRemoteOp.
   *   3. The "offline" replica goes offline at a seeded partition point P:
   *      - Applies ops [0..P) normally (was online).
   *      - Accumulates ops [P..N) as "local pending" ops (offline edits for different cells).
   *      - On reconnect: applies catch-up ops [P..N) via applyCatchUpOps, then re-sends
   *        pending local ops via applyRemoteOp (idempotent — already applied locally).
   *   4. Assert final states are identical.
   */
  const SEEDS = [2, 11, 23, 55, 101, 200, 314, 888, 1024, 2000,
                 4096, 5555, 8192, 10000, 12345, 20000, 33333, 50000, 77777, 99999];
  const TOTAL_OPS = 40;

  for (const seed of SEEDS) {
    it(`offline replica converges for seed=${seed} (${TOTAL_OPS} ops, partition varies)`, () => {
      const rand = mulberry32(seed);

      // Generate all ops upfront
      const allOps: Array<{ op: Op; dto: OpLogDto; cellId: string }> = [];
      for (let i = 0; i < TOTAL_OPS; i++) {
        const cellId = CELL_IDS[Math.floor(rand() * CELL_IDS.length)];
        const replicaId = REPLICAS[Math.floor(rand() * REPLICAS.length)];
        const value = `v${i}-${Math.floor(rand() * 999)}`;
        allOps.push(makeOp(i, cellId, value, replicaId, rand));
      }

      // Partition point: somewhere between 10% and 70% into the sequence
      const partitionIdx = Math.floor(10 + rand() * (TOTAL_OPS * 0.6));

      // -- Online replica: applies ALL ops ----------------------------------
      useSheetStore.setState({ cells: {} });
      applyOpsToStore(allOps.map(x => x.op));
      const stateOnline = readState();

      // -- Offline replica simulation ----------------------------------------
      useSheetStore.setState({ cells: {} });

      // Phase 1: online, processes [0..partitionIdx)
      applyOpsToStore(allOps.slice(0, partitionIdx).map(x => x.op));

      // Phase 2: "offline" — the replica accumulates local pending ops for
      // new cells not yet seen. We simulate this by generating fresh edits
      // for the SAME cells (creating conflicts) that it applies locally only.
      const localPendingOps: Op[] = [];
      for (let i = 0; i < 5; i++) {
        const cellId = CELL_IDS[Math.floor(rand() * CELL_IDS.length)];
        const replicaId = REPLICAS[0]; // local replica
        const value = `local-${i}-${Math.floor(rand() * 999)}`;
        const { op } = makeOp(1000 + i, cellId, value, replicaId, rand);
        localPendingOps.push(op);
        // Apply locally (optimistic, as if enqueued in IndexedDB)
        useSheetStore.getState().applyRemoteOp(op);
      }

      // Phase 3: reconnect — apply catch-up ops [partitionIdx..TOTAL_OPS) via applyCatchUpOps
      const catchUpDtos = allOps.slice(partitionIdx).map(x => x.dto);
      useSheetStore.getState().applyCatchUpOps(catchUpDtos);

      // Phase 4: replay local pending ops via applyRemoteOp (idempotent re-apply)
      // This mirrors stompClient._replayPendingOps() -> sendOp -> server echoes back
      applyOpsToStore(localPendingOps);

      // The online replica also needs to know about the local pending ops
      // (they would have been broadcast via Redis after reconnect)
      useSheetStore.setState({ cells: stateOnline });
      applyOpsToStore(localPendingOps);
      const stateOnlineFinal = readState();

      // Reset to offline replica's final state
      useSheetStore.setState({ cells: {} });
      useSheetStore.setState({ cells: {}, optimisticRollbacks: {}, error: null });

      // Re-simulate offline replica from scratch to get clean final state
      applyOpsToStore(allOps.slice(0, partitionIdx).map(x => x.op));
      applyOpsToStore(localPendingOps); // local optimistic
      useSheetStore.getState().applyCatchUpOps(catchUpDtos);
      applyOpsToStore(localPendingOps); // idempotent replay
      const stateOfflineFinal = readState();

      expect(serializeState(stateOfflineFinal)).toBe(serializeState(stateOnlineFinal));
    });
  }

  it('catch-up applies in correct CRDT merge order regardless of dto seq ordering', () => {
    // Deliberately out-of-order DTOs — applyCatchUpOps must converge regardless
    const rand = mulberry32(42);
    const ops = [
      makeOp(3, 'row-1:col-1', 'late', REPLICAS[0], rand),
      makeOp(1, 'row-1:col-1', 'early', REPLICAS[1], rand),
      makeOp(2, 'row-1:col-1', 'middle', REPLICAS[0], rand),
    ];

    // Online: apply in seq order
    useSheetStore.setState({ cells: {} });
    applyOpsToStore([ops[1].op, ops[2].op, ops[0].op]); // sorted by seq
    const onlineState = readState();

    // Catch-up: apply as DTOs in reversed seq order
    useSheetStore.setState({ cells: {} });
    useSheetStore.getState().applyCatchUpOps([ops[0].dto, ops[2].dto, ops[1].dto]);
    const catchUpState = readState();

    expect(serializeState(onlineState)).toBe(serializeState(catchUpState));
  });

  it('idempotent re-apply of same opId does not corrupt state', () => {
    const rand = mulberry32(7);
    const { op } = makeOp(1, 'row-1:col-1', 'hello', REPLICAS[0], rand);

    useSheetStore.setState({ cells: {} });
    useSheetStore.getState().applyRemoteOp(op);
    const afterOnce = readState();

    // Apply the exact same op again — must not change state
    useSheetStore.getState().applyRemoteOp(op);
    const afterTwice = readState();

    expect(serializeState(afterOnce)).toBe(serializeState(afterTwice));
  });
});
