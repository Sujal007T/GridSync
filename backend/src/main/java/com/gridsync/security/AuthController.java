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

    public AuthController(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @PostMapping("/dev-token")
    public Map<String, String> getDevToken() {
        // Issue a token for a new mock user UUID for development
        UUID newUserId = UUID.randomUUID();
        String token = jwtService.generateDevToken(newUserId);
        return Map.of("token", token, "userId", newUserId.toString());
    }
}
