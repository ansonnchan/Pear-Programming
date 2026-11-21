package com.pearprogram.auth;

import com.pearprogram.files.FileService;
import com.pearprogram.rooms.EphemeralRoomStateService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Issues the short-lived tokens the Yjs realtime service uses to check who is editing.
 * Tokens are stored in Redis so they stay valid across backend restarts and instances;
 * an in-memory copy is used when Redis is unreachable.
 */
@Service
public class RealtimeAccessTokenService {
    private static final Logger log = LoggerFactory.getLogger(RealtimeAccessTokenService.class);

    private final Map<String, TokenRecord> localTokens = new ConcurrentHashMap<>();
    private final SecureRandom secureRandom = new SecureRandom();
    private final Duration ttl;
    private final EphemeralRoomStateService roomStateService;
    private final FileService files;
    private final StringRedisTemplate redis;
    private final String keyPrefix;

    public RealtimeAccessTokenService(
            EphemeralRoomStateService roomStateService,
            FileService files,
            StringRedisTemplate redis,
            @Value("${pearprogram.redis.key-prefix:pearprogram}") String keyPrefix,
            @Value("${pearprogram.auth.realtime-token-ttl:10m}") Duration ttl
    ) {
        this.roomStateService = roomStateService;
        this.files = files;
        this.redis = redis;
        this.keyPrefix = keyPrefix == null || keyPrefix.isBlank() ? "pearprogram" : keyPrefix.trim();
        this.ttl = ttl.isNegative() || ttl.isZero() ? Duration.ofMinutes(10) : ttl;
    }

    public IssuedToken issue(GuestPrincipal principal) {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        String value = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiresAt = Instant.now().plus(ttl);
        localTokens.put(value, new TokenRecord(principal.id(), expiresAt));
        try {
            redis.opsForValue().set(tokenKey(value), principal.id(), ttl);
            redis.opsForSet().add(userKey(principal.id()), value);
            redis.expire(userKey(principal.id()), ttl);
        } catch (RuntimeException ex) {
            log.debug("Realtime token kept in memory only; Redis unavailable: {}", ex.getMessage());
        }
        return new IssuedToken(value, OffsetDateTime.ofInstant(expiresAt, ZoneOffset.UTC));
    }

    public RealtimeTokenValidationResponse validate(String token, String roomCode, String fileId) {
        if (token == null || token.isBlank() || roomCode == null || roomCode.isBlank()) {
            return new RealtimeTokenValidationResponse(false, null);
        }
        String userId = findUserId(token);
        if (userId == null) {
            return new RealtimeTokenValidationResponse(false, null);
        }
        String normalizedRoomCode = normalizeRoomCode(roomCode);
        boolean allowed = roomStateService.isActiveMember(normalizedRoomCode, userId)
                && files.isRoomFile(parseUuid(fileId), normalizedRoomCode);
        return new RealtimeTokenValidationResponse(allowed, allowed ? userId : null);
    }

    public void revokeUser(String userId) {
        localTokens.entrySet().removeIf(entry -> entry.getValue().userId().equals(userId));
        try {
            Set<String> userTokens = redis.opsForSet().members(userKey(userId));
            if (userTokens != null && !userTokens.isEmpty()) {
                redis.delete(userTokens.stream().map(this::tokenKey).toList());
            }
            redis.delete(userKey(userId));
        } catch (RuntimeException ex) {
            log.debug("Could not revoke realtime tokens in Redis: {}", ex.getMessage());
        }
    }

    @Scheduled(fixedDelay = 60_000)
    void removeExpiredTokens() {
        Instant now = Instant.now();
        localTokens.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
    }

    private String findUserId(String token) {
        try {
            String userId = redis.opsForValue().get(tokenKey(token));
            if (userId != null) {
                return userId;
            }
        } catch (RuntimeException ex) {
            log.debug("Checking realtime token in memory; Redis unavailable: {}", ex.getMessage());
        }
        TokenRecord record = localTokens.get(token);
        if (record == null) {
            return null;
        }
        if (record.expiresAt().isBefore(Instant.now())) {
            localTokens.remove(token, record);
            return null;
        }
        return record.userId();
    }

    private String tokenKey(String token) {
        return keyPrefix + ":realtime-token:" + token;
    }

    private String userKey(String userId) {
        return keyPrefix + ":realtime-tokens:user:" + userId;
    }

    private UUID parseUuid(String raw) {
        try {
            return raw == null || raw.isBlank() ? null : UUID.fromString(raw.trim());
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private String normalizeRoomCode(String raw) {
        return raw.trim().replaceAll("[\\s-]+", "").toUpperCase();
    }

    public record IssuedToken(String value, OffsetDateTime expiresAt) {}
    private record TokenRecord(String userId, Instant expiresAt) {}
}
