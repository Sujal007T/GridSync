package com.gridsync.security;

import org.springframework.context.annotation.Lazy;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class SheetAccessInterceptor implements ChannelInterceptor {

    private final SheetMemberRepository sheetMemberRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private static final Pattern SHEET_TOPIC_PATTERN = Pattern.compile("^/topic/sheet/([0-9a-fA-F-]+)$");
    private static final Pattern SHEET_APP_PATTERN = Pattern.compile("^/app/sheet/([0-9a-fA-F-]+)/op$");

    public SheetAccessInterceptor(SheetMemberRepository sheetMemberRepository, @Lazy SimpMessagingTemplate messagingTemplate) {
        this.sheetMemberRepository = sheetMemberRepository;
        this.messagingTemplate = messagingTemplate;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null) return message;

        StompCommand cmd = accessor.getCommand();
        if (StompCommand.SUBSCRIBE.equals(cmd) || StompCommand.SEND.equals(cmd)) {
            String destination = accessor.getDestination();
            if (destination != null) {
                UUID sheetId = extractSheetId(destination, cmd);
                if (sheetId != null) {
                    JwtAuthInterceptor.UserPrincipal principal = (JwtAuthInterceptor.UserPrincipal) accessor.getUser();
                    if (principal == null) {
                        throw new IllegalArgumentException("User not authenticated");
                    }
                    if (!sheetMemberRepository.existsBySheetIdAndUserId(sheetId, principal.getUserId())) {
                        messagingTemplate.convertAndSendToUser(principal.getName(), "/queue/errors", java.util.Map.of("error", "User does not have access to this sheet"));
                        throw new IllegalArgumentException("User does not have access to this sheet");
                    }
                }
            }
        }
        return message;
    }

    private UUID extractSheetId(String destination, StompCommand cmd) {
        Matcher matcher = StompCommand.SUBSCRIBE.equals(cmd) ? 
            SHEET_TOPIC_PATTERN.matcher(destination) : 
            SHEET_APP_PATTERN.matcher(destination);
            
        if (matcher.matches()) {
            try {
                return UUID.fromString(matcher.group(1));
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
        return null;
    }
}
