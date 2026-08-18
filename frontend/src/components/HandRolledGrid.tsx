import React, { useEffect, useRef, useState } from 'react';
import { useSheetStore } from '../store/useSheetStore';
import { Cell } from './Cell';

const ROW_HEIGHT = 25;
const COL_WIDTH = 100;
const OVERSCAN = 5;

export const HandRolledGrid: React.FC = () => {
  const rows = useSheetStore(state => state.rows);
  const cols = useSheetStore(state => state.cols);
  const focusedCellId = useSheetStore(state => state.focusedCellId);

  const containerRef = useRef<HTMLDivElement>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  
  const [viewportWidth, setViewportWidth] = useState(800);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    if (containerRef.current) {
      setViewportWidth(containerRef.current.clientWidth);
      setViewportHeight(containerRef.current.clientHeight);
    }
  }, []);

  // Scroll to follow focus mechanism
  useEffect(() => {
    if (!focusedCellId || !containerRef.current) return;
    
    const [rowId, colId] = focusedCellId.split(':');
    const rIndex = rows.findIndex(r => r.id === rowId);
    const cIndex = cols.findIndex(c => c.id === colId);
    
    if (rIndex === -1 || cIndex === -1) return;

    const targetTop = rIndex * ROW_HEIGHT;
    const targetBottom = targetTop + ROW_HEIGHT;
    const targetLeft = cIndex * COL_WIDTH;
    const targetRight = targetLeft + COL_WIDTH;

    let newScrollTop = containerRef.current.scrollTop;
    let newScrollLeft = containerRef.current.scrollLeft;

    if (targetTop < containerRef.current.scrollTop) {
      newScrollTop = targetTop;
    } else if (targetBottom > containerRef.current.scrollTop + containerRef.current.clientHeight) {
      newScrollTop = targetBottom - containerRef.current.clientHeight;
    }

    if (targetLeft < containerRef.current.scrollLeft) {
      newScrollLeft = targetLeft;
    } else if (targetRight > containerRef.current.scrollLeft + containerRef.current.clientWidth) {
      newScrollLeft = targetRight - containerRef.current.clientWidth;
    }

    if (newScrollTop !== containerRef.current.scrollTop || newScrollLeft !== containerRef.current.scrollLeft) {
      containerRef.current.scrollTop = newScrollTop;
      containerRef.current.scrollLeft = newScrollLeft;
      // Also update React state immediately so the new window renders before the browser paints,
      // which allows the newly mounted Cell to grab focus in its useEffect.
      setScrollTop(newScrollTop);
      setScrollLeft(newScrollLeft);
    }
  }, [focusedCellId, rows, cols]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    setScrollLeft(e.currentTarget.scrollLeft);
  };

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(rows.length - 1, Math.floor((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  
  const startCol = Math.max(0, Math.floor(scrollLeft / COL_WIDTH) - OVERSCAN);
  const endCol = Math.min(cols.length - 1, Math.floor((scrollLeft + viewportWidth) / COL_WIDTH) + OVERSCAN);

  const visibleCells = [];
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const row = rows[r];
      const col = cols[c];
      visibleCells.push(
        <Cell
          key={`${row.id}:${col.id}`}
          rowId={row.id}
          colId={col.id}
          style={{
            position: 'absolute',
            top: r * ROW_HEIGHT,
            left: c * COL_WIDTH,
            width: COL_WIDTH,
            height: ROW_HEIGHT
          }}
        />
      );
    }
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        position: 'relative'
      }}
    >
      <div
        style={{
          width: cols.length * COL_WIDTH,
          height: rows.length * ROW_HEIGHT,
          position: 'relative'
        }}
      >
        {visibleCells}
      </div>
    </div>
  );
};
