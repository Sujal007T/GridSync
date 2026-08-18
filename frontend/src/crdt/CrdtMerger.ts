import type { CellValue } from './CellValue';
import { HybridLogicalClock } from './HybridLogicalClock';

export function merge(a: CellValue, b: CellValue): CellValue {
  // We handle potential raw JSON objects by instantiating them
  const hlcA = a.hlc instanceof HybridLogicalClock ? a.hlc : new HybridLogicalClock((a.hlc as any).physicalTime, (a.hlc as any).logicalCounter, (a.hlc as any).replicaId);
  const hlcB = b.hlc instanceof HybridLogicalClock ? b.hlc : new HybridLogicalClock((b.hlc as any).physicalTime, (b.hlc as any).logicalCounter, (b.hlc as any).replicaId);

  const cmp = hlcA.compareTo(hlcB);
  if (cmp !== 0) {
    return cmp > 0 ? a : b;
  }
  return a.replicaId > b.replicaId ? a : b;
}
