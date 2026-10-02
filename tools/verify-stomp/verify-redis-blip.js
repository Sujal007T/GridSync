const { Client } = require('@stomp/stompjs');
const { WebSocket } = require('ws');
const { execSync } = require('child_process');

Object.assign(global, { WebSocket });

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const sheetId = "00000000-0000-0000-0000-000000000001";
const userIdA = "10000000-0000-0000-0000-000000000001";
const userIdB = "20000000-0000-0000-0000-000000000002";

async function getDevToken(userId) {
    const res = await fetch(`http://localhost:8081/api/auth/dev-token?userId=${userId}`, { method: 'POST' });
    const data = await res.json();
    return data.token;
}

function createClient(port, token) {
    return new Client({
        brokerURL: `ws://localhost:${port}/ws-grid/websocket`,
        connectHeaders: { Authorization: `Bearer ${token}` },
        reconnectDelay: 0, 
        webSocketFactory: () => new WebSocket(`ws://localhost:${port}/ws-grid/websocket`),
        debug: function (str) { /* console.log(str); */ }
    });
}

async function runTest() {
    const tokenA = await getDevToken(userIdA);
    const tokenB = await getDevToken(userIdB);

    console.log(`\n--- Redis-Blip Resilience Test (End-to-End Reconnect) ---`);

    const clientA = createClient(8081, tokenA);
    const clientB = createClient(8082, tokenB);

    const opId = generateUUID();
    const cellRow = generateUUID();
    const cellCol = generateUUID();

    // Client B's local state
    let stateB = {};
    let clientBLastSeenSeq = 0;

    await new Promise((resolve, reject) => {
        let connectedCount = 0;
        
        const checkConnected = async () => {
            if (++connectedCount === 2) {
                console.log(`[SYSTEM] Both clients connected.`);
                
                // 1. Stop Redis to drop connections immediately
                console.log(`[SYSTEM] Stopping Redis (docker stop gridsync-redis-1)...`);
                execSync('docker stop gridsync-redis-1');

                // 2. Client A submits op
                const op = {
                    sheetId,
                    opId,
                    opType: 'CELL_SET',
                    payload: JSON.stringify({
                        rowId: cellRow,
                        colId: cellCol,
                        value: 'BlipTest'
                    }),
                    hlc: { physicalTime: Date.now(), logicalCounter: 0, replicaId: generateUUID() }
                };

                console.log(`[A] Publishing op while Redis is paused...`);
                clientA.publish({ destination: `/app/sheet/${sheetId}/op`, body: JSON.stringify(op) });

                // Wait for the 1000ms Redis timeout to fire and backend to finish handling it.
                setTimeout(() => {
                    // 3. Start Redis again
                    console.log(`[SYSTEM] Starting Redis (docker start gridsync-redis-1)...`);
                    execSync('docker start gridsync-redis-1');

                    setTimeout(() => resolve(), 4000);
                }, 2000);
            }
        };

        clientA.onConnect = () => {
            console.log(`[A] Connected to backend-1`);
            checkConnected();
        };
        clientA.onWebSocketError = (e) => reject(e);
        
        clientB.onConnect = () => {
            console.log(`[B] Connected to backend-2`);
            clientB.subscribe(`/topic/sheet/${sheetId}`, (msg) => {
                const body = JSON.parse(msg.body);
                console.log(`[B] Received broadcast:`, body.opId);
                // Note: It shouldn't receive the op here because the broadcast failed
            });
            checkConnected();
        };
        clientB.onWebSocketError = (e) => reject(e);

        clientA.activate();
        clientB.activate();
    });

    // 4. Simulate Client B reconnecting and running its frontend catch-up flow
    console.log(`\n[B] Simulating STOMP disconnect...`);
    clientB.deactivate();

    await new Promise(r => setTimeout(r, 1000));

    console.log(`[B] Simulating STOMP reconnect flow...`);
    
    await new Promise((resolve) => {
        clientB.onConnect = async () => {
            console.log(`[B] Reconnected. Fetching catch-up ops since seq ${clientBLastSeenSeq}...`);
            
            // This replicates _fetchCatchUpOps in stompClient.ts
            const res = await fetch(`http://localhost:8082/api/sheets/${sheetId}/ops?sinceSeq=${clientBLastSeenSeq}`, {
                headers: { 'Authorization': `Bearer ${tokenB}` }
            });
            
            const ops = await res.json();
            console.log(`[B] CatchUp returned ${ops.length} ops.`);
            
            if (ops.length > 0) {
                clientBLastSeenSeq = Math.max(...ops.map(o => o.seq));
                
                ops.forEach(o => {
                    const payload = JSON.parse(o.payload);
                    stateB[`${payload.rowId}:${payload.colId}`] = payload.value;
                });
            }
            
            const foundSpecificOp = ops.some(o => o.opId === opId);
            if (foundSpecificOp) {
                console.log(`[B] ✅ Verified: Catch-up successfully contained the specific opId (${opId}) that was published while Redis was down.`);
            } else {
                console.log(`[B] ❌ Error: Catch-up did NOT contain the specific opId (${opId}).`);
                process.exit(1);
            }
            resolve();
        };
        clientB.activate();
    });

    clientA.deactivate();
    clientB.deactivate();

    if (stateB[`${cellRow}:${cellCol}`] === 'BlipTest') {
        console.log(`\n✅ SUCCESS: End-to-end self-healing verified! Client B automatically fetched and merged the missed op upon reconnect.`);
    } else {
        console.log(`\n❌ FAILED: Client B's local state did not receive the missed op.`);
        process.exit(1);
    }
}

runTest().catch(console.error);
