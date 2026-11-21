package com.pearprogram.auth;

import com.pearprogram.files.FileService;
import com.pearprogram.rooms.EphemeralRoomStateService;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RealtimeAccessTokenServiceTests {
    private static final String ROOM = "ABC123";
    private final GuestPrincipal alice = new GuestPrincipal(UUID.randomUUID(), "Alice", null);
    private final UUID fileId = UUID.randomUUID();

    @Test
    void keepsWorkingInMemoryWhenRedisIsDown() {
        StringRedisTemplate brokenRedis = mock(StringRedisTemplate.class);
        when(brokenRedis.opsForValue()).thenThrow(new RedisConnectionFailureException("down"));
        when(brokenRedis.opsForSet()).thenThrow(new RedisConnectionFailureException("down"));
        RealtimeAccessTokenService tokens = service(brokenRedis, "pearprogram-test");

        String token = tokens.issue(alice).value();

        assertThat(tokens.validate(token, ROOM, fileId.toString()).valid()).isTrue();
        tokens.revokeUser(alice.id());
        assertThat(tokens.validate(token, ROOM, fileId.toString()).valid()).isFalse();
    }

    /**
     * A token issued before a restart must still be accepted afterwards. Runs only when
     * PEARPROGRAM_TEST_REDIS_HOST points at a reachable Redis.
     */
    @Test
    void tokensSurviveABackendRestartAndCanBeRevoked() {
        String host = System.getenv("PEARPROGRAM_TEST_REDIS_HOST");
        assumeTrue(host != null && !host.isBlank(), "PEARPROGRAM_TEST_REDIS_HOST is not set");
        LettuceConnectionFactory factory = new LettuceConnectionFactory(new RedisStandaloneConfiguration(host, 6379));
        factory.afterPropertiesSet();
        try {
            StringRedisTemplate redis = new StringRedisTemplate(factory);
            redis.afterPropertiesSet();
            String prefix = "pearprogram-test-" + UUID.randomUUID();

            String token = service(redis, prefix).issue(alice).value();
            RealtimeAccessTokenService afterRestart = service(redis, prefix);

            RealtimeTokenValidationResponse result = afterRestart.validate(token, ROOM, fileId.toString());
            assertThat(result.valid()).isTrue();
            assertThat(result.userId()).isEqualTo(alice.id());
            assertThat(redis.getExpire(prefix + ":realtime-token:" + token)).isPositive();

            afterRestart.revokeUser(alice.id());
            assertThat(service(redis, prefix).validate(token, ROOM, fileId.toString()).valid()).isFalse();
        } finally {
            factory.destroy();
        }
    }

    private RealtimeAccessTokenService service(StringRedisTemplate redis, String prefix) {
        EphemeralRoomStateService rooms = mock(EphemeralRoomStateService.class);
        when(rooms.isActiveMember(eq(ROOM), anyString())).thenReturn(true);
        FileService files = mock(FileService.class);
        when(files.isRoomFile(any(), eq(ROOM))).thenReturn(true);
        return new RealtimeAccessTokenService(rooms, files, redis, prefix, Duration.ofMinutes(10));
    }
}
