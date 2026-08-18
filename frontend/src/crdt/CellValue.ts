import { HybridLogicalClock } from './HybridLogicalClock';

export interface CellValue {
  value: string;
  hlc: HybridLogicalClock;
  replicaId: string;
}
