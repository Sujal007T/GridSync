package com.gridsync.security;

import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.security.Principal;
import java.util.UUID;

@Component
public class JwtAuthInterceptor implements ChannelInterceptor {

    private final JwtService jwtService;

    public JwtAuthInterceptor(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

        if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
            String authHeader = accessor.getFirstNativeHeader("Authorization");
            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                String token = authHeader.substring(7);
                UUID userId = jwtService.validateTokenAndGetUserId(token);
                if (userId != null) {
                    accessor.setUser(new UserPrincipal(userId));
                } else {
                    throw new IllegalArgumentException("Invalid JWT Token");
                }
            } else {
                throw new IllegalArgumentException("Missing JWT Token");
            }
        }
        return message;
    }

    public static class UserPrincipal implements Principal {
        private final UUID userId;

        public UserPrincipal(UUID userId) {
            this.userId = userId;
        }

        public UUID getUserId() {
            return userId;
        }

        @Override
        public String getName() {
            return userId.toString();
        }
    }
}
