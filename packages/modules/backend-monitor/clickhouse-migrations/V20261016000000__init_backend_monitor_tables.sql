-- Initial ClickHouse schema for the backend-monitor module.
--
-- Static infrastructure tables managed by the clickhouse module's forward-only
-- migration runner (ADR-014). This baseline merges the former hand-run
-- migrations into the final shape (including installation_id). Idempotent:
-- safe to re-run on an existing identical schema.

-- One row per HTTP request reported by a backend-monitor installation.
-- Batched through POST /backend-monitor/ingest; application_id is the stable
-- UUID (mapped from the installation externalRef, tokens may rotate),
-- installation_id identifies the reporting MonitorInstallation (module-hub
-- design section 9.2), request_id correlates errors with their request.
CREATE TABLE IF NOT EXISTS application_request_logs
(
    application_id     UUID,
    -- MonitorInstallation that reported the row (module-hub design section 9.2).
    installation_id    UUID DEFAULT '00000000-0000-0000-0000-000000000000',
    -- Client-generated correlation id, shared with the matching error row.
    request_id         String,
    -- Route template (e.g. /users/:id); empty string when no route matched.
    -- Kept separate from path so high-cardinality ids do not break aggregation.
    route              LowCardinality(String) DEFAULT '',
    -- Pathname only; query strings are stripped on the client to avoid PII.
    path               String,
    method             LowCardinality(String),
    status_code        UInt16,
    request_at         DateTime64(3, 'UTC'),
    response_at        DateTime64(3, 'UTC'),
    -- Recomputed server-side from the two timestamps above (never trusted).
    duration_ms        UInt32,
    -- Deployment dimension: e.g. production / staging.
    env                LowCardinality(String) DEFAULT '',
    -- Reporting instance (hostname / pod name).
    instance_id        String DEFAULT '',
    app_version        LowCardinality(String) DEFAULT '',
    ip                 String,
    user_agent         String,
    -- Server receive time; used for clock-skew defence and ingestion auditing.
    ingested_at        DateTime64(3, 'UTC') DEFAULT now64()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(request_at)
ORDER BY (application_id, request_at)
-- Raw rows retained for 90 days; long-term history will live in aggregate
-- tables introduced by the monitoring-metrics follow-up.
TTL request_at + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

-- One row per unhandled exception/error reported by a backend-monitor
-- installation. request_id links back to the application_request_logs row
-- when the error occurred during request processing; fingerprint groups
-- equivalent errors.
CREATE TABLE IF NOT EXISTS application_error_logs
(
    application_id     UUID,
    installation_id    UUID DEFAULT '00000000-0000-0000-0000-000000000000',
    request_id         String DEFAULT '',
    -- Server-computed hash (type + normalized message + top business frame).
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
