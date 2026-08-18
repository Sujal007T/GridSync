import { create } from 'zustand';
import { CellValue } from '../crdt/CellValue';
import { merge } from '../crdt/CrdtMerger';
import { Op, stompClient } from '../api/stompClient';

export interface SheetState {
  sheetId: string | null;
  replicaId: string | null;
  cells: Record<string, CellValue>; // key is `${rowId}:${colId}`
  error: string | null;
  optimisticRollbacks: Record<string, { cellId: string, previousValue: CellValue | null }>;

  setSheetContext: (sheetId: string, replicaId: string) => void;
  setCellValueOptimistic: (opId: string, rowId: string, colId: string, newValue: CellValue, rawOp: Op) => void;
  applyRemoteOp: (op: Op) => void;
  handleOpError: (opId: string, errorMessage: string) => void;
}

export const useSheetStore = create<SheetState>((set, get) => ({
  sheetId: null,
  replicaId: null,
  cells: {},
  error: null,
  optimisticRollbacks: {},

  setSheetContext: (sheetId, replicaId) => set({ sheetId, replicaId }),

  setCellValueOptimistic: (opId, rowId, colId, newValue, rawOp) => {
    const cellId = `${rowId}:${colId}`;
    const previousValue = get().cells[cellId] || null;

    set((state) => ({
      cells: {
        ...state.cells,
        [cellId]: newValue
      },
      optimisticRollbacks: {
        ...state.optimisticRollbacks,
        [opId]: { cellId, previousValue }
      },
      error: null
    }));

    stompClient.sendOp(rawOp);
  },

  applyRemoteOp: (op: Op) => {
    const payload = JSON.parse(op.payload);
    const rowId = payload.rowId;
    const colId = payload.colId;
    const cellId = `${rowId}:${colId}`;

    const incomingCellValue: CellValue = {
      value: payload.value,
      hlc: op.hlc,
      replicaId: op.hlc.replicaId // From Java's HybridLogicalClock mapping
    };

    set((state) => {
      const existing = state.cells[cellId];
      const merged = existing ? merge(existing, incomingCellValue) : incomingCellValue;
      
      const newRollbacks = { ...state.optimisticRollbacks };
      if (newRollbacks[op.opId]) {
        delete newRollbacks[op.opId];
      }

      return {
        cells: {
          ...state.cells,
          [cellId]: merged
        },
        optimisticRollbacks: newRollbacks
      };
    });
  },

  handleOpError: (opId: string, errorMessage: string) => {
    set((state) => {
      const rollbackTarget = state.optimisticRollbacks[opId];
      if (!rollbackTarget) {
        console.warn(`Cannot rollback opId ${opId}, no rollback state found.`);
        return { error: errorMessage }; // Record the error but don't guess the rollback
      }

      const { cellId, previousValue } = rollbackTarget;
      const newCells = { ...state.cells };
      
      if (previousValue === null) {
        delete newCells[cellId];
      } else {
        newCells[cellId] = previousValue;
      }

      const newRollbacks = { ...state.optimisticRollbacks };
      delete newRollbacks[opId];

      return {
        cells: newCells,
        optimisticRollbacks: newRollbacks,
        error: errorMessage
      };
    });
  }
}));
