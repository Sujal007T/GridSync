package com.gridsync.crdt;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class HlcValidatorTest {

    @Test
    void validateIncoming_acceptsValidHlc() {
        Clock fixedClock = Clock.fixed(Instant.ofEpochMilli(1000000), ZoneId.of("UTC"));
        HlcValidator validator = new HlcValidator(fixedClock);

        // Client time is exactly server time
        HybridLogicalClock hlc1 = new HybridLogicalClock(1000000, 0, UUID.randomUUID());
        assertDoesNotThrow(() -> validator.validateIncoming(hlc1));

        // Client time is in the past
        HybridLogicalClock hlc2 = new HybridLogicalClock(900000, 0, UUID.randomUUID());
        assertDoesNotThrow(() -> validator.validateIncoming(hlc2));

        // Client time is slightly in the future (within 5 minutes = 300,000ms)
        HybridLogicalClock hlc3 = new HybridLogicalClock(1000000 + 200000, 0, UUID.randomUUID());
        assertDoesNotThrow(() -> validator.validateIncoming(hlc3));
    }

    @Test
    void validateIncoming_rejectsFutureHlc() {
        Clock fixedClock = Clock.fixed(Instant.ofEpochMilli(1000000), ZoneId.of("UTC"));
        HlcValidator validator = new HlcValidator(fixedClock);

        // Client time is exactly at the limit + 1ms (5 minutes + 1ms future)
        HybridLogicalClock hlc = new HybridLogicalClock(1000000 + 300001, 0, UUID.randomUUID());
        
        assertThrows(IllegalArgumentException.class, () -> validator.validateIncoming(hlc));
    }
}
