package com.gridsync.persistence;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.Optional;
import java.util.UUID;

public interface GridStateRepository extends JpaRepository<GridStateEntity, GridStateId> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<GridStateEntity> findWithLockBySheetIdAndRowIdAndColId(UUID sheetId, UUID rowId, UUID colId);

    @Modifying
    @Query(value = """
        INSERT INTO grid_state (sheet_id, row_id, col_id, value, hlc_physical, hlc_logical, replica_id)
        VALUES (:sheetId, :rowId, :colId, :value, :hlcPhysical, :hlcLogical, :replicaId)
        ON CONFLICT (sheet_id, row_id, col_id) DO NOTHING
        """, nativeQuery = true)
    int insertGridStateIfNotExists(
        @Param("sheetId") UUID sheetId,
        @Param("rowId") UUID rowId,
        @Param("colId") UUID colId,
        @Param("value") String value,
        @Param("hlcPhysical") long hlcPhysical,
        @Param("hlcLogical") int hlcLogical,
        @Param("replicaId") UUID replicaId
    );
}
