/**
 * stompClient.ts — STOMP/SockJS connection service with:
 *  - Custom exponential backoff + jitter reconnect (NOT the library's fixed reconnectDelay)
 *  - lastSeenSeq tracking for catch-up on reconnect
 *  - Reconnect flow: fetch missed ops via REST, then replay IndexedDB pending ops
 */

import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { HybridLogicalClock } from '../crdt/HybridLogicalClock';
import { getAllPendingOps } from './offlineQueue';

export interface Op {
  sheetId: string;
  opId: string;
  opType: string;
  payload: string;
  hlc: HybridLogicalClock;
}

// Shape returned by GET /api/sheets/{sheetId}/ops
export interface OpLogDto {
  seq: number;
  opId: string;
  opType: string;
  payload: string;
  hlcPhysical: number;
  hlcLogical: number;
  replicaId: string;
}

export type MessageCallback = (op: Op) => void;
export type ErrorCallback = (opId: string, errorMsg: string) => void;
export type CatchUpCallback = (ops: OpLogDto[]) => void;

// ─── Backoff configuration ────────────────────────────────────────────────────
const BACKOFF_BASE_MS = 1_000;          // 1 second base
const BACKOFF_MAX_MS  = 30_000;         // 30 second cap
const BACKOFF_JITTER  = 0.25;           // ±25% random jitter

/**
 * Computes the delay for reconnect attempt `attempt` (0-indexed):
 *   delay = min(base * 2^attempt, max) * (1 ± jitter)
 *
 * This prevents thundering-herd: if 100 clients all disconnect simultaneously,
 * jitter spreads their reconnect attempts over a window instead of hammering the
 * server at the exact same millisecond.
 */
export function computeBackoffMs(attempt: number): number {
  const exponential = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
  const jitterRange = exponential * BACKOFF_JITTER;
  const jitter = (Math.random() * 2 - 1) * jitterRange; // uniform in [-jitterRange, +jitterRange]
  return Math.round(exponential + jitter);
}

class StompClientService {
  private client: Client | null = null;
  private token: string | null = null;
  private sheetId: string | null = null;
  private onMessageCb: MessageCallback | null = null;
  private onErrorCb: ErrorCallback | null = null;
  private onCatchUpCb: CatchUpCallback | null = null;

  /** Last seq the client has successfully processed. Updated on every received broadcast. */
  lastSeenSeq: number = 0;

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isIntentionalDisconnect = false;

  connect(
    sheetId: string,
    token: string,
    onMessage: MessageCallback,
    onError: ErrorCallback,
    onCatchUp: CatchUpCallback,
    onConnectedCallback?: () => void
  ) {
    this.sheetId = sheetId;
    this.token = token;
    this.onMessageCb = onMessage;
    this.onErrorCb = onError;
    this.onCatchUpCb = onCatchUp;
    this.isIntentionalDisconnect = false;
    this.reconnectAttempt = 0;

    this._createAndActivate(onConnectedCallback);
  }

