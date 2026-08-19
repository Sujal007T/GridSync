/**
 * offlineQueue.ts — IndexedDB-backed pending-ops queue.
 *
 * Wraps the browser IndexedDB API using the `idb` promise library.
 * Each pending op is stored by its opId as the key, making it safe to
 * call enqueuePendingOp with the same opId more than once (idempotent upsert).
 *
 * The queue is the write-ahead log for the offline scenario:
 *   1. setCellValueOptimistic() enqueues the op before sending it over STOMP.
 *   2. applyRemoteOp() removes the op when the server's broadcast echoes it back
 *      (i.e. the server acknowledged and applied it).
 *   3. On reconnect, stompClient reads all pending ops and resends them.
 *      Because op_id has a UNIQUE constraint in the backend (ON CONFLICT DO NOTHING),
 *      resending an already-applied op is perfectly safe — it simply returns without
 *      re-applying, which is exactly the lost-ack recovery guarantee.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { Op } from './stompClient';

const DB_NAME = 'gridsync-offline';
const STORE_NAME = 'pendingOps';
const DB_VERSION = 1;

let _db: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // keyPath is opId so the store auto-deduplicates by operation identity
        db.createObjectStore(STORE_NAME, { keyPath: 'opId' });
      }
    },
  });
  return _db;
}

/** Stores op in IndexedDB. Idempotent: re-enqueuing the same opId is a no-op (put semantics). */
export async function enqueuePendingOp(op: Op): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, op);
}

/** Returns all pending ops in insertion order (IDB key order = opId string order). */
export async function getAllPendingOps(): Promise<Op[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

/** Removes a single op from the queue (called when server echo confirms receipt). */
export async function removePendingOp(opId: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, opId);
}

/** Clears all pending ops (called after a successful bulk-replay on reconnect). */
export async function clearPendingOps(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}
