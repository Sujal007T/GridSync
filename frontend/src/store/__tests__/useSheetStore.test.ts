import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSheetStore } from '../useSheetStore';
import { HybridLogicalClock } from '../../crdt/HybridLogicalClock';
import { v4 as uuidv4 } from 'uuid';
import { stompClient, type Op } from '../../api/stompClient';

// Mock stompClient
vi.mock('../../api/stompClient', () => ({
  stompClient: {
    sendOp: vi.fn(),
  },
}));

describe('useSheetStore', () => {
  beforeEach(() => {
    useSheetStore.setState({
      sheetId: null,
      replicaId: null,
      cells: {},
      error: null,
      optimisticRollbacks: {},
    });
    vi.clearAllMocks();
  });

  it('applies optimistic update immediately', () => {
    const sheetId = uuidv4();
    const replicaId = uuidv4();
    useSheetStore.getState().setSheetContext(sheetId, replicaId);

    const opId = uuidv4();
    const hlc = HybridLogicalClock.now(replicaId);
    
    const newValue = { value: 'test', hlc, replicaId };
    const rawOp: Op = {
      sheetId,
      opId,
      opType: 'CELL_SET',
      payload: JSON.stringify({ rowId: 'r1', colId: 'c1', value: 'test' }),
      hlc
    };

    useSheetStore.getState().setCellValueOptimistic(opId, 'r1', 'c1', newValue, rawOp);

    const state = useSheetStore.getState();
    expect(state.cells['r1:c1']).toEqual(newValue);
    expect(state.optimisticRollbacks[opId]).toBeDefined();
    expect(stompClient.sendOp).toHaveBeenCalledWith(rawOp);
  });

  it('optimistic update loses to remote concurrent edit', () => {
    const sheetId = uuidv4();
    const replicaA = uuidv4();
    const replicaB = uuidv4(); // Remote
    useSheetStore.getState().setSheetContext(sheetId, replicaA);

    // 1. Optimistic apply (Time 100)
    const opIdLocal = uuidv4();
    const hlcLocal = new HybridLogicalClock(100, 0, replicaA);
    const valLocal = { value: 'local', hlc: hlcLocal, replicaId: replicaA };
    const rawOpLocal: Op = {
      sheetId, opId: opIdLocal, opType: 'CELL_SET', hlc: hlcLocal,
      payload: JSON.stringify({ rowId: 'r1', colId: 'c1', value: 'local' })
    };
    useSheetStore.getState().setCellValueOptimistic(opIdLocal, 'r1', 'c1', valLocal, rawOpLocal);

    // 2. Receive remote op with winning timestamp (Time 200)
    const opIdRemote = uuidv4();
    const hlcRemote = new HybridLogicalClock(200, 0, replicaB);
    const rawOpRemote: Op = {
      sheetId, opId: opIdRemote, opType: 'CELL_SET', hlc: hlcRemote,
      payload: JSON.stringify({ rowId: 'r1', colId: 'c1', value: 'remote' })
    };
    useSheetStore.getState().applyRemoteOp(rawOpRemote);

    // Store updates to remote
    const state = useSheetStore.getState();
    expect(state.cells['r1:c1'].value).toBe('remote');
    expect(state.cells['r1:c1'].hlc.physicalTime).toBe(200);
  });

  it('concurrent error rollback properly isolates to specific opId', () => {
    const sheetId = uuidv4();
    const replicaA = uuidv4();
    useSheetStore.getState().setSheetContext(sheetId, replicaA);

    // Op 1 on cell 1
    const opId1 = uuidv4();
    const val1 = { value: 'cell1-val', hlc: new HybridLogicalClock(100, 0, replicaA), replicaId: replicaA };
    useSheetStore.getState().setCellValueOptimistic(opId1, 'r1', 'c1', val1, {} as Op);

    // Op 2 on cell 2
    const opId2 = uuidv4();
    const val2 = { value: 'cell2-val', hlc: new HybridLogicalClock(105, 0, replicaA), replicaId: replicaA };
    useSheetStore.getState().setCellValueOptimistic(opId2, 'r2', 'c2', val2, {} as Op);

    // State has both
    let state = useSheetStore.getState();
    expect(state.cells['r1:c1'].value).toBe('cell1-val');
    expect(state.cells['r2:c2'].value).toBe('cell2-val');

    // Reject Op 2 ONLY
    useSheetStore.getState().handleOpError(opId2, "Rejected size");

    state = useSheetStore.getState();
    // Op 2 rolled back (was null before)
    expect(state.cells['r2:c2']).toBeUndefined();
    // Op 1 remains untouched
    expect(state.cells['r1:c1'].value).toBe('cell1-val');
    expect(state.error).toBe("Rejected size");
    
    // Warn log for missing opId (won't crash or guess)
    const consoleSpy = vi.spyOn(console, 'warn');
    useSheetStore.getState().handleOpError('missing-opId', "Unknown error");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('missing-opId'));
    consoleSpy.mockRestore();
  });

  it('seedGrid generates monotonically increasing PositionKeys', () => {
    useSheetStore.getState().seedGrid(10, 5);
    const { rows, cols } = useSheetStore.getState();
    
    expect(rows.length).toBe(10);
    expect(cols.length).toBe(5);

    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].key < rows[i].key).toBe(true);
    }
    
    for (let i = 1; i < cols.length; i++) {
      expect(cols[i - 1].key < cols[i].key).toBe(true);
    }
  });
});
