import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { HybridLogicalClock } from '../crdt/HybridLogicalClock';

export interface Op {
  sheetId: string;
  opId: string;
  opType: string;
  payload: string;
  hlc: HybridLogicalClock;
}

export type MessageCallback = (op: Op) => void;
export type ErrorCallback = (opId: string, errorMsg: string) => void;

class StompClientService {
  private client: Client | null = null;
  private currentSheetId: string | null = null;

  connect(
    sheetId: string,
    token: string,
    onMessage: MessageCallback,
    onError: ErrorCallback,
    onConnected?: () => void
  ) {
    this.currentSheetId = sheetId;

    this.client = new Client({
      // We must use webSocketFactory because the server is configured with SockJS
      webSocketFactory: () => new SockJS('http://localhost:8080/ws'),
      connectHeaders: {
        Authorization: `Bearer ${token}`
      },
      debug: function (str) {
        console.log('STOMP: ' + str);
      },
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
    });

    this.client.onConnect = (frame) => {
      console.log('Connected: ' + frame);

      // Subscribe to the sheet's broadcast topic
      this.client?.subscribe(`/topic/sheet/${sheetId}`, (message) => {
        if (message.body) {
          const op: Op = JSON.parse(message.body);
          onMessage(op);
        }
      });

      // Subscribe to user-specific error queue for rejections
      this.client?.subscribe('/user/queue/errors', (message) => {
        if (message.body) {
          try {
            const errorPayload = JSON.parse(message.body);
            onError(errorPayload.opId, errorPayload.error);
          } catch (e) {
            console.error('Failed to parse error payload', e);
          }
        }
      });

      if (onConnected) onConnected();
    };

    this.client.onStompError = (frame) => {
      console.error('Broker reported error: ' + frame.headers['message']);
      console.error('Additional details: ' + frame.body);
    };

    this.client.activate();
  }

  disconnect() {
    if (this.client) {
      this.client.deactivate();
      this.client = null;
    }
  }

  sendOp(op: Op) {
    if (!this.client || !this.client.connected) {
      console.warn('Cannot send OP, client not connected');
      // In a real offline implementation, we would queue this in IndexedDB here
      return;
    }

    this.client.publish({
      destination: `/app/sheet/${op.sheetId}/op`,
      body: JSON.stringify(op)
    });
  }
}

export const stompClient = new StompClientService();
