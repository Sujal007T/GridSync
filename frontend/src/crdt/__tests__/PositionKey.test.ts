import { describe, it, expect } from 'vitest';
import { PositionKey } from '../PositionKey';

describe('PositionKey', () => {
  it('calculates midpoints correctly', () => {
    expect(PositionKey.midpoint("", "")).toBe("V");
    expect(PositionKey.midpoint("Z", "b")).toBe("a");
    expect(PositionKey.midpoint("", "0")).toBe("0V");
    expect(PositionKey.midpoint("z", "")).toBe("zV");
    expect(PositionKey.midpoint("a", "b")).toBe("aV");
    expect(PositionKey.midpoint("a0V", "a1")).toBe("a0k");
  });

  it('generates sequential keys', () => {
    let last = "";
    for (let i = 0; i < 1000; i++) {
      const next = PositionKey.generate(last, "");
      if (last !== "") {
        expect(last < next).toBe(true); // strictly less
      }
      last = next;
    }
  });

  it('generates between keys', () => {
    const start = "a";
    const end = "b";
    const mid = PositionKey.generate(start, end);
    expect(start < mid).toBe(true);
    expect(mid < end).toBe(true);
  });
});
