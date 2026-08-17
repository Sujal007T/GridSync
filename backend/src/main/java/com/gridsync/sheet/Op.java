package com.gridsync.sheet;

import com.gridsync.crdt.HybridLogicalClock;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public record Op(
    UUID sheetId,
    UUID opId,
    String opType,
    @Size(max = 2000, message = "Payload exceeds maximum allowed size")
    String payload,
    HybridLogicalClock hlc
) {}
