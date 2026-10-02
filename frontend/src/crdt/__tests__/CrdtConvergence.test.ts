/**
 * CrdtConvergence.test.ts — Suite 1: Frontend Property-Based Convergence
 *
 * SCOPE: CELL_SET ops ONLY.
 * Row/column structural ops (ROW_INSERT, ROW_DELETE, COL_INSERT, COL_DELETE) are NOT
 * covered here because structural ops are not yet persisted in op_log or grid_state
 * (documented limitation in Phases 6 and 8). Any attempt to test structural op
 * convergence through the real backend would fail against the schema.
 *
 * What this proves:
 *   For any sequence of CELL_SET ops applied to a fixed set of cells, CrdtMerger.merge()
 *   is COMMUTATIVE and ASSOCIATIVE regardless of application order. Specifically:
 *   - Replica A applies ops in original order.
 *   - Replica B applies the same ops in a deterministically shuffled order (seeded).
 *   Both replicas must produce byte-identical final state.
 *
 * Runs automatically in CI via the existing GitHub Actions npm test job.
 * Uses seeded deterministic PRNG (mulberry32) — no Math.random() — so any CI failure
 * is reproducible by re-running with the same seed value logged in the test name.
 */

import { describe, it, expect } from 'vitest';
import { merge } from '../CrdtMerger';
import type { CellValue } from '../CellValue';
import { HybridLogicalClock } from '../HybridLogicalClock';

// --- Seeded PRNG (mulberry32) ---
// Returns a PRNG function seeded with `seed`. Each call returns a float in [0, 1).
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Deterministic seeded shuffle (Fisher-Yates) ---
function shuffleSeeded<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface CellOp {
  cellId: string;
  value: CellValue;
}

// Generates count CELL_SET ops across cellIds with randomised HLC values.
// HLCs are constructed directly — no side effects on HybridLogicalClock.now static state.
function generateOps(cellIds: string[], count: number, rand: () => number): CellOp[] {
  const replicas = [
    'aaaaaaaa-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000002',
    'aaaaaaaa-0000-0000-0000-000000000003',
  ];
  const ops: CellOp[] = [];
  for (let i = 0; i < count; i++) {
    const cellId = cellIds[Math.floor(rand() * cellIds.length)];
    const replicaId = replicas[Math.floor(rand() * replicas.length)];
    // physicalTime in [1000, 1200] — small window forces many logical-counter conflicts
    const physicalTime = 1000 + Math.floor(rand() * 200);
    const logicalCounter = Math.floor(rand() * 5);
    const value = `val-${i}-${Math.floor(rand() * 1000)}`;
    ops.push({
      cellId,
      value: {
        value,
        hlc: new HybridLogicalClock(physicalTime, logicalCounter, replicaId),
        replicaId,
      },
    });
  }
  return ops;
}

function applyOps(ops: CellOp[]): Record<string, CellValue> {
  const cells: Record<string, CellValue> = {};
  for (const op of ops) {
    const existing = cells[op.cellId];
    cells[op.cellId] = existing ? merge(existing, op.value) : op.value;
  }
  return cells;
}

// Stable serialiser: key-order independent
function serializeState(cells: Record<string, CellValue>): string {
  return Object.keys(cells).sort().map(k => {
    const v = cells[k];
    return `${k}=${v.value}@${v.hlc.physicalTime}.${v.hlc.logicalCounter}.${v.hlc.replicaId}`;
  }).join('|');
}

// 5 fixed cell IDs, consistent across all seeds
const CELL_IDS = [
  'row-1:col-1',
  'row-1:col-2',
  'row-2:col-1',
  'row-2:col-2',
  'row-3:col-1',
];

describe('CrdtConvergence — CELL_SET commutativity/associativity (Suite 1)', () => {
  // 20 distinct seeds. If CI fails at seed S, re-run with that seed to reproduce.
  const SEEDS = [1, 7, 13, 42, 99, 137, 256, 512, 1000, 1337,
                 2048, 3141, 5000, 7777, 9999, 11111, 22222, 31415, 65537, 99991];
  const OPS_PER_SEED = 50; // 50 ops across 5 cells => dense conflicts

  for (const seed of SEEDS) {
    it(`converges for seed=${seed} (${OPS_PER_SEED} ops, ${CELL_IDS.length} cells)`, () => {
      const rand = mulberry32(seed);
      const ops = generateOps(CELL_IDS, OPS_PER_SEED, rand);

      // Replica A: original order
      const stateA = applyOps(ops);

      // Replica B: deterministically shuffled (XOR'd seed => distinct shuffle per seed)
      const shuffleRand = mulberry32(seed ^ 0xDEADBEEF);
      const shuffledOps = shuffleSeeded(ops, shuffleRand);
      const stateB = applyOps(shuffledOps);

      expect(serializeState(stateA)).toBe(serializeState(stateB));
    });
  }

  it('merge is commutative for a single pair', () => {
    const replicaA = 'aaaaaaaa-0000-0000-0000-000000000001';
    const replicaB = 'bbbbbbbb-0000-0000-0000-000000000002';
    const valA: CellValue = { value: 'A', hlc: new HybridLogicalClock(100, 0, replicaA), replicaId: replicaA };
    const valB: CellValue = { value: 'B', hlc: new HybridLogicalClock(100, 0, replicaA), replicaId: replicaB };
    expect(merge(valA, valB)).toEqual(merge(valB, valA));
  });

  it('merge is idempotent — applying same op twice yields same result', () => {
    const replicaA = 'aaaaaaaa-0000-0000-0000-000000000001';
    const val: CellValue = { value: 'X', hlc: new HybridLogicalClock(200, 0, replicaA), replicaId: replicaA };
    const once = applyOps([{ cellId: 'r1:c1', value: val }]);
    const twice = applyOps([{ cellId: 'r1:c1', value: val }, { cellId: 'r1:c1', value: val }]);
    expect(serializeState(once)).toBe(serializeState(twice));
  });
});
