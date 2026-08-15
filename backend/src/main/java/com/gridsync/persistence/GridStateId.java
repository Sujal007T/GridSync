package com.gridsync.persistence;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class GridStateId implements Serializable {
    private UUID sheetId;
    private UUID rowId;
    private UUID colId;

    public GridStateId() {}

    public GridStateId(UUID sheetId, UUID rowId, UUID colId) {
        this.sheetId = sheetId;
        this.rowId = rowId;
        this.colId = colId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        GridStateId that = (GridStateId) o;
        return Objects.equals(sheetId, that.sheetId) &&
               Objects.equals(rowId, that.rowId) &&
               Objects.equals(colId, that.colId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(sheetId, rowId, colId);
    }
}
