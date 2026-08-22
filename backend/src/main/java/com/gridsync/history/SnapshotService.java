package com.gridsync.history;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gridsync.persistence.GridStateEntity;
import com.gridsync.persistence.GridStateRepository;
import com.gridsync.persistence.OpLogRepository;
import com.gridsync.persistence.SnapshotEntity;
import com.gridsync.persistence.SnapshotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class SnapshotService {

    private static final Logger log = LoggerFactory.getLogger(SnapshotService.class);
    
    private final GridStateRepository gridStateRepository;
    private final OpLogRepository opLogRepository;
    private final SnapshotRepository snapshotRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SnapshotService(GridStateRepository gridStateRepository, 
                           OpLogRepository opLogRepository, 
                           SnapshotRepository snapshotRepository) {
        this.gridStateRepository = gridStateRepository;
        this.opLogRepository = opLogRepository;
        this.snapshotRepository = snapshotRepository;
    }

    /**
     * Executes asynchronously on the "snapshotExecutor".
     * Uses REPEATABLE_READ isolation to ensure that the read of grid_state matches the read of MAX(seq)
     * atomically, even if concurrent operations are being applied.
     */
    @Async("snapshotExecutor")
    @Transactional(isolation = Isolation.REPEATABLE_READ)
    public void createSnapshotIfNeeded(UUID sheetId) {
        try {
            long maxSeq = opLogRepository.findMaxSeqBySheetId(sheetId);
            if (maxSeq == 0) {
                return; // Nothing to snapshot
            }

            var lastSnapshot = snapshotRepository.findFirstBySheetIdOrderBySeqDesc(sheetId);
            if (lastSnapshot.isPresent() && (maxSeq - lastSnapshot.get().getSeq()) < 500) {
                log.debug("Skipping snapshot for sheet {} at seq {} (too soon after seq {})", sheetId, maxSeq, lastSnapshot.get().getSeq());
                return;
            }

            List<GridStateEntity> stateEntities = gridStateRepository.findAllBySheetId(sheetId);
            String stateJson = objectMapper.writeValueAsString(stateEntities);

            snapshotRepository.save(new SnapshotEntity(sheetId, maxSeq, stateJson));
            
            log.info("Created snapshot for sheet {} at seq {} containing {} cells", sheetId, maxSeq, stateEntities.size());

            // Retention Policy: retain 10 most recent snapshots. 
            // Note: op_log pruning is deferred to a future phase because deleting ops breaks the 
            // idempotency uniqueness constraint needed for safely ignoring offline resends of lost-ack ops.
            // Actual snapshot table pruning is also currently disabled per Phase 8 option (a).
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize grid state for snapshot", e);
        } catch (Exception e) {
            log.error("Error creating snapshot for sheet " + sheetId, e);
        }
    }
}
