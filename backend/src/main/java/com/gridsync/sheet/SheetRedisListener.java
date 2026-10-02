package com.gridsync.sheet;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class SheetRedisListener {

    private static final Logger log = LoggerFactory.getLogger(SheetRedisListener.class);
    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;

    public SheetRedisListener(SimpMessagingTemplate messagingTemplate, ObjectMapper objectMapper) {
        this.messagingTemplate = messagingTemplate;
        this.objectMapper = objectMapper;
    }

    public void receiveMessage(String message) {
        try {
            Op op = objectMapper.readValue(message, Op.class);
            String destination = "/topic/sheet/" + op.sheetId();
            messagingTemplate.convertAndSend(destination, op);
            log.debug("Broadcasted op to local STOMP clients for sheet {}", op.sheetId());
        } catch (Exception e) {
            log.error("Failed to process Redis message", e);
        }
    }
}
