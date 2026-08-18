package com.gridsync.sheet;

import java.util.UUID;

public class OpRejectedException extends RuntimeException {
    private final UUID opId;

    public OpRejectedException(String message, UUID opId) {
        super(message);
        this.opId = opId;
    }

    public UUID getOpId() {
        return opId;
    }
}
