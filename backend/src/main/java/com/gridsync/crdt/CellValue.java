package com.gridsync.crdt;

import java.util.UUID;

public record CellValue(
    String value,
    HybridLogicalClock hlc,
    UUID replicaId
) {}
