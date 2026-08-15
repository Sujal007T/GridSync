package com.gridsync.persistence;

import com.gridsync.crdt.CellValue;
import com.gridsync.crdt.HybridLogicalClock;
import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "grid_state")
@IdClass(GridStateId.class)
public class GridStateEntity {

    @Id
    @Column(name = "sheet_id")
    private UUID sheetId;

    @Id
    @Column(name = "row_id")
    private UUID rowId;

    @Id
    @Column(name = "col_id")
    private UUID colId;

    @Column(name = "value")
    private String value;

    @Column(name = "hlc_physical")
    private long hlcPhysical;

    @Column(name = "hlc_logical")
    private int hlcLogical;

    @Column(name = "replica_id")
    private UUID replicaId;

    public GridStateEntity() {}

    public GridStateEntity(UUID sheetId, UUID rowId, UUID colId, CellValue cellValue) {
        this.sheetId = sheetId;
        this.rowId = rowId;
        this.colId = colId;
        this.value = cellValue.value();
        this.hlcPhysical = cellValue.hlc().physicalTime();
        this.hlcLogical = cellValue.hlc().logicalCounter();
        this.replicaId = cellValue.hlc().replicaId();
    }

    public CellValue toCellValue() {
        return new CellValue(value, new HybridLogicalClock(hlcPhysical, hlcLogical, replicaId), replicaId);
    }
}
