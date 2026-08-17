package com.gridsync.sheet;

import com.gridsync.TestcontainersConfiguration;
import com.gridsync.crdt.HybridLogicalClock;
import com.gridsync.security.JwtService;
import com.gridsync.security.SheetMemberEntity;
import com.gridsync.security.SheetMemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.web.socket.sockjs.client.SockJsClient;
import org.springframework.web.socket.sockjs.client.Transport;
import org.springframework.web.socket.sockjs.client.WebSocketTransport;

import java.lang.reflect.Type;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
public class WebSocketIntegrationTest {

    @LocalServerPort
    private int port;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private SheetMemberRepository sheetMemberRepository;

    private WebSocketStompClient stompClient;
    private String getWsPath() {
        return "ws://localhost:" + port + "/ws-grid";
    }

    @BeforeEach
    public void setup() {
        List<Transport> transports = new ArrayList<>(1);
        transports.add(new WebSocketTransport(new StandardWebSocketClient()));
        SockJsClient sockJsClient = new SockJsClient(transports);
        this.stompClient = new WebSocketStompClient(sockJsClient);
        this.stompClient.setMessageConverter(new MappingJackson2MessageConverter());
    }

    private StompSession connect(String token) throws ExecutionException, InterruptedException, TimeoutException {
        StompHeaders headers = new StompHeaders();
        if (token != null) {
            headers.add("Authorization", "Bearer " + token);
        }
        return stompClient.connectAsync(getWsPath(), new WebSocketHttpHeaders(), headers, new StompSessionHandlerAdapter() {}).get(5, TimeUnit.SECONDS);
    }

    @Test
    public void testConnectWithoutToken_rejected() {
        ExecutionException exception = assertThrows(ExecutionException.class, () -> connect(null));
        assertTrue(exception.getMessage().contains("Connection closed"), "Should reject connection");
    }

    @Test
    public void testConnectWithInvalidToken_rejected() {
        ExecutionException exception = assertThrows(ExecutionException.class, () -> connect("invalid_token"));
        assertTrue(exception.getMessage().contains("Connection closed"), "Should reject connection");
    }

    @Test
    public void testPayloadSizeLimit_ValidationWorks() throws Exception {
        UUID userId = UUID.randomUUID();
        String token = jwtService.generateDevToken(userId);
        StompSession session = connect(token);

        UUID sheetId = UUID.randomUUID();
        sheetMemberRepository.save(new SheetMemberEntity(sheetId, userId));

        // Create an oversized payload (e.g. > 2000 chars)
        String bigValue = "A".repeat(2001);
        String payload = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"%s\"}", UUID.randomUUID(), UUID.randomUUID(), bigValue);
        
