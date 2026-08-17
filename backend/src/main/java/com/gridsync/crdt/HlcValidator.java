package com.gridsync.crdt;

import org.springframework.stereotype.Component;

import java.time.Clock;

@Component
public class HlcValidator {
    
    private static final long MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes

    private final Clock clock;

    public HlcValidator() {
        this.clock = Clock.systemUTC();
    }

    public HlcValidator(Clock clock) {
        this.clock = clock;
    }

    public void validateIncoming(HybridLogicalClock clientHlc) {
        long serverTime = clock.millis();
        if (clientHlc.physicalTime() > serverTime + MAX_SKEW_MS) {
            throw new IllegalArgumentException("HLC physical time exceeds maximum allowed future skew");
        }
    }
}
