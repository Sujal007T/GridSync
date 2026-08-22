package com.gridsync.persistence;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "snapshots")
@IdClass(SnapshotId.class)
public class SnapshotEntity {

    @Id
    @Column(name = "sheet_id", nullable = false)
    private UUID sheetId;

    @Id
    @Column(name = "seq", nullable = false)
    private Long seq;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "state", nullable = false)
    private String state;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Instant createdAt;

    public SnapshotEntity() {}

    public SnapshotEntity(UUID sheetId, Long seq, String state) {
        this.sheetId = sheetId;
        this.seq = seq;
        this.state = state;
    }

    public UUID getSheetId() {
        return sheetId;
    }

    public Long getSeq() {
        return seq;
    }

    public String getState() {
        return state;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
