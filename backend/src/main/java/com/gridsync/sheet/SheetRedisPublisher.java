package com.gridsync.sheet;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

@Component
public class SheetRedisPublisher {

    private static final Logger log = LoggerFactory.getLogger(SheetRedisPublisher.class);
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final MeterRegistry meterRegistry;

    public SheetRedisPublisher(StringRedisTemplate redisTemplate, ObjectMapper objectMapper, MeterRegistry meterRegistry) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.meterRegistry = meterRegistry;
    }

    public void publish(Op op) {
        try {
            String payload = objectMapper.writeValueAsString(op);
            redisTemplate.convertAndSend("sheet:" + op.sheetId(), payload);
        } catch (Exception e) {
            log.error("Failed to publish op to Redis for sheet " + op.sheetId(), e);
            meterRegistry.counter("redis.publish.errors").increment();
        }
    }
}
