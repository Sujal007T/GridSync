package com.gridsync.persistence;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class SnapshotId implements Serializable {
    private UUID sheetId;
    private Long seq;

    public SnapshotId() {}

    public SnapshotId(UUID sheetId, Long seq) {
        this.sheetId = sheetId;
        this.seq = seq;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        SnapshotId that = (SnapshotId) o;
        return Objects.equals(sheetId, that.sheetId) &&
               Objects.equals(seq, that.seq);
    }

    @Override
    public int hashCode() {
        return Objects.hash(sheetId, seq);
    }
}
