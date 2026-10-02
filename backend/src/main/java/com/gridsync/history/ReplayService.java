package com.gridsync.history;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gridsync.crdt.CellValue;
import com.gridsync.crdt.CrdtMerger;
import com.gridsync.crdt.HybridLogicalClock;
import com.gridsync.persistence.GridStateEntity;
import com.gridsync.persistence.OpLogEntity;
import com.gridsync.persistence.OpLogRepository;
import com.gridsync.persistence.SnapshotEntity;
import com.gridsync.persistence.SnapshotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class ReplayService {

    private static final Logger log = LoggerFactory.getLogger(ReplayService.class);

    private final OpLogRepository opLogRepository;
    private final SnapshotRepository snapshotRepository;
    private final ObjectMapper objectMapper;

    public ReplayService(OpLogRepository opLogRepository, SnapshotRepository snapshotRepository, ObjectMapper objectMapper) {
        this.opLogRepository = opLogRepository;
        this.snapshotRepository = snapshotRepository;
        this.objectMapper = objectMapper;
    }

    public List<GridStateEntity> rebuildState(UUID sheetId, long targetHlcPhysical) {
        // 1. Find the highest seq that corresponds to an op <= targetHlcPhysical
        long maxTargetSeq = opLogRepository.findMaxSeqBySheetIdAndHlcPhysicalLessThanEqual(sheetId, targetHlcPhysical);

        Map<String, GridStateEntity> stateMap = new HashMap<>();
        long startSeq = 0L;

        // 2. Find nearest snapshot <= maxTargetSeq
        var snapshotOpt = snapshotRepository.findFirstBySheetIdAndSeqLessThanEqualOrderBySeqDesc(sheetId, maxTargetSeq);
        if (snapshotOpt.isPresent()) {
            SnapshotEntity snapshot = snapshotOpt.get();
            startSeq = snapshot.getSeq();
            try {
                List<GridStateEntity> snapshotState = objectMapper.readValue(snapshot.getState(), new TypeReference<List<GridStateEntity>>() {});
                for (GridStateEntity entity : snapshotState) {
                    stateMap.put(entity.getRowId().toString() + ":" + entity.getColId().toString(), entity);
                }
            } catch (Exception e) {
                log.error("Failed to deserialize snapshot state for sheet " + sheetId, e);
                // Fall back to empty state if snapshot is corrupt
                startSeq = 0L;
                stateMap.clear();
            }
        }

        // 3. Batch replay ops from startSeq to maxTargetSeq
        int batchSize = 500;
        int page = 0;
        boolean hasMore = true;

        while (hasMore) {
            Slice<OpLogEntity> opSlice = opLogRepository.findBySheetIdAndSeqBetweenOrderBySeqAsc(
                    sheetId, startSeq + 1, maxTargetSeq, PageRequest.of(page, batchSize));

            for (OpLogEntity op : opSlice) {
                applyOpToState(op, stateMap);
            }

            hasMore = opSlice.hasNext();
            page++;
        }

        return List.copyOf(stateMap.values());
    }

    private void applyOpToState(OpLogEntity op, Map<String, GridStateEntity> stateMap) {
        if (!"CELL_SET".equals(op.getOpType())) {
            return;
        }

        try {
            JsonNode payloadNode = objectMapper.readTree(op.getPayload());
            UUID rowId = UUID.fromString(payloadNode.get("rowId").asText());
            UUID colId = UUID.fromString(payloadNode.get("colId").asText());
            String value = payloadNode.has("value") ? payloadNode.get("value").asText() : "";

            HybridLogicalClock incomingHlc = new HybridLogicalClock(op.getHlcPhysical(), op.getHlcLogical(), op.getReplicaId());
            CellValue incomingCell = new CellValue(value, incomingHlc, incomingHlc.replicaId());

            String key = rowId.toString() + ":" + colId.toString();
            GridStateEntity existing = stateMap.get(key);

            if (existing == null) {
                stateMap.put(key, new GridStateEntity(op.getSheetId(), rowId, colId, incomingCell));
            } else {
                CellValue merged = CrdtMerger.merge(existing.toCellValue(), incomingCell);
                stateMap.put(key, new GridStateEntity(op.getSheetId(), rowId, colId, merged));
            }
        } catch (Exception e) {
            log.error("Failed to replay CELL_SET op", e);
        }
    }
}
