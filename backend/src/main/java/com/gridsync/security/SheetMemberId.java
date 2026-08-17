package com.gridsync.security;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class SheetMemberId implements Serializable {
    private UUID sheetId;
    private UUID userId;

    public SheetMemberId() {}

    public SheetMemberId(UUID sheetId, UUID userId) {
        this.sheetId = sheetId;
        this.userId = userId;
    }

    public UUID getSheetId() { return sheetId; }
    public void setSheetId(UUID sheetId) { this.sheetId = sheetId; }

    public UUID getUserId() { return userId; }
    public void setUserId(UUID userId) { this.userId = userId; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        SheetMemberId that = (SheetMemberId) o;
        return Objects.equals(sheetId, that.sheetId) && Objects.equals(userId, that.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(sheetId, userId);
    }
}
