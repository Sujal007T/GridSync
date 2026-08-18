import { create } from 'zustand';
import type { CellValue } from '../crdt/CellValue';
import { merge } from '../crdt/CrdtMerger';
import type { Op } from '../api/stompClient';
import { stompClient } from '../api/stompClient';
import { PositionKey } from '../crdt/PositionKey';
import { v4 as uuidv4 } from 'uuid';

export interface RowCol {
  id: string; // UUID
  key: string; // PositionKey
}

export interface SheetState {
  sheetId: string | null;
  replicaId: string | null;
  
  rows: RowCol[];
  cols: RowCol[];
  cells: Record<string, CellValue>; // key is `${rowId}:${colId}`
  
  error: string | null;
  optimisticRollbacks: Record<string, { cellId: string, previousValue: CellValue | null }>;
  
  // UI State for Virtualization Survival
  focusedCellId: string | null;
  draftEdits: Record<string, string>; // cellId -> string (in-progress edit)

  setSheetContext: (sheetId: string, replicaId: string) => void;
  seedGrid: (numRows: number, numCols: number) => void;
  
  setFocusedCell: (cellId: string | null) => void;
  setDraftEdit: (cellId: string, value: string) => void;
  cancelEdit: (cellId: string) => void;
  commitEdit: (cellId: string, rawOp: Op) => void;
  
  setCellValueOptimistic: (opId: string, rowId: string, colId: string, newValue: CellValue, rawOp: Op) => void;
  applyRemoteOp: (op: Op) => void;
  handleOpError: (opId: string, errorMessage: string) => void;
}

export const useSheetStore = create<SheetState>((set, get) => ({
  sheetId: null,
  replicaId: null,
  rows: [],
  cols: [],
  cells: {},
  error: null,
  optimisticRollbacks: {},
  
  focusedCellId: null,
  draftEdits: {},

  setSheetContext: (sheetId, replicaId) => set({ sheetId, replicaId }),

  seedGrid: (numRows, numCols) => {
    // Gate to DEV only
    if (!import.meta.env.DEV) {
      console.error("seedGrid is a dev-only tool and cannot be run in production.");
      return;
    }
    
    // Generate Rows
    let lastRowKey = "";
    const newRows: RowCol[] = [];
    for (let i = 0; i < numRows; i++) {
      lastRowKey = PositionKey.generate(lastRowKey, "");
      newRows.push({ id: uuidv4(), key: lastRowKey });
    }
    
    // Generate Cols
    let lastColKey = "";
    const newCols: RowCol[] = [];
    for (let i = 0; i < numCols; i++) {
      lastColKey = PositionKey.generate(lastColKey, "");
      newCols.push({ id: uuidv4(), key: lastColKey });
    }

    set({ rows: newRows, cols: newCols, cells: {} });
  },

  setFocusedCell: (cellId) => set({ focusedCellId: cellId }),
  
  setDraftEdit: (cellId, value) => set((state) => ({
    draftEdits: { ...state.draftEdits, [cellId]: value }
  })),

  cancelEdit: (cellId) => set((state) => {
    const newDrafts = { ...state.draftEdits };
    delete newDrafts[cellId];
    return { draftEdits: newDrafts };
  }),

  commitEdit: (cellId, rawOp) => {
    const state = get();
    const newValueStr = state.draftEdits[cellId];
    if (newValueStr === undefined) return;
    
    const [rowId, colId] = cellId.split(':');
    const newValue: CellValue = {
      value: newValueStr,
      hlc: rawOp.hlc,
      replicaId: rawOp.hlc.replicaId
    };

    // Apply optimistically
    get().setCellValueOptimistic(rawOp.opId, rowId, colId, newValue, rawOp);

    // Clear draft edit
    get().cancelEdit(cellId);
  },

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
