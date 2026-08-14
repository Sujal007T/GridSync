package com.gridsync.crdt;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class HybridLogicalClockTest {

    private UUID replicaA = UUID.randomUUID();
    private UUID replicaB = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        HybridLogicalClock.reset();
    }

    @Test
    void testNowMonotonicityWhenClockJumpsBackward() {
        // Initial time
        Clock initialClock = Clock.fixed(Instant.ofEpochMilli(1000), ZoneId.of("UTC"));
        HybridLogicalClock hlc1 = HybridLogicalClock.now(replicaA, initialClock);
        assertEquals(1000L, hlc1.physicalTime());
        assertEquals(0, hlc1.logicalCounter());

        // Clock jumps backward to 900
        Clock backwardClock = Clock.fixed(Instant.ofEpochMilli(900), ZoneId.of("UTC"));
        HybridLogicalClock hlc2 = HybridLogicalClock.now(replicaA, backwardClock);
        
        // Assert monotonicity holds (physical time stays at 1000, logical counter increments)
        assertEquals(1000L, hlc2.physicalTime());
        assertEquals(1, hlc2.logicalCounter());
        assertTrue(hlc2.compareTo(hlc1) > 0);
        
        // Clock is still backward
        HybridLogicalClock hlc3 = HybridLogicalClock.now(replicaA, backwardClock);
        assertEquals(1000L, hlc3.physicalTime());
        assertEquals(2, hlc3.logicalCounter());
        assertTrue(hlc3.compareTo(hlc2) > 0);
        
        // Clock jumps forward past the previous max to 1100
        Clock forwardClock = Clock.fixed(Instant.ofEpochMilli(1100), ZoneId.of("UTC"));
        HybridLogicalClock hlc4 = HybridLogicalClock.now(replicaA, forwardClock);
        assertEquals(1100L, hlc4.physicalTime());
        assertEquals(0, hlc4.logicalCounter());
        assertTrue(hlc4.compareTo(hlc3) > 0);
    }
    
    @Test
    void testCompareTo() {
        HybridLogicalClock hlc1 = new HybridLogicalClock(1000, 0, replicaA);
        HybridLogicalClock hlc2 = new HybridLogicalClock(1000, 1, replicaA);
        HybridLogicalClock hlc3 = new HybridLogicalClock(1001, 0, replicaA);
        
        assertTrue(hlc2.compareTo(hlc1) > 0);
        assertTrue(hlc3.compareTo(hlc2) > 0);
    }
}
