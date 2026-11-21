package com.pearprogram.rooms;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class RedisStartupStateTests {
    /**
     * Users often rejoin seconds after a restart, before the scheduled Redis check has run. Those joins must
     * still go to Redis, or their memberships vanish once Redis is detected. Runs only when
     * PEARPROGRAM_TEST_REDIS_HOST points at a reachable Redis.
     */
    @Test
    void joinsMadeBeforeTheScheduledRedisCheckAreStoredInRedis() {
        String host = System.getenv("PEARPROGRAM_TEST_REDIS_HOST");
        assumeTrue(host != null && !host.isBlank(), "PEARPROGRAM_TEST_REDIS_HOST is not set");
        LettuceConnectionFactory factory = new LettuceConnectionFactory(new RedisStandaloneConfiguration(host, 6379));
        factory.afterPropertiesSet();
        try {
            StringRedisTemplate redis = new StringRedisTemplate(factory);
            redis.afterPropertiesSet();
            String prefix = "pearprogram-test-" + UUID.randomUUID();
            String code = "BOOT01";
            String userId = UUID.randomUUID().toString();

            EphemeralRoomStateService justStarted = new EphemeralRoomStateService(redis, 120, prefix, "", host, "6379", false);
            assertThat(justStarted.reserveRoomCode(code)).isTrue();
            justStarted.initializeRoom(code, OffsetDateTime.now());
            justStarted.joinRoom(code, userId, userId, "Early Pear", "#378ADD");

            EphemeralRoomStateService otherInstance = new EphemeralRoomStateService(redis, 120, prefix, "", host, "6379", false);
            otherInstance.refreshRedisAvailability();
            assertThat(otherInstance.isActiveMember(code, userId)).isTrue();
            otherInstance.clearRuntimeState(code);
        } finally {
            factory.destroy();
        }
    }
}
