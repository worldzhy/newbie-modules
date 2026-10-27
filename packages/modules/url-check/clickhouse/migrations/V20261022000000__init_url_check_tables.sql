-- ClickHouse schema for the url-check module (ADR-022).
-- Idempotent: safe to re-run on an existing identical schema.

-- Raw probe results power the availability timeline, uptime ratios and MTTR;
-- the up/down state machine itself lives in Postgres on UrlCheckTarget
-- (consecutiveFailures / isAlertOpen).
CREATE TABLE IF NOT EXISTS url_check_results
(
    -- UrlCheckTarget.id this probe ran against.
    target_id      UUID,
    -- Denormalized for project-level availability queries.
    project_id     UUID,
    -- Denormalized so rows survive target edits and deletes.
    url            String,
    is_up          Bool,
    -- Null on network-level failures (DNS, connect, timeout).
    status_code    Nullable(UInt16),
    duration_ms    UInt32,
    -- Failure detail; empty on success and on HTTP >= 400.
    error          String DEFAULT '',
    checked_at     DateTime64(3, 'UTC'),
    ingested_at    DateTime64(3, 'UTC') DEFAULT now64()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(checked_at)
ORDER BY (target_id, checked_at)
-- 90 days, matching backend-monitor retention.
TTL checked_at + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
