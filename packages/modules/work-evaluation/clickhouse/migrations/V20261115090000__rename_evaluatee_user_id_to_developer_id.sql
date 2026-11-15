-- The evaluated person is identified as a developer (ADR-068 D6); the
-- denormalized owner column follows the PG rename.
--
-- ClickHouse refuses to rename a column that participates in the sorting key
-- (ALTER_OF_COLUMN_IS_FORBIDDEN), so the table is rebuilt instead: create the
-- new shape, copy the rows across, then swap the names. Re-running is safe
-- because the engine dedupes on (developer_id, session_id, seq) and each step
-- is guarded by IF NOT EXISTS / IF EXISTS.
CREATE TABLE IF NOT EXISTS work_evaluation_session_messages_v2
(
    -- Developer the session belongs to, resolved from the installation token.
    developer_id   UUID,
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
ORDER BY (developer_id, session_id, seq)
SETTINGS index_granularity = 8192;

INSERT INTO work_evaluation_session_messages_v2
    (developer_id, session_id, workspace_key, seq, role, content, tool_name, tool_calls, token_count, created_at, ingested_at)
SELECT evaluatee_user_id, session_id, workspace_key, seq, role, content, tool_name, tool_calls, token_count, created_at, ingested_at
FROM work_evaluation_session_messages;

DROP TABLE IF EXISTS work_evaluation_session_messages;

RENAME TABLE work_evaluation_session_messages_v2 TO work_evaluation_session_messages;
