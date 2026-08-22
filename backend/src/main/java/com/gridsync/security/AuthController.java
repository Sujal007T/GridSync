package com.gridsync.security;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final JwtService jwtService;
    private final SheetMemberRepository sheetMemberRepository;

    public AuthController(JwtService jwtService, SheetMemberRepository sheetMemberRepository) {
        this.jwtService = jwtService;
        this.sheetMemberRepository = sheetMemberRepository;
    }

    @PostMapping("/dev-token")
    public Map<String, String> getDevToken() {
        // Issue a token for a new mock user UUID for development
        UUID newUserId = UUID.randomUUID();
        String token = jwtService.generateDevToken(newUserId);
        
        UUID sheetId = UUID.fromString("00000000-0000-0000-0000-000000000001");
        if (!sheetMemberRepository.existsBySheetIdAndUserId(sheetId, newUserId)) {
            sheetMemberRepository.save(new SheetMemberEntity(sheetId, newUserId));
        }

        return Map.of(
            "token", token, 
            "userId", newUserId.toString(),
            "sheetId", sheetId.toString()
        );
    }
}
