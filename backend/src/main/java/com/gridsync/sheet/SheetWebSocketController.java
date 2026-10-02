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
    private final SheetRedisPublisher redisPublisher;
    private final HlcValidator hlcValidator;
    private final Validator validator;

    public SheetWebSocketController(SheetService sheetService, SheetRedisPublisher redisPublisher, HlcValidator hlcValidator, Validator validator) {
        this.sheetService = sheetService;
        this.redisPublisher = redisPublisher;
        this.hlcValidator = hlcValidator;
        this.validator = validator;
    }

    @MessageMapping("/sheet/{sheetId}/op")
    public void receiveOp(@DestinationVariable UUID sheetId, Op op) {
        // Manual validation to bypass STOMP @Valid gotchas
        Set<ConstraintViolation<Op>> violations = validator.validate(op);
        if (!violations.isEmpty()) {
            throw new OpRejectedException(violations.iterator().next().getMessage(), op.opId());
        }

        if (!sheetId.equals(op.sheetId())) {
            throw new OpRejectedException("Sheet ID mismatch in payload", op.opId());
        }

        // Validate physical time future skew
        try {
            hlcValidator.validateIncoming(op.hlc());
        } catch (IllegalArgumentException e) {
            throw new OpRejectedException(e.getMessage(), op.opId());
        }

        // Apply op atomically
        sheetService.applyOpTransactional(op);

        // Publish to Redis (all nodes including this one will receive it and broadcast)
        redisPublisher.publish(op);
    }

    @org.springframework.messaging.handler.annotation.MessageExceptionHandler(OpRejectedException.class)
    @org.springframework.messaging.simp.annotation.SendToUser("/queue/errors")
    public java.util.Map<String, String> handleException(OpRejectedException exception) {
        return java.util.Map.of("error", exception.getMessage(), "opId", exception.getOpId().toString());
    }
}
