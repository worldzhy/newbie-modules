-- Initial ClickHouse schema for the backend-monitor module (ADR-014 baseline).
-- Idempotent: safe to re-run on an existing identical schema.

-- One row per HTTP request reported by a backend-monitor installation,
-- ingested in batches via POST /backend-monitor/ingest.
CREATE TABLE IF NOT EXISTS backend_monitor_request_logs
(
    application_id     UUID,
    -- MonitorInstallation that reported the row (module-hub design 9.2).
    installation_id    UUID DEFAULT '00000000-0000-0000-0000-000000000000',
    -- Client-generated id, shared with the matching error row.
    request_id         String,
    -- Route template, kept apart from path so ids do not break aggregation.
    route              LowCardinality(String) DEFAULT '',
    -- Pathname only; query strings are stripped client-side to avoid PII.
    path               String,
    method             LowCardinality(String),
    status_code        UInt16,
    request_at         DateTime64(3, 'UTC'),
    response_at        DateTime64(3, 'UTC'),
    -- Recomputed server-side from the two timestamps; never trusted.
    duration_ms        UInt32,
    env                LowCardinality(String) DEFAULT '',
    instance_id        String DEFAULT '',
    app_version        LowCardinality(String) DEFAULT '',
    ip                 String,
    user_agent         String,
    ingested_at        DateTime64(3, 'UTC') DEFAULT now64()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(request_at)
ORDER BY (application_id, request_at)
-- 90 days of raw rows; aggregates arrive with the monitoring-metrics work.
TTL request_at + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

-- One row per unhandled exception. request_id links back to its request row
-- when the error happened during request processing.
CREATE TABLE IF NOT EXISTS backend_monitor_error_logs
(
    application_id     UUID,
    installation_id    UUID DEFAULT '00000000-0000-0000-0000-000000000000',
    request_id         String DEFAULT '',
    -- Hash of type + normalized message + top business frame.
    fingerprint        String DEFAULT '',
    type               LowCardinality(String),
    message            String,
    stack              String,
    route              LowCardinality(String) DEFAULT '',
    path               String DEFAULT '',
    method             LowCardinality(String) DEFAULT '',
    status_code        UInt16,
    env                LowCardinality(String) DEFAULT '',
    instance_id        String DEFAULT '',
    app_version        LowCardinality(String) DEFAULT '',
    ip                 String,
    user_agent         String,
    occurred_at        DateTime64(3, 'UTC'),
    ingested_at        DateTime64(3, 'UTC') DEFAULT now64()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (application_id, occurred_at)
TTL occurred_at + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
