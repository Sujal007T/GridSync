package com.gridsync.sheet;

import com.gridsync.crdt.HybridLogicalClock;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.containers.GenericContainer;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

@SpringBootTest
@Testcontainers
public class RedisRelayIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
            .withDatabaseName("gridsync")
            .withUsername("postgres")
            .withPassword("password");

    @Container
    static GenericContainer<?> redis = new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
            .withExposedPorts(6379);

    @DynamicPropertySource
    static void setProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.flyway.url", postgres::getJdbcUrl);
        registry.add("spring.flyway.user", postgres::getUsername);
        registry.add("spring.flyway.password", postgres::getPassword);
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    @Autowired
    private SheetWebSocketController controller;

    @MockitoBean
    private SimpMessagingTemplate messagingTemplate;

    @Test
    void testOpIsRelayedThroughRedis() {
        UUID sheetId = UUID.randomUUID();
        UUID opId = UUID.randomUUID();
        HybridLogicalClock hlc = new HybridLogicalClock(System.currentTimeMillis(), 0, UUID.randomUUID());
        Op op = new Op(sheetId, opId, "CELL_SET", "{\"rowId\":\"" + UUID.randomUUID() + "\",\"colId\":\"" + UUID.randomUUID() + "\",\"value\":\"hello\"}", hlc);

        // Send op to controller
        controller.receiveOp(sheetId, op);

        // Wait for Redis to process and call messagingTemplate via SheetRedisListener
        // Verify it is called EXACTLY ONCE via the listener path
        // Due to removing SimpMessagingTemplate from the controller entirely, this call 
        // CANNOT be from the controller itself, structurally guaranteeing exactly-once relay.
        verify(messagingTemplate, timeout(5000).times(1))
                .convertAndSend(eq("/topic/sheet/" + sheetId), eq(op));
    }
}
