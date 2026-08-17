const { Client } = require('@stomp/stompjs');
const WebSocket = require('ws');
const crypto = require('crypto');

// Helpers
const generateUUID = () => crypto.randomUUID();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
    const userId = generateUUID();
    const sheetId = generateUUID();

    console.log(`\n--- Setup ---`);
    console.log(`User ID: ${userId}`);
    console.log(`Sheet ID: ${sheetId}`);

    // 1. Get dev token
    const authRes = await fetch(`http://localhost:8080/api/auth/dev-token?userId=${userId}`);
    const token = await authRes.text();
    console.log(`[HTTP] Retrieved token for user`);

    // We can't automatically add the user to the sheet in the DB from this script without a dedicated endpoint or DB connection,
    // so we'll expect the user to have done it, or we'll just test the rejection.
    console.log(`\n>>> NOTE: To test successful ops or mid-session revocation, you MUST manually insert this user into sheet_members:`);
    console.log(`INSERT INTO sheet_members (sheet_id, user_id) VALUES ('${sheetId}', '${userId}');`);
    console.log(`Waiting 10 seconds for you to run the SQL insert if you want to test success...`);
    await sleep(10000);

    // 2. Connect STOMP
    console.log(`\n--- Connecting to WebSocket ---`);
    const client = new Client({
        brokerURL: 'ws://localhost:8080/ws',
        connectHeaders: {
            Authorization: `Bearer ${token}`,
        },
        webSocketFactory: () => new WebSocket('ws://localhost:8080/ws')
    });

    client.onConnect = async (frame) => {
        console.log(`[STOMP] Connected successfully!`);

        // Subscribe to errors
        client.subscribe('/user/queue/errors', (message) => {
            console.log(`\n[STOMP ERROR RECEIVED] /user/queue/errors:`, message.body);
        });

        // Subscribe to sheet updates
        client.subscribe(`/topic/sheet/${sheetId}`, (message) => {
            console.log(`\n[STOMP BROADCAST RECEIVED] /topic/sheet/${sheetId}:`, message.body);
        });

        await sleep(500); // Wait for subs to register

        // Test 1: Oversized Payload
        console.log(`\n--- Test: Oversized Payload ---`);
        const bigOp = {
            sheetId,
            opId: generateUUID(),
            opType: 'CELL_SET',
            value: 'A'.repeat(2001),
            hlc: { physicalTime: Date.now(), logicalCounter: 0, replicaId: generateUUID() }
        };
        client.publish({ destination: `/app/sheet/${sheetId}/op`, body: JSON.stringify(bigOp) });
        await sleep(1000);

        // Test 2: HLC Future Skew
        console.log(`\n--- Test: HLC Future Skew ---`);
        const futureOp = {
            sheetId,
            opId: generateUUID(),
            opType: 'CELL_SET',
            value: '{"rowId":"1", "colId":"1", "value":"test"}',
            hlc: { physicalTime: Date.now() + 600000, logicalCounter: 0, replicaId: generateUUID() }
        };
        client.publish({ destination: `/app/sheet/${sheetId}/op`, body: JSON.stringify(futureOp) });
        await sleep(1000);

        // Test 3: Normal Op (If you ran the SQL insert, this broadcasts. If not, it fails auth).
        console.log(`\n--- Test: Normal Op ---`);
        const normalOp = {
            sheetId,
            opId: generateUUID(),
            opType: 'CELL_SET',
            value: '{"rowId":"1", "colId":"1", "value":"test"}',
            hlc: { physicalTime: Date.now(), logicalCounter: 0, replicaId: generateUUID() }
        };
        client.publish({ destination: `/app/sheet/${sheetId}/op`, body: JSON.stringify(normalOp) });
        
        console.log(`\nWaiting 15 seconds. If you ran the SQL insert, try deleting the DB row now to test mid-session revocation!`);
        console.log(`DELETE FROM sheet_members WHERE user_id = '${userId}';`);
        
        for (let i = 15; i > 0; i--) {
            process.stdout.write(`${i}... `);
            await sleep(1000);
        }
        console.log();

        // Test 4: Second Normal Op (Should be rejected if DB row deleted)
        console.log(`\n--- Test: Post-Revocation Op ---`);
        const normalOp2 = { ...normalOp, opId: generateUUID(), value: '{"rowId":"1", "colId":"2", "value":"test2"}' };
        client.publish({ destination: `/app/sheet/${sheetId}/op`, body: JSON.stringify(normalOp2) });
        await sleep(1000);

        client.deactivate();
        console.log(`\n[STOMP] Disconnected.`);
    };

    client.onStompError = (frame) => {
        console.log('\n[STOMP PROTOCOL ERROR]', frame.headers['message']);
        console.log('Details:', frame.body);
    };

    client.activate();
}

run().catch(console.error);
