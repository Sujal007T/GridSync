package com.gridsync.security;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface SheetMemberRepository extends JpaRepository<SheetMemberEntity, SheetMemberId> {
    boolean existsBySheetIdAndUserId(UUID sheetId, UUID userId);
}
