import React, { useEffect, useRef } from 'react';
import { useSheetStore } from '../store/useSheetStore';
import type { Op } from '../api/stompClient';
import { HybridLogicalClock } from '../crdt/HybridLogicalClock';
import { v4 as uuidv4 } from 'uuid';

interface CellProps {
  rowId: string;
  colId: string;
  style?: React.CSSProperties;
}

export const Cell: React.FC<CellProps> = ({ rowId, colId, style }) => {
  const cellId = `${rowId}:${colId}`;
  
  const cellValue = useSheetStore(state => state.cells[cellId]);
  const draftEdit = useSheetStore(state => state.draftEdits[cellId]);
  const focusedCellId = useSheetStore(state => state.focusedCellId);
  const isFocused = focusedCellId === cellId;
  // Optional: check if this specific cell has a rollback waiting (optimistic)
  const isOptimistic = useSheetStore(state => 
    Object.values(state.optimisticRollbacks).some(r => r.cellId === cellId)
  );

  const { setFocusedCell, setDraftEdit, cancelEdit, commitEdit } = useSheetStore.getState();
  
  const isEditing = draftEdit !== undefined;
  
  const cellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore focus if this cell is currently the focused one in the store
  useEffect(() => {
    if (isFocused) {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
      } else if (cellRef.current) {
        cellRef.current.focus();
      }
    }
  }, [isFocused, isEditing]);

  const handleDoubleClick = () => {
    if (!isEditing) {
      setDraftEdit(cellId, cellValue?.value || "");
      setFocusedCell(cellId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isEditing) {
      if (e.key === 'Enter') {
        const rawOp: Op = {
          sheetId: useSheetStore.getState().sheetId || uuidv4(),
          opId: uuidv4(),
          opType: 'CELL_SET',
          payload: JSON.stringify({ rowId, colId, value: draftEdit }),
          hlc: HybridLogicalClock.now(useSheetStore.getState().replicaId || uuidv4())
        };
        commitEdit(cellId, rawOp);
        
        // Move focus down after enter (optional, typical spreadsheet behavior)
        moveFocus(1, 0);
      } else if (e.key === 'Escape') {
        cancelEdit(cellId);
        cellRef.current?.focus();
      }
      return;
    }

    if (e.key === 'Enter') {
      setDraftEdit(cellId, cellValue?.value || "");
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      moveFocus(-1, 0);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      moveFocus(1, 0);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      moveFocus(0, -1);
      e.preventDefault();
    } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
      moveFocus(0, 1);
      e.preventDefault();
    }
  };

  const moveFocus = (rowDelta: number, colDelta: number) => {
    const { rows, cols } = useSheetStore.getState();
    const rIndex = rows.findIndex(r => r.id === rowId);
    const cIndex = cols.findIndex(c => c.id === colId);
    
    if (rIndex === -1 || cIndex === -1) return;

    let nextRIndex = rIndex + rowDelta;
    let nextCIndex = cIndex + colDelta;
    
    // clamp
    nextRIndex = Math.max(0, Math.min(rows.length - 1, nextRIndex));
    nextCIndex = Math.max(0, Math.min(cols.length - 1, nextCIndex));

    const targetCellId = `${rows[nextRIndex].id}:${cols[nextCIndex].id}`;
    setFocusedCell(targetCellId);
  };

  return (
    <div
      ref={cellRef}
      tabIndex={isFocused ? 0 : -1}
      data-cell-id={cellId}
      onClick={() => setFocusedCell(cellId)}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      style={{
        ...style,
        border: '1px solid #ddd',
        boxSizing: 'border-box',
        padding: '2px',
        backgroundColor: isOptimistic ? '#ffffe0' : '#fff',
        outline: isFocused && !isEditing ? '2px solid #1a73e8' : 'none',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis'
      }}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={draftEdit}
          onChange={(e) => setDraftEdit(cellId, e.target.value)}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            outline: 'none',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
            fontSize: 'inherit'
          }}
          onBlur={() => {
            // Note: Don't cancel edit on blur automatically, because scrolling unmounts and causes blur.
            // Wait, if we blur by clicking somewhere else, we might want to commit, but for virtualization,
            // we let the user explicitly press Enter or Escape. Or we can check if it's unmounting.
          }}
        />
      ) : (
        <span>{cellValue?.value || ""}</span>
      )}
    </div>
  );
};
