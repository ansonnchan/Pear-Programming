package com.pearprogram.auth;

import java.io.Serializable;
import java.security.Principal;
import java.util.UUID;

/**
 * The signed-in guest. Implements {@link Principal} so the stored session's principal name is the user id.
 */
public record GuestPrincipal(UUID userId, String displayName, String avatarUrl) implements Principal, Serializable {
    public String id() {
        return userId.toString();
    }

    @Override
    public String getName() {
        return id();
    }
}
