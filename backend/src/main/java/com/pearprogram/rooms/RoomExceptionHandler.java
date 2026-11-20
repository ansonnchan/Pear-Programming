package com.pearprogram.rooms;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class RoomExceptionHandler {
    @ExceptionHandler(RoomAccessDeniedException.class)
    ResponseEntity<Map<String, String>> handleRoomAccessDenied(RoomAccessDeniedException exception) {
        String message = switch (exception.reason()) {
            case "locked" -> "This room is locked.";
            case "full" -> "This room is full.";
            default -> "This room is unavailable.";
        };
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                "error", "room_" + exception.reason(),
                "message", message
        ));
    }
}
