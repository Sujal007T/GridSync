package com.gridsync.sheet;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gridsync.TestcontainersConfiguration;
import com.gridsync.crdt.HybridLogicalClock;
import com.gridsync.persistence.OpLogDto;
import com.gridsync.security.JwtService;
import com.gridsync.security.SheetMemberEntity;
import com.gridsync.security.SheetMemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
class CatchUpIntegrationTest {

    @LocalServerPort
    private int port;

    @Autowired
    private SheetService sheetService;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private SheetMemberRepository sheetMemberRepository;
    
    private ObjectMapper objectMapper = new ObjectMapper();

    private UUID sheetId;
    private UUID memberUserId;
    private UUID outsiderUserId;
    private String memberToken;
    private String outsiderToken;
    private HttpClient httpClient;

    @BeforeEach
    void setUp() {
        sheetId = UUID.randomUUID();
        memberUserId = UUID.randomUUID();
        outsiderUserId = UUID.randomUUID();
        httpClient = HttpClient.newHttpClient();

        // Register the member user for this sheet
        sheetMemberRepository.save(new SheetMemberEntity(sheetId, memberUserId));

        memberToken = jwtService.generateDevToken(memberUserId);
        outsiderToken = jwtService.generateDevToken(outsiderUserId);
    }

    private void seedOps(int count) {
        UUID replicaId = UUID.randomUUID();
        UUID rowId = UUID.randomUUID();
        UUID colId = UUID.randomUUID();
        for (int i = 0; i < count; i++) {
            HybridLogicalClock hlc = HybridLogicalClock.now(replicaId, Clock.systemUTC());
            String payload = String.format(
                "{\"rowId\":\"%s\", \"colId\":\"%s\", \"value\":\"v%d\"}", rowId, colId, i);
            Op op = new Op(sheetId, UUID.randomUUID(), "CELL_SET", payload, hlc);
            sheetService.applyOpTransactional(op);
            try { Thread.sleep(2); } catch (InterruptedException ignored) {}
        }
    }

    private String url(String path) {
        return "http://localhost:" + port + path;
    }

    private HttpRequest.Builder requestWithAuth(String path, String token) {
        HttpRequest.Builder builder = HttpRequest.newBuilder().uri(URI.create(url(path)));
        if (token != null) {
            builder.header("Authorization", "Bearer " + token);
        }
        return builder;
    }

    @Test
    void testCatchUp_returnsOpsAfterSinceSeq_inAscendingOrder() throws Exception {
        seedOps(3);

        HttpResponse<String> allOpsRes = httpClient.send(
            requestWithAuth("/api/sheets/" + sheetId + "/ops?sinceSeq=0", memberToken).build(),
            HttpResponse.BodyHandlers.ofString()
        );
        assertEquals(200, allOpsRes.statusCode());
        List<OpLogDto> all = objectMapper.readValue(allOpsRes.body(), new TypeReference<>() {});
        assertEquals(3, all.size(), "Should return exactly 3 ops seeded for this sheet");

        for (int i = 0; i < all.size() - 1; i++) {
            assertTrue(all.get(i).seq() < all.get(i + 1).seq(), "Ops must be in ascending seq order");
        }

        long afterFirstSeq = all.get(0).seq();
        HttpResponse<String> partialRes = httpClient.send(
            requestWithAuth("/api/sheets/" + sheetId + "/ops?sinceSeq=" + afterFirstSeq, memberToken).build(),
            HttpResponse.BodyHandlers.ofString()
        );
        assertEquals(200, partialRes.statusCode());
        List<OpLogDto> partialOps = objectMapper.readValue(partialRes.body(), new TypeReference<>() {});
        assertEquals(2, partialOps.size(), "Should return only ops after sinceSeq (exclusive)");
        partialOps.forEach(op -> assertTrue(op.seq() > afterFirstSeq));
    }

    @Test
    void testCatchUp_emptyResultWhenNoNewOps() throws Exception {
        seedOps(2);

        HttpResponse<String> allOpsRes = httpClient.send(
            requestWithAuth("/api/sheets/" + sheetId + "/ops?sinceSeq=0", memberToken).build(),
            HttpResponse.BodyHandlers.ofString()
        );
        List<OpLogDto> all = objectMapper.readValue(allOpsRes.body(), new TypeReference<>() {});
        long maxSeq = all.stream().mapToLong(OpLogDto::seq).max().orElse(0);

        HttpResponse<String> emptyRes = httpClient.send(
            requestWithAuth("/api/sheets/" + sheetId + "/ops?sinceSeq=" + maxSeq, memberToken).build(),
            HttpResponse.BodyHandlers.ofString()
        );
        assertEquals(200, emptyRes.statusCode());
        List<OpLogDto> empty = objectMapper.readValue(emptyRes.body(), new TypeReference<>() {});
        assertTrue(empty.isEmpty(), "No new ops should return an empty list");
    }

    @Test
    void testCatchUp_nonMember_returns403() throws Exception {
        HttpResponse<String> response = httpClient.send(
            requestWithAuth("/api/sheets/" + sheetId + "/ops?sinceSeq=0", outsiderToken).build(),
            HttpResponse.BodyHandlers.ofString()
        );
        assertEquals(403, response.statusCode(), "A user who is not a sheet member must receive 403");
    }

    @Test
    void testCatchUp_noToken_returns401() throws Exception {
        HttpResponse<String> response = httpClient.send(
            requestWithAuth("/api/sheets/" + sheetId + "/ops?sinceSeq=0", null).build(),
            HttpResponse.BodyHandlers.ofString()
        );
        assertEquals(401, response.statusCode(), "Missing token must receive 401");
    }
}
