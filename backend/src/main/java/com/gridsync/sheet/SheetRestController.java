package com.gridsync.sheet;

import com.gridsync.persistence.OpLogDto;
import com.gridsync.persistence.OpLogRepository;
import com.gridsync.security.JwtService;
import com.gridsync.security.SheetMemberRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for sheet catch-up and initial-load operations.
 *
 * Auth pattern: reads Authorization header directly (same as SheetAccessInterceptor for STOMP),
 * validates with JwtService, checks SheetMemberRepository — this endpoint is NOT exempt from
 * authorization just because it's REST rather than STOMP.
 */
@RestController
@RequestMapping("/api/sheets")
public class SheetRestController {

    private final OpLogRepository opLogRepository;
    private final JwtService jwtService;
    private final SheetMemberRepository sheetMemberRepository;
    private final com.gridsync.history.ReplayService replayService;

    public SheetRestController(OpLogRepository opLogRepository,
                                JwtService jwtService,
                                SheetMemberRepository sheetMemberRepository,
                                com.gridsync.history.ReplayService replayService) {
        this.opLogRepository = opLogRepository;
        this.jwtService = jwtService;
        this.sheetMemberRepository = sheetMemberRepository;
        this.replayService = replayService;
    }

    /**
     * Catch-up endpoint: returns all ops for {@code sheetId} with seq > {@code sinceSeq},
     * ordered by seq ascending. The client calls this on reconnect with its lastSeenSeq.
     *
     * Uses the (sheet_id, seq) index from Phase 3's V2 migration for efficient range scans.
     *
     * @param sheetId   the sheet to catch up on
     * @param sinceSeq  the last seq the client has seen (exclusive lower bound), defaults to 0
     * @param authHeader the Bearer JWT token
     * @return ordered list of op DTOs, or 401/403 if unauthorized
     */
    @GetMapping("/{sheetId}/ops")
    public ResponseEntity<List<OpLogDto>> getCatchUpOps(
            @PathVariable UUID sheetId,
            @RequestParam(name = "sinceSeq", defaultValue = "0") long sinceSeq,
            @RequestHeader(name = "Authorization", required = false) String authHeader) {

        // --- Auth: same pattern as SheetAccessInterceptor ---
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        String token = authHeader.substring(7);
        UUID userId = jwtService.validateTokenAndGetUserId(token);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        if (!sheetMemberRepository.existsBySheetIdAndUserId(sheetId, userId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        // --- End auth ---

        List<OpLogDto> ops = opLogRepository
                .findBySheetIdAndSeqGreaterThanOrderBySeqAsc(sheetId, sinceSeq)
                .stream()
                .map(e -> e.toDto())
                .toList();

        return ResponseEntity.ok(ops);
    }
    @GetMapping("/{sheetId}/history/timeline")
    public ResponseEntity<List<Long>> getHistoryTimeline(
            @PathVariable UUID sheetId,
            @RequestHeader(name = "Authorization", required = false) String authHeader) {
        
        if (!isAuthorized(sheetId, authHeader)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build(); // Generic forbidden for simplicity
        }

        List<Long> timestamps = opLogRepository
                .findDistinctHlcPhysicalBySheetIdOrderByHlcPhysicalDesc(sheetId, org.springframework.data.domain.PageRequest.of(0, 50))
                .getContent();

        return ResponseEntity.ok(timestamps);
    }

    @GetMapping("/{sheetId}/history")
    public ResponseEntity<List<com.gridsync.persistence.GridStateEntity>> getHistoryAt(
            @PathVariable UUID sheetId,
            @RequestParam(name = "at") long targetTimestamp,
            @RequestHeader(name = "Authorization", required = false) String authHeader) {
        
        if (!isAuthorized(sheetId, authHeader)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        List<com.gridsync.persistence.GridStateEntity> rebuiltState = replayService.rebuildState(sheetId, targetTimestamp);
        return ResponseEntity.ok(rebuiltState);
    }

    private boolean isAuthorized(UUID sheetId, String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) return false;
        String token = authHeader.substring(7);
        UUID userId = jwtService.validateTokenAndGetUserId(token);
        if (userId == null) return false;
        return sheetMemberRepository.existsBySheetIdAndUserId(sheetId, userId);
    }
}
