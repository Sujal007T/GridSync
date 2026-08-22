import type { CellValue } from '../crdt/CellValue';
import { HybridLogicalClock } from '../crdt/HybridLogicalClock';
import { stompClient } from './stompClient';

function authHeaders(): HeadersInit {
  const token = stompClient.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchTimeline(sheetId: string): Promise<number[]> {
  const url = `/api/sheets/${sheetId}/history/timeline`;
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error('Failed to fetch timeline');
  }
  return response.json();
}

export async function fetchHistoryState(sheetId: string, timestamp: number): Promise<Record<string, CellValue>> {
  const url = `/api/sheets/${sheetId}/history?at=${timestamp}`;
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error('Failed to fetch history state');
  }
  
  const stateEntities = await response.json();
  
  // Convert List<GridStateEntity> to Record<string, CellValue>
  const cells: Record<string, CellValue> = {};
  for (const entity of stateEntities) {
    const cellId = `${entity.rowId}:${entity.colId}`;
    cells[cellId] = {
      value: entity.value,
      replicaId: entity.replicaId,
      hlc: new HybridLogicalClock(
        entity.hlcPhysical,
        entity.hlcLogical,
        entity.replicaId
      )
    };
  }
  
  return cells;
}
