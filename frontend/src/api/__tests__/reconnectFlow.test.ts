/**
 * reconnectFlow.test.ts
 *
 * Tests the convergence guarantee and lost-ack idempotency for the reconnect replay flow.
 *
 * Key invariant being verified:
 *   The final cell state after applying ops in a scrambled order must equal the state
 *   produced by applying them in the correct seq order — because CrdtMerger.merge() is
 *   commutative, associative, and idempotent.
 *
 * Two test scenarios:
 * 1. Convergence under scrambled order: client has 2 local pending ops + 2 missed remote ops.
 *    Apply all 4 in a deliberately wrong order, assert final state = correct online state.
 *
 * 2. Lost-ack idempotency: op was sent and applied by the server, but the broadcast
 *    confirmation was lost. Client resends same opId. Applying the same op twice must
 *    produce the same final state as applying it once.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useSheetStore } from '../../store/useSheetStore';
import type { Op } from '../stompClient';
import type { OpLogDto } from '../stompClient';
import { clearPendingOps } from '../offlineQueue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SHEET_ID = 'test-sheet';
const ROW_A = 'row-a';
const ROW_B = 'row-b';
const COL_1 = 'col-1';

function makeHlc(physicalTime: number, logicalCounter = 0, replicaId = 'replica-x') {
  return { physicalTime, logicalCounter, replicaId } as any;
}

function makeOp(opId: string, rowId: string, value: string, physicalTime: number, replicaId = 'replica-x'): Op {
  return {
    sheetId: SHEET_ID,
    opId,
    opType: 'CELL_SET',
    payload: JSON.stringify({ rowId, colId: COL_1, value }),
    hlc: makeHlc(physicalTime, 0, replicaId),
  };
}

function makeDto(opId: string, seq: number, rowId: string, value: string, physicalTime: number): OpLogDto {
  return {
    seq,
    opId,
    opType: 'CELL_SET',
    payload: JSON.stringify({ rowId, colId: COL_1, value }),
    hlcPhysical: physicalTime,
    hlcLogical: 0,
    replicaId: 'replica-server',
  };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(async () => {
  // Reset store and IndexedDB between tests
  await clearPendingOps();
  useSheetStore.setState({
    sheetId: SHEET_ID,
    replicaId: 'replica-x',
    rows: [
      { id: ROW_A, key: 'a' },
      { id: ROW_B, key: 'b' },
    ],
    cols: [{ id: COL_1, key: 'c' }],
    cells: {},
    optimisticRollbacks: {},
    error: null,
    focusedCellId: null,
    draftEdits: {},
    lastSeenSeq: 0,
  });
});

// ─── Test 1: Convergence under scrambled application order ────────────────────

describe('reconnect convergence', () => {
  it('applies ops in scrambled order and converges to the same state as sequential order', () => {
    // Scenario:
    //   op-local-A1: client edits Row A cell, value="local-a", t=100 (client replica)
    //   op-local-A2: client edits Row A cell, value="local-a2", t=200 (client replica, wins over A1)
    //   op-server-B1: remote op edits Row B cell, value="remote-b1", t=150 (server replica)
    //   op-server-B2: remote op edits Row B cell, value="remote-b2", t=300 (server replica, wins over B1)
    //
    // Correct final state (by HLC ordering):
    //   Row A: "local-a2"  (t=200 > t=100)
    //   Row B: "remote-b2" (t=300 > t=150)

    const opA1 = makeOp('op-a1', ROW_A, 'local-a', 100, 'replica-client');
    const opA2 = makeOp('op-a2', ROW_A, 'local-a2', 200, 'replica-client');
    const opB1 = makeOp('op-b1', ROW_B, 'remote-b1', 150, 'replica-server');
    const opB2 = makeOp('op-b2', ROW_B, 'remote-b2', 300, 'replica-server');

    // Build "ground truth" by applying in correct temporal order
    const { applyRemoteOp: apply } = useSheetStore.getState();
    apply(opA1); apply(opB1); apply(opA2); apply(opB2);
    const groundTruth = { ...useSheetStore.getState().cells };

    // Reset cells and apply in a deliberately scrambled order
    useSheetStore.setState({ cells: {}, optimisticRollbacks: {} });
    const { applyRemoteOp: apply2 } = useSheetStore.getState();
    // Scrambled: B2, A1, B1, A2
    apply2(opB2); apply2(opA1); apply2(opB1); apply2(opA2);
    const scrambledResult = { ...useSheetStore.getState().cells };

    // Both should converge to the same final values
    expect(scrambledResult[`${ROW_A}:${COL_1}`]?.value).toBe('local-a2');
    expect(scrambledResult[`${ROW_B}:${COL_1}`]?.value).toBe('remote-b2');
    expect(scrambledResult[`${ROW_A}:${COL_1}`]?.value).toBe(groundTruth[`${ROW_A}:${COL_1}`]?.value);
    expect(scrambledResult[`${ROW_B}:${COL_1}`]?.value).toBe(groundTruth[`${ROW_B}:${COL_1}`]?.value);
  });

  it('applyCatchUpOps from OpLogDto converges with directly applied Ops', () => {
    // Simulates the reconnect scenario: server provides missed ops as OpLogDto[] from the
    // REST catch-up endpoint. applyCatchUpOps converts them to Op and routes through
    // the same CrdtMerger path — result must equal direct Op application.

    const dtoB1 = makeDto('op-b1', 10, ROW_B, 'remote-b1', 150);
    const dtoB2 = makeDto('op-b2', 11, ROW_B, 'remote-b2', 300);

    // Ground truth via direct Op apply
    const opB1 = makeOp('op-b1', ROW_B, 'remote-b1', 150, 'replica-server');
    const opB2 = makeOp('op-b2', ROW_B, 'remote-b2', 300, 'replica-server');
    useSheetStore.getState().applyRemoteOp(opB1);
    useSheetStore.getState().applyRemoteOp(opB2);
    const direct = useSheetStore.getState().cells[`${ROW_B}:${COL_1}`]?.value;

    // Reset and apply via catch-up path
    useSheetStore.setState({ cells: {}, lastSeenSeq: 0 });
    useSheetStore.getState().applyCatchUpOps([dtoB2, dtoB1]); // deliberately reversed

    const catchUp = useSheetStore.getState().cells[`${ROW_B}:${COL_1}`]?.value;
    expect(catchUp).toBe(direct);
    expect(catchUp).toBe('remote-b2');

    // lastSeenSeq should be updated to the max seq in the batch
    expect(useSheetStore.getState().lastSeenSeq).toBe(11);
  });
});

// ─── Test 2: Lost-ack idempotency ────────────────────────────────────────────

describe('lost-ack idempotency', () => {
  it('applying the same opId twice produces the same state as applying it once', () => {
    // Simulates: op was applied server-side, but the STOMP broadcast was lost.
    // Client resends on reconnect. The server's ON CONFLICT DO NOTHING means the
    // op is not re-applied server-side. But client-side, applyRemoteOp is called
    // twice (once from the catch-up endpoint, once from the echoed resend).
    // The merge function's idempotency ensures the result is stable.

    const op = makeOp('op-idempotent', ROW_A, 'value-v1', 500);

    const { applyRemoteOp } = useSheetStore.getState();

    // First application
    applyRemoteOp(op);
    const afterFirst = useSheetStore.getState().cells[`${ROW_A}:${COL_1}`]?.value;
    expect(afterFirst).toBe('value-v1');

    // Second application of identical op (lost-ack resend scenario)
    applyRemoteOp(op);
    const afterSecond = useSheetStore.getState().cells[`${ROW_A}:${COL_1}`]?.value;

    // Final state must be identical — no divergence from double-apply
    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond).toBe('value-v1');
  });

  it('later op beats earlier op regardless of application order (LWW merge rule)', () => {
    // Confirms the merge tiebreak: if the same cell receives two ops, the higher HLC wins.
    const older = makeOp('op-old', ROW_A, 'old-value', 100);
    const newer = makeOp('op-new', ROW_A, 'new-value', 999);

    const { applyRemoteOp } = useSheetStore.getState();

    // Apply newer first, then older — older must NOT overwrite newer
    applyRemoteOp(newer);
    applyRemoteOp(older);

    expect(useSheetStore.getState().cells[`${ROW_A}:${COL_1}`]?.value).toBe('new-value');
  });
});
