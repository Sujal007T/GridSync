package com.gridsync.crdt;

import org.junit.jupiter.api.Test;
import java.util.UUID;
import java.lang.reflect.Method;
import static org.junit.jupiter.api.Assertions.*;

class CrdtMergerTest {

    @Test
    void testMergeNormalOrdering() {
        UUID replicaA = UUID.randomUUID();
        UUID replicaB = UUID.randomUUID();
        
        CellValue valA = new CellValue("A", new HybridLogicalClock(1000, 0, replicaA), replicaA);
        CellValue valB = new CellValue("B", new HybridLogicalClock(1001, 0, replicaB), replicaB);
        
        // valB has higher physical time, so it should win
        assertEquals(valB, CrdtMerger.merge(valA, valB));
        assertEquals(valB, CrdtMerger.merge(valB, valA));
        
        CellValue valC = new CellValue("C", new HybridLogicalClock(1001, 1, replicaA), replicaA);
        
        // valC has same physical time but higher logical counter, should win
        assertEquals(valC, CrdtMerger.merge(valB, valC));
    }

    @Test
    void testMergeTieOnIdenticalHLC() {
        UUID replicaA = new UUID(0, 1);
        UUID replicaB = new UUID(0, 2); // B is strictly greater than A
        
        // Even though HLC replicaIds are the same (which might happen if HLC didn't include it or it's forced),
        // we'll make the HLCs exactly identical.
        HybridLogicalClock hlcA = new HybridLogicalClock(1000, 0, replicaA);
        HybridLogicalClock hlcB = new HybridLogicalClock(1000, 0, replicaA); // Identical HLC
        
        CellValue valA = new CellValue("A", hlcA, replicaA);
        CellValue valB = new CellValue("B", hlcB, replicaB);
        
        // HLC is identical, so it falls back to CellValue.replicaId. replicaB > replicaA, so valB wins.
        assertEquals(valB, CrdtMerger.merge(valA, valB));
        assertEquals(valB, CrdtMerger.merge(valB, valA));
    }
    
    @Test
    void testMergeTieOnIdenticalHLCAndIdenticalReplicaId() {
        UUID replicaA = UUID.randomUUID();
        
        HybridLogicalClock hlcA = new HybridLogicalClock(1000, 0, replicaA);
        
        CellValue valA = new CellValue("A", hlcA, replicaA);
        CellValue valB = new CellValue("B", hlcA, replicaA);
        
        // Should not crash, should just return one of them (valB in this case based on cmp > 0 ? a : b)
        // Since cmp is 0 and replica.compareTo is 0, it evaluates to false, returning b (valB).
        assertDoesNotThrow(() -> {
            CellValue result = CrdtMerger.merge(valA, valB);
            assertNotNull(result);
        });
    }

    @Test
    void testMergeHasNoServerTimeDependency() throws NoSuchMethodException {
        // Asserting that the signature is strictly public static CellValue merge(CellValue a, CellValue b)
        Method mergeMethod = CrdtMerger.class.getMethod("merge", CellValue.class, CellValue.class);
        assertNotNull(mergeMethod);
        
        // Assert no other parameters are accepted
        assertEquals(2, mergeMethod.getParameterCount());
        
        // Ensure no overloaded methods exist that might take time/clock
        for (Method m : CrdtMerger.class.getDeclaredMethods()) {
            if (m.getName().equals("merge")) {
                assertEquals(2, m.getParameterCount(), "merge() should only accept 2 CellValues");
            }
        }
    }
}
