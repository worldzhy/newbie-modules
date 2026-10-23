-- ADR-013 follow-up: move the backend-monitor tables off the generic
-- application_* prefix.
--
-- V20261016000000 originally created application_request_logs /
-- application_error_logs. The prefix was renamed in place via RENAME TABLE
-- (see ADR-013), which mutated an already-applied migration file - something
-- the forward-only runner rejects with a checksum mismatch. The baseline has
-- since been restored to its applied content, and the intended rename is
-- expressed here as a proper forward step.
--
-- Idempotent across the three possible starting points:
--
-- 1. Environments that already renamed in place (all known live databases):
--    backend_monitor_* exists here, so CREATE IF NOT EXISTS is a no-op, and
--    application_* is already gone, so DROP IF EXISTS is a no-op as well.
-- 2. Fresh environments: the restored baseline creates application_*, this
--    migration creates the real tables and drops the baseline ones. Safe
--    because every write path has targeted backend_monitor_* since ADR-013,
--    so the baseline tables never receive rows.
-- 3. Pre-ADR-013 environments that still hold rows in the baseline tables:
--    the DROP below discards them. That state cannot be produced by any
--    released version - the rename shipped together with the code that writes
--    the new names - but if such a database turns up, copy the rows into
--    backend_monitor_* before running deploy.

-- One row per HTTP request reported by a backend-monitor installation
-- (formerly application_request_logs).
CREATE TABLE IF NOT EXISTS backend_monitor_request_logs
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
-- installation (formerly application_error_logs). request_id links back to
-- the backend_monitor_request_logs row when the error occurred during request
-- processing; fingerprint groups equivalent errors.
CREATE TABLE IF NOT EXISTS backend_monitor_error_logs
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

-- Retire the pre-rename tables. On every database that went through
-- ADR-013 these are already absent; on a fresh database they are the empty
-- baseline tables created moments ago by V20261016000000.
DROP TABLE IF EXISTS application_request_logs;
DROP TABLE IF EXISTS application_error_logs;
