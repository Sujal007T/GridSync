package com.gridsync.crdt;

import java.time.Clock;
import java.util.UUID;

public record HybridLogicalClock(long physicalTime, int logicalCounter, UUID replicaId) implements Comparable<HybridLogicalClock> {

    private static long lastPhysicalTime = 0;
    private static int lastLogicalCounter = 0;
    private static final Object lock = new Object();

    public static HybridLogicalClock now(UUID replicaId, Clock clock) {
        synchronized (lock) {
            long currentPhysicalTime = clock.millis();
            if (currentPhysicalTime > lastPhysicalTime) {
                lastPhysicalTime = currentPhysicalTime;
                lastLogicalCounter = 0;
            } else {
                lastLogicalCounter++;
            }
            return new HybridLogicalClock(lastPhysicalTime, lastLogicalCounter, replicaId);
        }
    }

    // For testing purposes
    static void reset() {
        synchronized (lock) {
            lastPhysicalTime = 0;
            lastLogicalCounter = 0;
        }
    }

    @Override
    public int compareTo(HybridLogicalClock other) {
        int cmp = Long.compare(this.physicalTime, other.physicalTime);
        if (cmp != 0) return cmp;
        
        cmp = Integer.compare(this.logicalCounter, other.logicalCounter);
        if (cmp != 0) return cmp;
        
        if (this.replicaId != null && other.replicaId != null) {
            return this.replicaId.compareTo(other.replicaId);
        } else if (this.replicaId != null) {
            return 1;
        } else if (other.replicaId != null) {
            return -1;
        }
        return 0;
    }
}
