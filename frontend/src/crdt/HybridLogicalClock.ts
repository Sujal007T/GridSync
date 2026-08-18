export class HybridLogicalClock {
  public readonly physicalTime: number;
  public readonly logicalCounter: number;
  public readonly replicaId: string;

  private static lastPhysicalTime: number = 0;
  private static lastLogicalCounter: number = 0;

  constructor(physicalTime: number, logicalCounter: number, replicaId: string) {
    this.physicalTime = physicalTime;
    this.logicalCounter = logicalCounter;
    this.replicaId = replicaId;
  }

  public static now(replicaId: string, customClock?: () => number): HybridLogicalClock {
    const currentPhysicalTime = customClock ? customClock() : Date.now();
    if (currentPhysicalTime > HybridLogicalClock.lastPhysicalTime) {
      HybridLogicalClock.lastPhysicalTime = currentPhysicalTime;
      HybridLogicalClock.lastLogicalCounter = 0;
    } else {
      HybridLogicalClock.lastLogicalCounter++;
    }
    return new HybridLogicalClock(
      HybridLogicalClock.lastPhysicalTime,
      HybridLogicalClock.lastLogicalCounter,
      replicaId
    );
  }

  // For testing
  public static reset() {
    HybridLogicalClock.lastPhysicalTime = 0;
    HybridLogicalClock.lastLogicalCounter = 0;
  }

  public compareTo(other: HybridLogicalClock): number {
    if (this.physicalTime !== other.physicalTime) {
      return this.physicalTime > other.physicalTime ? 1 : -1;
    }
    if (this.logicalCounter !== other.logicalCounter) {
      return this.logicalCounter > other.logicalCounter ? 1 : -1;
    }
    if (this.replicaId && other.replicaId) {
      return this.replicaId > other.replicaId ? 1 : (this.replicaId < other.replicaId ? -1 : 0);
    } else if (this.replicaId) {
      return 1;
    } else if (other.replicaId) {
      return -1;
    }
    return 0;
  }
}
