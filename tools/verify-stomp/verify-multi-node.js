const { Client } = require('@stomp/stompjs');
const WebSocket = require('ws');
const crypto = require('crypto');

const generateUUID = () => crypto.randomUUID();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getDevToken(userId) {
    const res = await fetch(`http://localhost:80/api/auth/dev-token?userId=${userId}`, { method: 'POST' });
    const data = await res.json();
    return data.token;
}

function createClient(port, token) {
    const client = new Client({
        brokerURL: `ws://localhost:${port}/ws-grid/websocket`,
        connectHeaders: { Authorization: `Bearer ${token}` },
        webSocketFactory: () => new WebSocket(`ws://localhost:${port}/ws-grid/websocket`)
    });
    client.onWebSocketError = (event) => console.error(`[WS Error Port ${port}]`, event);
    client.onStompError = (frame) => console.error(`[STOMP Error Port ${port}]`, frame);
    return client;
}

async function run() {
    const userIdA = generateUUID();
    const userIdB = generateUUID();
    // Use the well-known dev sheetId to ensure auth passes without manual DB inserts
    const sheetId = "00000000-0000-0000-0000-000000000001";

    const tokenA = await getDevToken(userIdA);
    const tokenB = await getDevToken(userIdB);

    console.log(`\n--- Cross-Node Relay Verification ---`);
    console.log(`Client A (Port 8081 - backend-1)`);
    console.log(`Client B (Port 8082 - backend-2)`);

    const clientA = createClient(8081, tokenA);
    const clientB = createClient(8082, tokenB);

    let clientBReceivedOp = false;

    await new Promise((resolve) => {
        clientA.onConnect = () => {
            console.log(`[A] Connected to backend-1`);
            clientB.activate();
        };
        clientB.onConnect = () => {
            console.log(`[B] Connected to backend-2`);
            
            clientB.subscribe(`/topic/sheet/${sheetId}`, (msg) => {
                const body = JSON.parse(msg.body);
                console.log(`[B] Received broadcast from topic:`, body);
                if (body.payload && JSON.parse(body.payload).value === "CrossNodeTest") {
                    clientBReceivedOp = true;
                }
            });

            setTimeout(() => {
                const op = {
                    sheetId,
                    opId: generateUUID(),
                    opType: 'CELL_SET',
                    payload: JSON.stringify({
                        rowId: generateUUID(),
                        colId: generateUUID(),
                        value: 'CrossNodeTest'
                    }),
                    hlc: { physicalTime: Date.now(), logicalCounter: 0, replicaId: generateUUID() }
                };
                console.log(`[A] Publishing op to backend-1...`);
                clientA.publish({ destination: `/app/sheet/${sheetId}/op`, body: JSON.stringify(op) });
            }, 1000);
            
            setTimeout(() => {
                resolve();
            }, 3000);
        };
        
        clientA.activate();
    });

    clientA.deactivate();
    clientB.deactivate();

    if (clientBReceivedOp) {
        console.log(`\n✅ SUCCESS: Client B (backend-2) successfully received Client A's (backend-1) broadcast via Redis Relay!`);
    } else {
        console.log(`\n❌ FAILED: Client B did not receive the cross-node broadcast.`);
        process.exit(1);
    }

    console.log(`\n--- Stage 5: Scrambled/Randomized Multi-Op Convergence Check ---`);
    const clientDirectA = createClient(8081, tokenA);
    const clientDirectB = createClient(8082, tokenB);

    const stateA = {};
    const stateB = {};
    const expectedState = {};

    function compareHlc(hlcA, hlcB) {
        if (hlcA.physicalTime !== hlcB.physicalTime) return hlcA.physicalTime > hlcB.physicalTime ? 1 : -1;
        if (hlcA.logicalCounter !== hlcB.logicalCounter) return hlcA.logicalCounter > hlcB.logicalCounter ? 1 : -1;
        if (hlcA.replicaId && hlcB.replicaId) return hlcA.replicaId > hlcB.replicaId ? 1 : (hlcA.replicaId < hlcB.replicaId ? -1 : 0);
        return hlcA.replicaId ? 1 : (hlcB.replicaId ? -1 : 0);
    }

    function crdtMerge(a, b) {
        if (!a) return b;
        if (!b) return a;
        const cmp = compareHlc(a.hlc, b.hlc);
        if (cmp !== 0) return cmp > 0 ? a : b;
        return a.hlc.replicaId > b.hlc.replicaId ? a : b;
    }

    function applyOp(state, opPayloadStr, hlc) {
        const payload = JSON.parse(opPayloadStr);
        const cellId = `${payload.rowId}:${payload.colId}`;
        const incomingCell = { value: payload.value, hlc };
        state[cellId] = crdtMerge(state[cellId], incomingCell);
    }

    // Generate Scrambled Ops
    const numOps = 20;
    const numCells = 5;
    const rowIds = Array.from({length: numCells}, generateUUID);
    const colIds = Array.from({length: numCells}, generateUUID);
    
    const ops = [];
    const baseTime = Date.now();
    for(let i=0; i<numOps; i++) {
        const cellIdx = Math.floor(Math.random() * numCells);
        const op = {
            sheetId, opId: generateUUID(), opType: 'CELL_SET',
            payload: JSON.stringify({ rowId: rowIds[cellIdx], colId: colIds[cellIdx], value: `Val-${i}` }),
            // Randomly scatter physical time and logical counter to create conflicts and non-sequential states
            hlc: { physicalTime: baseTime + Math.floor(Math.random() * 1000), logicalCounter: Math.floor(Math.random() * 10), replicaId: generateUUID() }
        };
        ops.push(op);
        
        // Compute the expected state offline
        const payloadObj = JSON.parse(op.payload);
        const cellId = `${payloadObj.rowId}:${payloadObj.colId}`;
        expectedState[cellId] = crdtMerge(expectedState[cellId], { value: payloadObj.value, hlc: op.hlc });
    }

    // Shuffle the ops array so A and B send them out of order
    const opsForA = [...ops].sort(() => Math.random() - 0.5).slice(0, numOps / 2);
    const opsForB = [...ops].filter(o => !opsForA.includes(o)).sort(() => Math.random() - 0.5);

    await new Promise((resolve) => {
        let connected = 0;
        const checkConnected = () => {
            if (++connected === 2) {
                console.log(`[STAGE 5] Both clients connected (A->8081, B->8082).`);
                
                clientDirectA.subscribe(`/topic/sheet/${sheetId}`, (msg) => {
                    const body = JSON.parse(msg.body);
                    applyOp(stateA, body.payload, body.hlc);
                });

                clientDirectB.subscribe(`/topic/sheet/${sheetId}`, (msg) => {
                    const body = JSON.parse(msg.body);
                    applyOp(stateB, body.payload, body.hlc);
                });

                setTimeout(() => {
                    console.log(`[STAGE 5] Firing ${numOps} scrambled concurrent edits across both nodes...`);
                    opsForA.forEach(o => clientDirectA.publish({ destination: `/app/sheet/${sheetId}/op`, body: JSON.stringify(o) }));
                    opsForB.forEach(o => clientDirectB.publish({ destination: `/app/sheet/${sheetId}/op`, body: JSON.stringify(o) }));
                }, 1000);

                setTimeout(() => resolve(), 4000);
            }
        };

        clientDirectA.onConnect = checkConnected;
        clientDirectB.onConnect = checkConnected;
        
        clientDirectA.activate();
        clientDirectB.activate();
    });

    clientDirectA.deactivate();
    clientDirectB.deactivate();

    function deepEqual(obj1, obj2) {
        const keys1 = Object.keys(obj1).sort();
        const keys2 = Object.keys(obj2).sort();
        if (keys1.length !== keys2.length) return false;
        for (let i = 0; i < keys1.length; i++) {
            if (keys1[i] !== keys2[i]) return false;
            if (JSON.stringify(obj1[keys1[i]]) !== JSON.stringify(obj2[keys2[i]])) return false;
        }
        return true;
    }

    const isConverged = deepEqual(stateA, stateB);
    const matchesExpected = deepEqual(stateA, expectedState);

    if (isConverged && matchesExpected) {
        console.log(`\n✅ SUCCESS: Stage 5 Multi-Op Convergence Verified!`);
        console.log(`Both clients converged perfectly to the expected CRDT state across ${numOps} ops and ${numCells} cells.`);
    } else {
        console.log(`\n❌ FAILED: Convergence failed.`);
        if (!isConverged) {
            console.log(`Mismatch between Client A and Client B.`);
            console.log(`State A:`, JSON.stringify(stateA, null, 2));
            console.log(`State B:`, JSON.stringify(stateB, null, 2));
        }
        if (!matchesExpected) {
            console.log(`Mismatch between final state and expected CRDT state.`);
            console.log(`State A:`, JSON.stringify(stateA, null, 2));
            console.log(`Expected:`, JSON.stringify(expectedState, null, 2));
        }
        process.exit(1);
    }
}

run().catch(console.error);
