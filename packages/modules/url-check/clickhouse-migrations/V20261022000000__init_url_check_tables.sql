-- ClickHouse schema for the url-check module (ADR-022).
--
-- One row per probe execution against a UrlCheckTarget. Static table managed
-- by the clickhouse module's forward-only migration runner (ADR-014); the file
-- ships inside the url-check module and is picked up via the standard
-- --modules-root scan. Idempotent: safe to re-run on an existing identical
-- schema.

-- Raw check results power the availability timeline, uptime ratios and MTTR
-- statistics; the current up/down state machine itself lives in Postgres on
-- UrlCheckTarget (consecutiveFailures / isAlertOpen).
CREATE TABLE IF NOT EXISTS url_check_results
(
    -- UrlCheckTarget.id this probe ran against.
    target_id      UUID,
    -- Denormalized owning project for project-level availability queries.
    project_id     UUID,
    -- Probed URL, denormalized so rows survive target edits/deletes.
    url            String,
    is_up          Bool,
    -- Null on network-level failures (DNS, connect, timeout).
    status_code    Nullable(UInt16),
    duration_ms    UInt32,
    -- Failure detail (exception message); empty on success and on HTTP >= 400.
    error          String DEFAULT '',
    checked_at     DateTime64(3, 'UTC'),
    -- Server receive time; used for ingestion auditing.
    ingested_at    DateTime64(3, 'UTC') DEFAULT now64()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(checked_at)
ORDER BY (target_id, checked_at)
-- Raw rows retained for 90 days, matching the backend-monitor retention.
TTL checked_at + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
