-- Initial ClickHouse schema for the people-evaluation module (ADR-029).
-- Idempotent: safe to re-run on an existing identical schema.

-- One row per collected AI-agent session message chunk. The PG side keeps the
-- session index (PeopleEvaluationSession); this table holds the transcript
-- the evaluation agent drills into on demand.
-- `content` is chunked by the installation agent and compressed with ZSTD on disk.
CREATE TABLE IF NOT EXISTS people_evaluation_session_messages
(
    -- Evaluatee the session belongs to, resolved from the installation token.
    evaluatee_user_id UUID,
    -- PG PeopleEvaluationSession.id
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
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (evaluatee_user_id, session_id, seq)
SETTINGS index_granularity = 8192;
