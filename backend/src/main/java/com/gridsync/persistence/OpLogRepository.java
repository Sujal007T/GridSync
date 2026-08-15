package com.gridsync.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.UUID;

public interface OpLogRepository extends JpaRepository<OpLogEntity, Long> {
    long countBySheetIdAndOpId(UUID sheetId, UUID opId);

    @Modifying
    @Query(value = """
        INSERT INTO op_log (sheet_id, op_id, op_type, payload, hlc_physical, hlc_logical, replica_id)
        VALUES (:sheetId, :opId, :opType, CAST(:payload AS jsonb), :hlcPhysical, :hlcLogical, :replicaId)
        ON CONFLICT (sheet_id, op_id) DO NOTHING
        """, nativeQuery = true)
    int insertOpLogIfNotExists(
        @Param("sheetId") UUID sheetId,
        @Param("opId") UUID opId,
        @Param("opType") String opType,
        @Param("payload") String payload,
        @Param("hlcPhysical") long hlcPhysical,
        @Param("hlcLogical") int hlcLogical,
        @Param("replicaId") UUID replicaId
    );
}
