/**
 * offlineQueue.test.ts
 *
 * Tests the IndexedDB-backed pending-ops queue in isolation.
 * fake-indexeddb is injected globally via src/test-setup.ts (registered in vite.config.ts
 * setupFiles), so these tests work without a real browser.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueuePendingOp,
  getAllPendingOps,
  removePendingOp,
  clearPendingOps,
} from '../offlineQueue';
import type { Op } from '../stompClient';

function makeOp(opId: string, value = 'hello'): Op {
  return {
    sheetId: 'sheet-1',
    opId,
    opType: 'CELL_SET',
    payload: JSON.stringify({ rowId: 'r1', colId: 'c1', value }),
    hlc: { physicalTime: Date.now(), logicalCounter: 0, replicaId: 'replica-1' } as any,
  };
}

// Reset the DB between tests by clearing all entries
beforeEach(async () => {
  await clearPendingOps();
});

describe('offlineQueue', () => {
  it('enqueue → getAll returns the op', async () => {
    const op = makeOp('op-1');
    await enqueuePendingOp(op);

    const all = await getAllPendingOps();
    expect(all).toHaveLength(1);
    expect(all[0].opId).toBe('op-1');
  });

  it('enqueue same opId twice is idempotent (put semantics)', async () => {
    const op = makeOp('op-dup', 'first');
    const opUpdated = makeOp('op-dup', 'second');

    await enqueuePendingOp(op);
    await enqueuePendingOp(opUpdated);

    const all = await getAllPendingOps();
    expect(all).toHaveLength(1);
    // The second put should overwrite
    expect(JSON.parse(all[0].payload).value).toBe('second');
  });

  it('remove → getAll no longer contains the removed op', async () => {
    await enqueuePendingOp(makeOp('op-a'));
    await enqueuePendingOp(makeOp('op-b'));
    await removePendingOp('op-a');

    const all = await getAllPendingOps();
    expect(all).toHaveLength(1);
    expect(all[0].opId).toBe('op-b');
  });

  it('clear → getAll returns empty', async () => {
    await enqueuePendingOp(makeOp('op-x'));
    await enqueuePendingOp(makeOp('op-y'));
    await clearPendingOps();

    const all = await getAllPendingOps();
    expect(all).toHaveLength(0);
  });

  it('remove a non-existent opId is a no-op (no throw)', async () => {
    await expect(removePendingOp('does-not-exist')).resolves.toBeUndefined();
  });
});