  private _createAndActivate(onConnectedCallback?: () => void) {
    // Disable the library's built-in reconnect entirely — we manage it ourselves
    // with custom exponential backoff so we can integrate the catch-up flow.
    this.client = new Client({
      webSocketFactory: () => new SockJS('http://localhost:8080/ws'),
      connectHeaders: {
        Authorization: `Bearer ${this.token}`
      },
      debug: (str) => console.log('STOMP: ' + str),
      // Set to 0 to DISABLE the library's built-in reconnect.
      // Our onDisconnect handler drives reconnection instead.
      reconnectDelay: 0,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
    });

    this.client.onConnect = async (frame) => {
      console.log('[STOMP] Connected, attempt was:', this.reconnectAttempt);
      this.reconnectAttempt = 0; // reset backoff on successful connect

      // Subscribe to sheet broadcast
      this.client?.subscribe(`/topic/sheet/${this.sheetId}`, (message) => {
        if (message.body) {
          const op: Op = JSON.parse(message.body);
          // Track the seq if the server includes it (it currently echoes the Op object;
          // the OpLogDto seq comes from the catch-up endpoint instead)
          this.onMessageCb?.(op);
        }
      });

      // Subscribe to user-specific error queue
      this.client?.subscribe('/user/queue/errors', (message) => {
        if (message.body) {
          try {
            const errorPayload = JSON.parse(message.body);
            this.onErrorCb?.(errorPayload.opId, errorPayload.error);
          } catch (e) {
            console.error('[STOMP] Failed to parse error payload', e);
          }
        }
      });

      // ─── Reconnect flow ───────────────────────────────────────────────────
      // Step 1: Fetch ops missed while offline from the catch-up REST endpoint.
      await this._fetchCatchUpOps();

      // Step 2: Replay pending local ops from IndexedDB.
      // These may overlap with the catch-up ops (lost-ack case): the backend's
      // ON CONFLICT DO NOTHING on op_id makes double-sends safe.
      await this._replayPendingOps();
      // ─────────────────────────────────────────────────────────────────────

      onConnectedCallback?.();
    };

    this.client.onDisconnect = () => {
      if (!this.isIntentionalDisconnect) {
        console.log('[STOMP] Disconnected unexpectedly, scheduling reconnect...');
        this._scheduleReconnect(onConnectedCallback);
      }
    };

    this.client.onStompError = (frame) => {
      console.error('[STOMP] Broker error:', frame.headers['message'], frame.body);
      // STOMP-level errors (e.g. auth failure) are not transient — don't reconnect endlessly.
      // The onDisconnect handler will fire afterward if needed.
    };

    this.client.activate();
  }

  private _scheduleReconnect(onConnectedCallback?: () => void) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    const delay = computeBackoffMs(this.reconnectAttempt);
    this.reconnectAttempt++;
    console.log(`[STOMP] Reconnect attempt ${this.reconnectAttempt} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      if (!this.isIntentionalDisconnect) {
        this._createAndActivate(onConnectedCallback);
      }
    }, delay);
  }

  private async _fetchCatchUpOps() {
    if (!this.sheetId || !this.token) return;
    try {
      const res = await fetch(
        `/api/sheets/${this.sheetId}/ops?sinceSeq=${this.lastSeenSeq}`,
        { headers: { Authorization: `Bearer ${this.token}` } }
      );
      if (!res.ok) {
        console.warn('[CatchUp] Fetch failed:', res.status);
        return;
      }
      const ops: OpLogDto[] = await res.json();
      if (ops.length > 0) {
        console.log(`[CatchUp] Replaying ${ops.length} missed ops since seq ${this.lastSeenSeq}`);
        this.onCatchUpCb?.(ops);
        // Update lastSeenSeq to the highest seq we just processed
        this.lastSeenSeq = Math.max(...ops.map(o => o.seq));
      }
    } catch (err) {
      console.error('[CatchUp] Error fetching catch-up ops:', err);
    }
  }

  private async _replayPendingOps() {
    const pending = await getAllPendingOps();
    if (pending.length === 0) return;

    console.log(`[CatchUp] Replaying ${pending.length} pending local ops from IndexedDB`);
    for (const op of pending) {
      this.sendOp(op);
    }
    // NOTE: We do NOT clear the queue here. Each op is removed from the queue
    // inside applyRemoteOp() when the server echoes it back, confirming receipt.
    // This ensures that if the connection drops again before all acks arrive,
    // the ops remain in the queue for the next reconnect attempt.
  }

  disconnect() {
    this.isIntentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      this.client.deactivate();
      this.client = null;
    }
  }

  sendOp(op: Op) {
    if (!this.client || !this.client.connected) {
      console.warn('[STOMP] Cannot send op, client not connected — op is in IndexedDB queue');
      return;
    }
    this.client.publish({
      destination: `/app/sheet/${op.sheetId}/op`,
      body: JSON.stringify(op)
    });
  }

  /** Called by the store when a remote op's seq is known, to advance lastSeenSeq. */
  updateLastSeenSeq(seq: number) {
    if (seq > this.lastSeenSeq) {
      this.lastSeenSeq = seq;
    }
  }
}

export const stompClient = new StompClientService();