        HybridLogicalClock hlc = HybridLogicalClock.now(UUID.randomUUID(), Clock.systemUTC());
        Op op = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload, hlc);

        BlockingQueue<String> errorQueue = new LinkedBlockingQueue<>();
        session.subscribe("/user/queue/errors", new org.springframework.messaging.simp.stomp.StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return java.util.Map.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                java.util.Map<String, String> map = (java.util.Map<String, String>) payload;
                errorQueue.offer(map.get("error"));
            }
        });

        // Wait a tiny bit for subscription to activate
        Thread.sleep(500);

        session.send("/app/sheet/" + sheetId + "/op", op);
        
        String errorMsg = errorQueue.poll(5, TimeUnit.SECONDS);
        assertNotNull(errorMsg, "Should receive an error frame");
        assertTrue(errorMsg.contains("Payload exceeds maximum allowed size"), "Error should mention payload size");
    }

    @Test
    public void testHlcFutureSkew_rejected() throws Exception {
        UUID userId = UUID.randomUUID();
        String token = jwtService.generateDevToken(userId);
        
        StompSession session = connect(token);
        BlockingQueue<String> errorQueue = new LinkedBlockingQueue<>();
        session.subscribe("/user/queue/errors", new org.springframework.messaging.simp.stomp.StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return java.util.Map.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                java.util.Map<String, String> map = (java.util.Map<String, String>) payload;
                errorQueue.offer(map.get("error"));
            }
        });

        // Wait a tiny bit for subscription to activate
        Thread.sleep(500);

        UUID sheetId = UUID.randomUUID();
        sheetMemberRepository.save(new SheetMemberEntity(sheetId, userId));

        // HLC time is > 5 minutes in the future
        HybridLogicalClock hlc = new HybridLogicalClock(System.currentTimeMillis() + 600000, 0, UUID.randomUUID());
        String payload = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"test\"}", UUID.randomUUID(), UUID.randomUUID());
        Op op = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload, hlc);

        session.send("/app/sheet/" + sheetId + "/op", op);
        
        String errorMsg = errorQueue.poll(5, TimeUnit.SECONDS);
        assertNotNull(errorMsg, "Should receive an error frame");
        assertTrue(errorMsg.contains("HLC physical time exceeds maximum allowed future skew"), "Error should mention HLC skew");
    }

    @Test
    public void testMidSessionRevocation_rejected() throws Exception {
        UUID userId = UUID.randomUUID();
        String token = jwtService.generateDevToken(userId);
        
        StompSession session = connect(token);
        BlockingQueue<String> errorQueue = new LinkedBlockingQueue<>();
        session.subscribe("/user/queue/errors", new org.springframework.messaging.simp.stomp.StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return java.util.Map.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                java.util.Map<String, String> map = (java.util.Map<String, String>) payload;
                errorQueue.offer(map.get("error"));
            }
        });

        // Wait a tiny bit for subscription to activate
        Thread.sleep(500);

        UUID sheetId = UUID.randomUUID();
        // Grant access
        SheetMemberEntity access = sheetMemberRepository.save(new SheetMemberEntity(sheetId, userId));

        HybridLogicalClock hlc = HybridLogicalClock.now(UUID.randomUUID(), Clock.systemUTC());
        String payload1 = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"test1\"}", UUID.randomUUID(), UUID.randomUUID());
        Op op1 = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload1, hlc);

        // First message should succeed
        session.send("/app/sheet/" + sheetId + "/op", op1);
        
        // Revoke access mid-session
        sheetMemberRepository.delete(access);
        
        // Submit second op
        String payload2 = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"test2\"}", UUID.randomUUID(), UUID.randomUUID());
        Op op2 = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload2, hlc);
        
        session.send("/app/sheet/" + sheetId + "/op", op2);

        String errorMsg = errorQueue.poll(5, TimeUnit.SECONDS);
        assertNotNull(errorMsg, "Should receive an error frame after revocation");
        assertTrue(errorMsg.contains("User does not have access to this sheet"), "Error should mention access");
    }

    @Test
    public void testSuccessfulBroadcast() throws Exception {
        UUID userId = UUID.randomUUID();
        String token = jwtService.generateDevToken(userId);
        StompSession session = connect(token);

        UUID sheetId = UUID.randomUUID();
        sheetMemberRepository.save(new SheetMemberEntity(sheetId, userId));

        BlockingQueue<Op> queue = new LinkedBlockingQueue<>();
        
        session.subscribe("/topic/sheet/" + sheetId, new StompSessionHandlerAdapter() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return Op.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                queue.offer((Op) payload);
            }
        });

        // Wait a tiny bit for subscription to activate
        Thread.sleep(500);

        HybridLogicalClock hlc = HybridLogicalClock.now(UUID.randomUUID(), Clock.systemUTC());
        String payload = String.format("{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"test_broadcast\"}", UUID.randomUUID(), UUID.randomUUID());
        Op op = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload, hlc);

        session.send("/app/sheet/" + sheetId + "/op", op);

        Op receivedOp = queue.poll(5, TimeUnit.SECONDS);
        assertNotNull(receivedOp, "Should receive the broadcasted operation");
        assertEquals(op.opId(), receivedOp.opId(), "Should broadcast the correct operation");
    }
}
