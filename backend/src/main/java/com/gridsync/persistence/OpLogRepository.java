package com.gridsync.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
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

    /**
     * Catch-up query: returns all ops for a sheet with seq > sinceSeq, ordered ascending.
     * Uses the (sheet_id, seq) index created in Phase 3's V2 migration.
     */
    List<OpLogEntity> findBySheetIdAndSeqGreaterThanOrderBySeqAsc(UUID sheetId, Long sinceSeq);

    void deleteAllBySheetIdAndSeqLessThan(UUID sheetId, long seq);

    @Query("SELECT COALESCE(MAX(o.seq), 0) FROM OpLogEntity o WHERE o.sheetId = :sheetId")
    long findMaxSeqBySheetId(@Param("sheetId") UUID sheetId);

    @Query("SELECT COALESCE(MAX(o.seq), 0) FROM OpLogEntity o WHERE o.sheetId = :sheetId AND o.hlcPhysical <= :maxHlcPhysical")
    long findMaxSeqBySheetIdAndHlcPhysicalLessThanEqual(@Param("sheetId") UUID sheetId, @Param("maxHlcPhysical") long maxHlcPhysical);

    org.springframework.data.domain.Slice<OpLogEntity> findBySheetIdAndSeqBetweenOrderBySeqAsc(UUID sheetId, Long minSeq, Long maxSeq, org.springframework.data.domain.Pageable pageable);

    @Query("SELECT DISTINCT o.hlcPhysical FROM OpLogEntity o WHERE o.sheetId = :sheetId ORDER BY o.hlcPhysical DESC")
    org.springframework.data.domain.Slice<Long> findDistinctHlcPhysicalBySheetIdOrderByHlcPhysicalDesc(@Param("sheetId") UUID sheetId, org.springframework.data.domain.Pageable pageable);
}
