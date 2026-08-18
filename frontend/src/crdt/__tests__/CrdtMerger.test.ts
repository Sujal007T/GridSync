import { describe, it, expect } from 'vitest';
import { merge } from '../CrdtMerger';
import { CellValue } from '../CellValue';
import { HybridLogicalClock } from '../HybridLogicalClock';
import { v4 as uuidv4 } from 'uuid';

describe('CrdtMerger', () => {
  it('merge normal ordering', () => {
    const replicaA = uuidv4();
    const replicaB = uuidv4();

    const valA: CellValue = { value: 'A', hlc: new HybridLogicalClock(1000, 0, replicaA), replicaId: replicaA };
    const valB: CellValue = { value: 'B', hlc: new HybridLogicalClock(1001, 0, replicaB), replicaId: replicaB };

    expect(merge(valA, valB)).toBe(valB);
    expect(merge(valB, valA)).toBe(valB);

    const valC: CellValue = { value: 'C', hlc: new HybridLogicalClock(1001, 1, replicaA), replicaId: replicaA };
    expect(merge(valB, valC)).toBe(valC);
  });

  it('merge tie on identical HLC', () => {
    const replicaA = "11111111-1111-1111-1111-111111111111";
    const replicaB = "22222222-2222-2222-2222-222222222222";

    const hlcA = new HybridLogicalClock(1000, 0, replicaA);
    const hlcB = new HybridLogicalClock(1000, 0, replicaA); // Identical HLC intentionally

    const valA: CellValue = { value: 'A', hlc: hlcA, replicaId: replicaA };
    const valB: CellValue = { value: 'B', hlc: hlcB, replicaId: replicaB };

    // B's replicaId is larger than A's replicaId lexicographically, so B wins tiebreak
    expect(merge(valA, valB)).toBe(valB);
    expect(merge(valB, valA)).toBe(valB);
  });

  it('merge tie on identical HLC and identical replicaId', () => {
    const replicaA = uuidv4();
    const hlcA = new HybridLogicalClock(1000, 0, replicaA);

    const valA: CellValue = { value: 'A', hlc: hlcA, replicaId: replicaA };
    const valB: CellValue = { value: 'B', hlc: hlcA, replicaId: replicaA };

    // Should not crash, just returns one of them deterministically
    const result = merge(valA, valB);
    expect(result).toBeDefined();
  });
});
