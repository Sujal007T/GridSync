package com.gridsync.sheet;

import com.gridsync.crdt.HybridLogicalClock;
import java.util.UUID;

public record Op(
    UUID sheetId,
    UUID opId,
    String opType,
    String payload,
    HybridLogicalClock hlc
) {}
