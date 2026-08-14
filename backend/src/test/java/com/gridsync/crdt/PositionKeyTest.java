package com.gridsync.crdt;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class PositionKeyTest {

    @Test
    void testMidpointBasic() {
        assertEquals("V", PositionKey.midpoint("", ""));
        assertEquals("a", PositionKey.midpoint("Z", "b"));
        assertEquals("0V", PositionKey.midpoint("", "0"));
        assertEquals("zV", PositionKey.midpoint("z", ""));
    }

    @Test
    void testMidpointAdjacent() {
        // Between a and b
        assertEquals("aV", PositionKey.midpoint("a", "b"));
        // Between a0V and a1
        assertEquals("a0k", PositionKey.midpoint("a0V", "a1"));
    }

    @Test
    void testPathologicalSequentialInserts() {
        // Insert always at the start (between "" and currentFirst)
        String currentFirst = "";
        int iterations = 1000;
        
        Set<String> generatedKeys = new HashSet<>();
        
        for (int i = 0; i < iterations; i++) {
            String newKey = PositionKey.generate("", currentFirst);
            
            // Should not produce duplicate
            assertFalse(generatedKeys.contains(newKey), "Generated a duplicate key: " + newKey);
            generatedKeys.add(newKey);
            
            // Should stay lexicographically correct
            if (!currentFirst.isEmpty()) {
                assertTrue(newKey.compareTo(currentFirst) < 0, "New key " + newKey + " is not less than " + currentFirst);
            }
            
            currentFirst = newKey;
        }
        
        // Assert max key length doesn't explode
        // With base 62, 1000 inserts at the start should result in a max length around 1000 / log2(62) ~ 170.
        // Plus 1 random char per generation might add slightly more depth, but safely under 300.
        assertTrue(currentFirst.length() < 300, "Key length exploded: " + currentFirst.length());
    }

    @Test
    void testPathologicalSequentialInsertsAtEnd() {
        // Insert always at the end (between currentLast and "")
        String currentLast = "";
        int iterations = 1000;
        
        for (int i = 0; i < iterations; i++) {
            String newKey = PositionKey.generate(currentLast, "");
            if (!currentLast.isEmpty()) {
                assertTrue(newKey.compareTo(currentLast) > 0, "New key " + newKey + " is not greater than " + currentLast);
            }
            currentLast = newKey;
        }
        
        assertTrue(currentLast.length() < 300, "Key length exploded: " + currentLast.length());
    }

    @Test
    void testPathologicalSequentialInsertsInMiddle() {
        // Insert always between the same two bounds
        String left = "a";
        String right = "b";
        int iterations = 1000;
        
        String lastGenerated = left;
        for (int i = 0; i < iterations; i++) {
            // Always insert between the newly generated key and right
            String newKey = PositionKey.generate(lastGenerated, right);
            assertTrue(newKey.compareTo(lastGenerated) > 0);
            assertTrue(newKey.compareTo(right) < 0);
            lastGenerated = newKey;
        }
        
        assertTrue(lastGenerated.length() < 300, "Key length exploded: " + lastGenerated.length());
    }
}
