package com.pearprogram.rooms;

/**
 * Thrown when a user cannot take a seat in a room because it is full or locked.
 */
public class RoomAccessDeniedException extends IllegalStateException {
    private final String reason;

    public RoomAccessDeniedException(String reason) {
        super(reason == null || reason.isBlank() ? "unavailable" : reason);
        this.reason = getMessage();
    }

    public String reason() {
        return reason;
    }
}
