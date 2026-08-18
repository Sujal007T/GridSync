import { describe, it, expect, beforeEach } from 'vitest';
import { HybridLogicalClock } from '../HybridLogicalClock';
import { v4 as uuidv4 } from 'uuid';

describe('HybridLogicalClock', () => {
  beforeEach(() => {
    HybridLogicalClock.reset();
  });

  it('compareTo', () => {
    const replicaA = uuidv4();
    const replicaB = uuidv4();
    const hlc1 = new HybridLogicalClock(1000, 0, replicaA);
    const hlc2 = new HybridLogicalClock(1000, 1, replicaA);
    const hlc3 = new HybridLogicalClock(1001, 0, replicaA);
    const hlc4 = new HybridLogicalClock(1000, 0, replicaB);

    expect(hlc1.compareTo(hlc1)).toBe(0);
    expect(hlc1.compareTo(hlc2)).toBe(-1);
    expect(hlc2.compareTo(hlc1)).toBe(1);
    expect(hlc1.compareTo(hlc3)).toBe(-1);
    expect(hlc3.compareTo(hlc1)).toBe(1);
    expect(hlc1.compareTo(hlc4)).toBe(replicaA > replicaB ? 1 : (replicaA < replicaB ? -1 : 0));
  });

  it('now() monotonicity when clock jumps backward', () => {
    const replicaA = uuidv4();
    let time = 1000;
    const mockClock = () => time;

    const hlc1 = HybridLogicalClock.now(replicaA, mockClock);
    expect(hlc1.physicalTime).toBe(1000);
    expect(hlc1.logicalCounter).toBe(0);

    // time jumps backward
    time = 900;
    const hlc2 = HybridLogicalClock.now(replicaA, mockClock);
    expect(hlc2.physicalTime).toBe(1000); // preserves last max
    expect(hlc2.logicalCounter).toBe(1);  // increments counter

    // time stays same
    const hlc3 = HybridLogicalClock.now(replicaA, mockClock);
    expect(hlc3.physicalTime).toBe(1000);
    expect(hlc3.logicalCounter).toBe(2);

    // time moves forward again
    time = 1005;
    const hlc4 = HybridLogicalClock.now(replicaA, mockClock);
    expect(hlc4.physicalTime).toBe(1005);
    expect(hlc4.logicalCounter).toBe(0);
  });
});
