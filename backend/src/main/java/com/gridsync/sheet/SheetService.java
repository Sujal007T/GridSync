package com.gridsync.sheet;

import com.gridsync.crdt.CellValue;
import com.gridsync.crdt.CrdtMerger;
import com.gridsync.persistence.GridStateEntity;
import com.gridsync.persistence.GridStateId;
import com.gridsync.persistence.GridStateRepository;
import com.gridsync.persistence.OpLogEntity;
import com.gridsync.persistence.OpLogRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

@Service
public class SheetService {

    private final OpLogRepository opLogRepository;
    private final GridStateRepository gridStateRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SheetService(OpLogRepository opLogRepository, GridStateRepository gridStateRepository) {
        this.opLogRepository = opLogRepository;
        this.gridStateRepository = gridStateRepository;
    }

    @Transactional
    public void applyOpTransactional(Op op) {
        int inserted = opLogRepository.insertOpLogIfNotExists(
            op.sheetId(), op.opId(), op.opType(), op.payload(),
            op.hlc().physicalTime(), op.hlc().logicalCounter(), op.hlc().replicaId()
        );

        if (inserted == 0) {
            return;
        }

        if ("CELL_SET".equals(op.opType())) {
            try {
                JsonNode payloadNode = objectMapper.readTree(op.payload());
                UUID rowId = UUID.fromString(payloadNode.get("rowId").asText());
                UUID colId = UUID.fromString(payloadNode.get("colId").asText());
                String value = payloadNode.has("value") ? payloadNode.get("value").asText() : "";

                CellValue incomingCell = new CellValue(value, op.hlc(), op.hlc().replicaId());

                // First, attempt a blind insert. If it succeeds (returns 1), there was no previous state, and we won the race.
                int gridInserted = gridStateRepository.insertGridStateIfNotExists(
                    op.sheetId(), rowId, colId, value,
                    op.hlc().physicalTime(), op.hlc().logicalCounter(), op.hlc().replicaId()
                );

                if (gridInserted == 0) {
                    // A row already exists. Fall back to pessimistic lock + CrdtMerger.merge()
                    GridStateEntity existing = gridStateRepository.findWithLockBySheetIdAndRowIdAndColId(op.sheetId(), rowId, colId)
                        .orElseThrow(() -> new IllegalStateException("Row was present but could not be locked."));

                    CellValue merged = CrdtMerger.merge(existing.toCellValue(), incomingCell);
                    gridStateRepository.save(new GridStateEntity(op.sheetId(), rowId, colId, merged));
                }

            } catch (Exception e) {
                throw new RuntimeException("Failed to process CELL_SET payload", e);
            }
        }
    }
}
