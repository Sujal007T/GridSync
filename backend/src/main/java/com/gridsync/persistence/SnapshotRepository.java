package com.gridsync.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.Optional;
import java.util.UUID;

public interface SnapshotRepository extends JpaRepository<SnapshotEntity, SnapshotId> {
    
    Optional<SnapshotEntity> findFirstBySheetIdAndSeqLessThanEqualOrderBySeqDesc(UUID sheetId, Long seq);
    
    Optional<SnapshotEntity> findFirstBySheetIdOrderBySeqDesc(UUID sheetId);

    @Query(value = "SELECT * FROM snapshots WHERE sheet_id = :sheetId ORDER BY seq DESC LIMIT 1 OFFSET 9", nativeQuery = true)
    Optional<SnapshotEntity> findTenthSnapshotBySheetId(@Param("sheetId") UUID sheetId);

    void deleteAllBySheetIdAndSeqLessThan(UUID sheetId, long seq);
}
