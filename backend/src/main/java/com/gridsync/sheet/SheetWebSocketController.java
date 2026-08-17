package com.gridsync.sheet;

import com.gridsync.crdt.HlcValidator;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.Set;
import java.util.UUID;

@Controller
public class SheetWebSocketController {

    private final SheetService sheetService;
    private final SimpMessagingTemplate messagingTemplate;
    private final HlcValidator hlcValidator;
    private final Validator validator;

    public SheetWebSocketController(SheetService sheetService, SimpMessagingTemplate messagingTemplate, HlcValidator hlcValidator, Validator validator) {
        this.sheetService = sheetService;
        this.messagingTemplate = messagingTemplate;
        this.hlcValidator = hlcValidator;
        this.validator = validator;
    }

    @MessageMapping("/sheet/{sheetId}/op")
    public void receiveOp(@DestinationVariable UUID sheetId, Op op) {
        // Manual validation to bypass STOMP @Valid gotchas
        Set<ConstraintViolation<Op>> violations = validator.validate(op);
        if (!violations.isEmpty()) {
            throw new IllegalArgumentException(violations.iterator().next().getMessage());
        }

        if (!sheetId.equals(op.sheetId())) {
            throw new IllegalArgumentException("Sheet ID mismatch in payload");
        }

        // Validate physical time future skew
        hlcValidator.validateIncoming(op.hlc());

        // Apply op atomically
        sheetService.applyOpTransactional(op);

        // Broadcast to all subscribers
        messagingTemplate.convertAndSend("/topic/sheet/" + sheetId, op);
    }

    @org.springframework.messaging.handler.annotation.MessageExceptionHandler
    @org.springframework.messaging.simp.annotation.SendToUser("/queue/errors")
    public java.util.Map<String, String> handleException(IllegalArgumentException exception) {
        return java.util.Map.of("error", exception.getMessage());
    }
}
