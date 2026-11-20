package com.pearprogram.rooms;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.Mockito.mock;

class RoomCapacityConcurrencyTests {
    private static final int CONTENDERS = 12;

    @Test
    void concurrentJoinsCannotExceedCapacityInMemory() throws Exception {
        EphemeralRoomStateService state = new EphemeralRoomStateService(
                mock(StringRedisTemplate.class), 120, "pearprogram-test", "", "", "", false);
        assertCapacityHolds(state, "CAP001");
    }

    /**
     * Exercises the Redis Lua path. Runs only when PEARPROGRAM_TEST_REDIS_HOST points at a reachable Redis.
     */
    @Test
    void concurrentJoinsCannotExceedCapacityInRedis() throws Exception {
        String host = System.getenv("PEARPROGRAM_TEST_REDIS_HOST");
        assumeTrue(host != null && !host.isBlank(), "PEARPROGRAM_TEST_REDIS_HOST is not set");
        LettuceConnectionFactory factory = new LettuceConnectionFactory(new RedisStandaloneConfiguration(host, 6379));
        factory.afterPropertiesSet();
        try {
            StringRedisTemplate redis = new StringRedisTemplate(factory);
            redis.afterPropertiesSet();
            EphemeralRoomStateService state = new EphemeralRoomStateService(
                    redis, 120, "pearprogram-test-" + UUID.randomUUID(), "", host, "6379", false);
            state.refreshRedisAvailability();
            assertCapacityHolds(state, "CAP002");
            state.clearRuntimeState("CAP002");
        } finally {
            factory.destroy();
        }
    }

    private void assertCapacityHolds(EphemeralRoomStateService state, String code) throws Exception {
        assertThat(state.reserveRoomCode(code)).isTrue();
        state.initializeRoom(code, OffsetDateTime.now());
        for (int index = 0; index < 4; index++) {
            String userId = UUID.randomUUID().toString();
            state.joinRoom(code, userId, userId, "Seated " + index, "#378ADD");
        }

        ExecutorService pool = Executors.newFixedThreadPool(CONTENDERS);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Boolean>> attempts = new ArrayList<>();
            for (int index = 0; index < CONTENDERS; index++) {
                String userId = UUID.randomUUID().toString();
                String name = "Contender " + index;
                attempts.add(pool.submit(() -> {
                    start.await();
                    try {
                        state.joinRoom(code, userId, userId, name, "#1D9E75");
                        return true;
                    } catch (IllegalStateException full) {
                        return false;
                    }
                }));
            }
            start.countDown();
            int admitted = 0;
            for (Future<Boolean> attempt : attempts) {
                if (attempt.get()) admitted++;
            }
            assertThat(admitted).isEqualTo(1);
            assertThat(state.activeMemberCount(code)).isEqualTo(5);
        } finally {
            pool.shutdownNow();
        }
    }
}
