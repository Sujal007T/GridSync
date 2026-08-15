package com.gridsync.sheet;

import com.gridsync.TestcontainersConfiguration;
import com.gridsync.crdt.HybridLogicalClock;
import com.gridsync.persistence.GridStateRepository;
import com.gridsync.persistence.OpLogRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import java.time.Clock;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class SheetServiceTest {

    @Autowired
    private SheetService sheetService;

    @Autowired
    private OpLogRepository opLogRepository;

    @Autowired
    private GridStateRepository gridStateRepository;

    @Test
    void testApplyOpIdempotency() {
        UUID sheetId = UUID.randomUUID();
        UUID opId = UUID.randomUUID();
        UUID replicaId = UUID.randomUUID();
        UUID rowId = UUID.randomUUID();
        UUID colId = UUID.randomUUID();
        
        HybridLogicalClock hlc = HybridLogicalClock.now(replicaId, Clock.systemUTC());
        String payload = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"test\"}", rowId, colId);
        Op op = new Op(sheetId, opId, "CELL_SET", payload, hlc);
        
        long opLogCountBefore = opLogRepository.count();
        long gridStateCountBefore = gridStateRepository.count();
        
        sheetService.applyOpTransactional(op);
        
        assertEquals(opLogCountBefore + 1, opLogRepository.count());
        assertEquals(gridStateCountBefore + 1, gridStateRepository.count());
        
        // Second application with identical opId should be a no-op
        sheetService.applyOpTransactional(op);
        
        assertEquals(opLogCountBefore + 1, opLogRepository.count());
        assertEquals(gridStateCountBefore + 1, gridStateRepository.count());
    }

    @Test
    void testApplyOpConcurrentFirstInsertRace() throws InterruptedException {
        UUID sheetId = UUID.randomUUID();
        UUID rowId = UUID.randomUUID();
        UUID colId = UUID.randomUUID();
        
        UUID replica1 = UUID.randomUUID();
        UUID replica2 = UUID.randomUUID();
        
        // Both threads are trying to insert to a brand-new cell.
        // replica1 has higher physical time
        HybridLogicalClock hlc1 = new HybridLogicalClock(1000, 0, replica1);
        HybridLogicalClock hlc2 = new HybridLogicalClock(900, 0, replica2);
        
        String payload1 = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"val1\"}", rowId, colId);
        String payload2 = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"val2\"}", rowId, colId);
        
        // They must have different opIds so op_log idempotency doesn't block the second one
        Op op1 = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload1, hlc1);
        Op op2 = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload2, hlc2);
        
        java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(2);
        
        java.util.concurrent.atomic.AtomicReference<Exception> e1 = new java.util.concurrent.atomic.AtomicReference<>();
        java.util.concurrent.atomic.AtomicReference<Exception> e2 = new java.util.concurrent.atomic.AtomicReference<>();
        
        Thread t1 = new Thread(() -> {
            try {
                sheetService.applyOpTransactional(op1);
            } catch (Exception e) {
                e1.set(e);
            } finally {
                latch.countDown();
            }
        });
        Thread t2 = new Thread(() -> {
            try {
                sheetService.applyOpTransactional(op2);
            } catch (Exception e) {
                e2.set(e);
            } finally {
                latch.countDown();
            }
        });
        
        t1.start();
        t2.start();
        
        latch.await(5, java.util.concurrent.TimeUnit.SECONDS);
        
        org.junit.jupiter.api.Assertions.assertNull(e1.get(), "Thread 1 threw exception: " + e1.get());
        org.junit.jupiter.api.Assertions.assertNull(e2.get(), "Thread 2 threw exception: " + e2.get());
        
        // CrdtMerger should resolve to the one with the highest HLC (op1 with physical time 1000)
        com.gridsync.persistence.GridStateId id = new com.gridsync.persistence.GridStateId(sheetId, rowId, colId);
        com.gridsync.persistence.GridStateEntity finalState = gridStateRepository.findById(id).orElseThrow();
        assertEquals("val1", finalState.toCellValue().value(), "Merger should have produced val1 from the higher HLC");
    }

    @Test
    void testApplyOpConcurrentLostUpdate() throws InterruptedException {
        // Prepare an existing row to test the pure update path
        UUID sheetId = UUID.randomUUID();
        UUID rowId = UUID.randomUUID();
        UUID colId = UUID.randomUUID();
        UUID baseReplica = UUID.randomUUID();
        
        HybridLogicalClock hlcBase = new HybridLogicalClock(800, 0, baseReplica);
        String payloadBase = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"base\"}", rowId, colId);
        Op opBase = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payloadBase, hlcBase);
        sheetService.applyOpTransactional(opBase);
        
        // Now run the concurrent update race exactly as before
        UUID replica1 = UUID.randomUUID();
        UUID replica2 = UUID.randomUUID();
        
        HybridLogicalClock hlc1 = new HybridLogicalClock(1000, 0, replica1);
        HybridLogicalClock hlc2 = new HybridLogicalClock(900, 0, replica2);
        
        String payload1 = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"val1\"}", rowId, colId);
        String payload2 = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"val2\"}", rowId, colId);
        
        Op op1 = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload1, hlc1);
        Op op2 = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload2, hlc2);
        
        java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(2);
        
        Thread t1 = new Thread(() -> {
            sheetService.applyOpTransactional(op1);
            latch.countDown();
        });
        Thread t2 = new Thread(() -> {
            sheetService.applyOpTransactional(op2);
            latch.countDown();
        });
        
        t1.start();
        t2.start();
        
        latch.await(5, java.util.concurrent.TimeUnit.SECONDS);
        
        com.gridsync.persistence.GridStateId id = new com.gridsync.persistence.GridStateId(sheetId, rowId, colId);
        com.gridsync.persistence.GridStateEntity finalState = gridStateRepository.findById(id).orElseThrow();
        assertEquals("val1", finalState.toCellValue().value());
    }

    @Test
    void testApplyOpConcurrentIdempotency() throws InterruptedException {
        UUID sheetId = UUID.randomUUID();
        UUID opId = UUID.randomUUID();
        UUID replicaId = UUID.randomUUID();
        UUID rowId = UUID.randomUUID();
        UUID colId = UUID.randomUUID();
        
        HybridLogicalClock hlc = HybridLogicalClock.now(replicaId, Clock.systemUTC());
        String payload = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"test\"}", rowId, colId);
        Op op = new Op(sheetId, opId, "CELL_SET", payload, hlc);
        
        java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(2);
        
        java.util.concurrent.atomic.AtomicReference<Exception> e1 = new java.util.concurrent.atomic.AtomicReference<>();
        java.util.concurrent.atomic.AtomicReference<Exception> e2 = new java.util.concurrent.atomic.AtomicReference<>();
        
        Thread t1 = new Thread(() -> {
            try {
                sheetService.applyOpTransactional(op);
            } catch (Exception e) {
                e1.set(e);
            } finally {
                latch.countDown();
            }
        });
        Thread t2 = new Thread(() -> {
            try {
                sheetService.applyOpTransactional(op);
            } catch (Exception e) {
                e2.set(e);
            } finally {
                latch.countDown();
            }
        });
        
        t1.start();
        t2.start();
        
        latch.await(5, java.util.concurrent.TimeUnit.SECONDS);
        
        org.junit.jupiter.api.Assertions.assertNull(e1.get(), "Thread 1 threw exception: " + e1.get());
        org.junit.jupiter.api.Assertions.assertNull(e2.get(), "Thread 2 threw exception: " + e2.get());
        
        long count = opLogRepository.countBySheetIdAndOpId(sheetId, opId);
        assertEquals(1, count, "Should have exactly one row for the given opId");
        
        // Prove connection isn't poisoned by running another distinct op
        UUID newOpId = UUID.randomUUID();
        HybridLogicalClock hlcNew = HybridLogicalClock.now(replicaId, Clock.systemUTC());
        Op newOp = new Op(sheetId, newOpId, "CELL_SET", payload, hlcNew);
        
        sheetService.applyOpTransactional(newOp);
        
        assertEquals(1, opLogRepository.countBySheetIdAndOpId(sheetId, newOpId), "New op should be successfully inserted");
    }
}
