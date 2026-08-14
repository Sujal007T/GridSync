package com.gridsync.crdt;

public class CrdtMerger {
    
    // TODO(Phase 4): validate incoming HLC physical time at the WS boundary, reject don't clamp
    public static CellValue merge(CellValue a, CellValue b) {
        int cmp = a.hlc().compareTo(b.hlc());
        if (cmp != 0) {
            return cmp > 0 ? a : b;
        }
        // tie on identical HLC: replicaId as deterministic tiebreak
        return a.replicaId().compareTo(b.replicaId()) > 0 ? a : b;
    }
}
