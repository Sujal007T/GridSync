package com.gridsync.history;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gridsync.crdt.CellValue;
import com.gridsync.crdt.CrdtMerger;
import com.gridsync.crdt.HybridLogicalClock;
import com.gridsync.persistence.GridStateEntity;
import com.gridsync.persistence.OpLogEntity;
import com.gridsync.persistence.OpLogRepository;
import com.gridsync.persistence.GridStateRepository;
import com.gridsync.persistence.SnapshotRepository;
import com.gridsync.sheet.Op;
import com.gridsync.sheet.SheetService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.util.*;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

import org.springframework.context.annotation.Import;

@SpringBootTest
@Import(com.gridsync.TestcontainersConfiguration.class)
public class ReplayServiceTest {

    @Autowired private SheetService sheetService;
    @Autowired private SnapshotService snapshotService;
    @Autowired private ReplayService replayService;
    @Autowired private OpLogRepository opLogRepository;
    @Autowired private GridStateRepository gridStateRepository;
    @Autowired private SnapshotRepository snapshotRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        opLogRepository.deleteAll();
        gridStateRepository.deleteAll();
        snapshotRepository.deleteAll();
    }

    /**
     * Seeds 550 CELL_SET ops across 10 distinct cells, forces a snapshot at op 500,
     * then seeds 50 more ops (ops 501-550).
     *
     * Target is op 525 (hlcPhysical = baseTime + 525*10).
     *
     * PATH A (system under test): ReplayService.rebuildState() — finds the snapshot at seq≈500,
     *   then replays forward ops 501..525 on top of it.
     *
     * PATH B (ground truth): Direct full replay from seq=0 through the op_log table up to
     *   the same target hlcPhysical, applying CrdtMerger manually — no snapshot used.
     *
     * Both paths must produce identical cell states (same value, same hlcPhysical for every cell).
     */
    @Test
    void testSnapshotPlusForwardReplayMatchesFullReplayFromScratch() throws Exception {
        UUID sheetId = UUID.randomUUID();
        UUID replicaId = UUID.randomUUID();

        // 10 distinct cells: same row, different cols
        UUID rowId = UUID.randomUUID();
        UUID[] colIds = new UUID[10];
        for (int c = 0; c < 10; c++) colIds[c] = UUID.randomUUID();

        long baseTime = System.currentTimeMillis() - 100_000; // well in the past to avoid HLC future-skew rejection

        // --- Seed 500 ops: round-robin across 10 cells ---
        for (int i = 1; i <= 500; i++) {
            UUID colId = colIds[(i - 1) % 10];
            HybridLogicalClock hlc = new HybridLogicalClock(baseTime + (long) i * 10, 0, replicaId);
            String payload = String.format(
                    "{\"rowId\":\"%s\",\"colId\":\"%s\",\"value\":\"v%d\"}", rowId, colId, i);
            Op op = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload, hlc);
            sheetService.applyOpTransactional(op);
        }

        long seqAfter500 = opLogRepository.findMaxSeqBySheetId(sheetId);
        assertThat(seqAfter500).isGreaterThanOrEqualTo(500L);

        // --- Verify at least one snapshot was auto-created by SheetService ---
        // SheetService calls createSnapshotIfNeeded (async, 1/20 prob) on every op.
        // With 500 ops the probability of zero triggers is (19/20)^500 ≈ 0%. We wait briefly
        // for the async executor to flush its last task.
        Thread.sleep(500);
        long snapshotCount = snapshotRepository.count();
        assertThat(snapshotCount).isGreaterThanOrEqualTo(1)
                .withFailMessage("Expected at least 1 auto-snapshot after 500 ops, but got 0");

        // --- Seed 50 more ops (501–550) ---
        for (int i = 501; i <= 550; i++) {
            UUID colId = colIds[(i - 1) % 10];
            HybridLogicalClock hlc = new HybridLogicalClock(baseTime + (long) i * 10, 0, replicaId);
            String payload = String.format(
                    "{\"rowId\":\"%s\",\"colId\":\"%s\",\"value\":\"v%d\"}", rowId, colId, i);
            Op op = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload, hlc);
            sheetService.applyOpTransactional(op);
        }

        // Target: hlcPhysical of op 525 (a point AFTER the earliest snapshot)
        long targetHlcPhysical = baseTime + 525L * 10;

        // ============================================================
        // PATH A: ReplayService (snapshot + forward replay)
        // ============================================================
        List<GridStateEntity> pathA = replayService.rebuildState(sheetId, targetHlcPhysical);

        // ============================================================
        // PATH B: Full replay from seq=0 — no snapshot, pure op log scan
        // We query all ops with seq <= maxTargetSeq, sorted by seq asc,
        // and apply CrdtMerger ourselves.
        // ============================================================
        Map<String, GridStateEntity> pathBState = new HashMap<>();
        int batchSize = 500;
        int page = 0;
        long maxTargetSeq = opLogRepository.findMaxSeqBySheetIdAndHlcPhysicalLessThanEqual(
                sheetId, targetHlcPhysical);

        boolean hasMore = true;
        while (hasMore) {
            Slice<OpLogEntity> slice = opLogRepository.findBySheetIdAndSeqBetweenOrderBySeqAsc(
                    sheetId, 1L, maxTargetSeq, PageRequest.of(page, batchSize));
            for (OpLogEntity op : slice) {
                if (!"CELL_SET".equals(op.getOpType())) continue;
                try {
                    JsonNode node = objectMapper.readTree(op.getPayload());
                    UUID rId = UUID.fromString(node.get("rowId").asText());
                    UUID cId = UUID.fromString(node.get("colId").asText());
                    String value = node.has("value") ? node.get("value").asText() : "";
                    HybridLogicalClock inHlc = new HybridLogicalClock(
                            op.getHlcPhysical(), op.getHlcLogical(), op.getReplicaId());
                    CellValue incoming = new CellValue(value, inHlc, inHlc.replicaId());
                    String key = rId + ":" + cId;
                    GridStateEntity existing = pathBState.get(key);
                    if (existing == null) {
                        pathBState.put(key, new GridStateEntity(op.getSheetId(), rId, cId, incoming));
                    } else {
                        CellValue merged = CrdtMerger.merge(existing.toCellValue(), incoming);
                        pathBState.put(key, new GridStateEntity(op.getSheetId(), rId, cId, merged));
                    }
                } catch (Exception e) {
                    throw new RuntimeException("Failed to replay op seq=" + op.getSeq(), e);
                }
            }
            hasMore = slice.hasNext();
            page++;
        }
        List<GridStateEntity> pathB = List.copyOf(pathBState.values());

        // ============================================================
        // Assert both paths produce identical state
        // ============================================================
        // Build a comparable map: cellKey -> "value@hlcPhysical"
        Map<String, String> mapA = pathA.stream().collect(Collectors.toMap(
                e -> e.getRowId() + ":" + e.getColId(),
                e -> e.getValue() + "@" + e.getHlcPhysical()
        ));
        Map<String, String> mapB = pathB.stream().collect(Collectors.toMap(
                e -> e.getRowId() + ":" + e.getColId(),
                e -> e.getValue() + "@" + e.getHlcPhysical()
        ));

        assertThat(mapA).isEqualTo(mapB)
                .withFailMessage("Snapshot+forward-replay diverges from full-replay-from-scratch.\n" +
                        "PATH A (%d cells): %s\nPATH B (%d cells): %s",
                        mapA.size(), mapA, mapB.size(), mapB);

        // Sanity check: at target = op 525, cell index 4 (= (525-1)%10) should have value "v525"
        // because op 525 is the most recent write to that cell within the target window.
        String cell4Key = rowId + ":" + colIds[4];
        assertThat(mapA).containsKey(cell4Key);
        assertThat(mapA.get(cell4Key)).startsWith("v525@");
    }
}

