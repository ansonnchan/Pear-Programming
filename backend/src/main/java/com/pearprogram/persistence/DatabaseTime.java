package com.pearprogram.persistence;

import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;

/**
 * Timestamps for persisted entities. PostgreSQL stores microseconds, so values are truncated before they
 * are saved; otherwise an entity read back from the database differs from the instance that created it.
 */
public final class DatabaseTime {
    private DatabaseTime() {
    }

    public static OffsetDateTime now() {
        return OffsetDateTime.now().truncatedTo(ChronoUnit.MICROS);
    }
}
