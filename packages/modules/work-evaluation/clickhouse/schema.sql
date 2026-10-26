-- ClickHouse schema model of the work-evaluation module (ADR-021, ADR-024).
--
-- Pre-launch there is no ClickHouse migration pipeline (2026-10-26 rule): this
-- file is the module's schema definition, applied directly against the
-- platform ClickHouse database, e.g.
--   docker exec -i nightwatch-backend-clickhouse clickhouse-client \
--     --database nightwatch --multiquery < packages/modules/work-evaluation/clickhouse/schema.sql
-- It is idempotent: safe to re-run on an existing identical schema. When the
-- migration pipeline is enabled later, this file becomes its V1 baseline.

-- One row per collected AI-agent session message chunk. The PG side keeps the
-- session index (WorkEvaluationSession); this table holds the transcript
-- the evaluation agent drills into on demand.
-- `content` is chunked by the installation agent and compressed with ZSTD on disk.
-- ReplacingMergeTree dedupes re-ingested batches on the ORDER BY key
-- (evaluatee_user_id, session_id, seq), keeping the row with the newest
-- ingested_at; reads use FINAL so duplicates are invisible before merging.
CREATE TABLE IF NOT EXISTS work_evaluation_session_messages
(
    -- Evaluatee the session belongs to, resolved from the installation token.
    evaluatee_user_id UUID,
    -- PG WorkEvaluationSession.id
    session_id     UUID,
    workspace_key  LowCardinality(String),
    -- Monotonic within a session; chunks keep their original ordering.
    seq            UInt32,
    role           LowCardinality(String),
    content        String CODEC(ZSTD(3)),
    tool_name      LowCardinality(String) DEFAULT '',
    -- Raw JSON of tool calls in this message (empty when none).
    tool_calls     String DEFAULT '',
    token_count    UInt32 DEFAULT 0,
    created_at     DateTime64(3, 'UTC'),
    ingested_at    DateTime64(3, 'UTC') DEFAULT now64()
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (evaluatee_user_id, session_id, seq)
SETTINGS index_granularity = 8192;
