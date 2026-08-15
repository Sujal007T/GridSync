package com.gridsync.persistence;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.util.UUID;
import java.time.Instant;

@Entity
@Table(name = "op_log")
public class OpLogEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long seq;

    @Column(name = "sheet_id", nullable = false)
    private UUID sheetId;

    @Column(name = "op_id", nullable = false)
    private UUID opId;

    @Column(name = "op_type", nullable = false)
    private String opType;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload", nullable = false)
    private String payload;

    @Column(name = "hlc_physical", nullable = false)
    private long hlcPhysical;

    @Column(name = "hlc_logical", nullable = false)
    private int hlcLogical;

    @Column(name = "replica_id", nullable = false)
    private UUID replicaId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Instant createdAt;

    public OpLogEntity() {}

    public OpLogEntity(UUID sheetId, UUID opId, String opType, String payload, long hlcPhysical, int hlcLogical, UUID replicaId) {
        this.sheetId = sheetId;
        this.opId = opId;
        this.opType = opType;
        this.payload = payload;
        this.hlcPhysical = hlcPhysical;
        this.hlcLogical = hlcLogical;
        this.replicaId = replicaId;
    }
}
