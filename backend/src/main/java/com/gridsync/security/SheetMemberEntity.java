package com.gridsync.security;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "sheet_members")
@IdClass(SheetMemberId.class)
public class SheetMemberEntity {
    @Id
    private UUID sheetId;

    @Id
    private UUID userId;

    private Instant createdAt;

    public SheetMemberEntity() {
    }

    public SheetMemberEntity(UUID sheetId, UUID userId) {
        this.sheetId = sheetId;
        this.userId = userId;
        this.createdAt = Instant.now();
    }

    public UUID getSheetId() { return sheetId; }
    public void setSheetId(UUID sheetId) { this.sheetId = sheetId; }

    public UUID getUserId() { return userId; }
    public void setUserId(UUID userId) { this.userId = userId; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
