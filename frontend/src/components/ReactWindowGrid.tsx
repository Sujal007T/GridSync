import React, { useEffect, useMemo, useRef, memo } from 'react';
import { useSheetStore } from '../store/useSheetStore';
import { Cell } from './Cell';
import { FixedSizeGrid } from 'react-window';

const ROW_HEIGHT = 25;
const COL_WIDTH = 100;

interface ItemData {
  rows: { id: string; positionKey: string }[];
  cols: { id: string; positionKey: string }[];
}

// Extracted and memoized OUTSIDE the parent component so it holds a stable reference across renders.
// Without this, an inline arrow function passed as `children` to FixedSizeGrid creates a new
// function object on every parent render, defeating react-window's internal React.memo on cells.
// This was the root cause of ReactWindowGrid being slower than HandRolledGrid in the first perf run.
const CellRenderer = memo(({ columnIndex, rowIndex, style, data }: {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  data: ItemData;
}) => {
  const row = data.rows[rowIndex];
  const col = data.cols[columnIndex];
  return (
    <Cell
      rowId={row.id}
      colId={col.id}
      style={style}
    />
  );
});

export const ReactWindowGrid: React.FC = () => {
  const rows = useSheetStore(state => state.rows);
  const cols = useSheetStore(state => state.cols);
  const focusedCellId = useSheetStore(state => state.focusedCellId);

  const gridRef = useRef<FixedSizeGrid>(null);

  // Memoize itemData so CellRenderer's data prop has a stable reference and doesn't
  // cause a re-render of every visible cell when an unrelated state change triggers a parent re-render.
  const itemData = useMemo<ItemData>(() => ({ rows, cols }), [rows, cols]);

  // Scroll to follow focus mechanism
  useEffect(() => {
    if (!focusedCellId || !gridRef.current) return;

    const [rowId, colId] = focusedCellId.split(':');
    const rIndex = rows.findIndex(r => r.id === rowId);
    const cIndex = cols.findIndex(c => c.id === colId);

    if (rIndex !== -1 && cIndex !== -1) {
      gridRef.current.scrollToItem({
        align: 'auto',
        rowIndex: rIndex,
        columnIndex: cIndex
      });
    }
  }, [focusedCellId, rows, cols]);

  if (rows.length === 0 || cols.length === 0) return null;

  return (
    <FixedSizeGrid
      ref={gridRef}
      columnCount={cols.length}
      columnWidth={COL_WIDTH}
      rowCount={rows.length}
      rowHeight={ROW_HEIGHT}
      width={800}
      height={600}
      overscanRowCount={5}
      overscanColumnCount={5}
      itemData={itemData}
    >
      {CellRenderer}
    </FixedSizeGrid>
  );
};
