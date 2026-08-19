package com.gridsync.persistence;

import java.util.UUID;

/**
 * Public DTO returned by the catch-up REST endpoint.
 * Intentionally a record (immutable, all-fields constructor, auto-generated equals/hashCode)
 * so Jackson can serialize it without annotations.
 */
public record OpLogDto(
    Long seq,
    UUID opId,
    String opType,
    String payload,
    long hlcPhysical,
    int hlcLogical,
    UUID replicaId
) {}
