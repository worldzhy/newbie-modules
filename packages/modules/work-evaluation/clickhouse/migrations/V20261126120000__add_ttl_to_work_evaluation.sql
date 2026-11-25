-- Add 90-day TTL to work_evaluation_session_messages.
-- The ReplacingMergeTree stores AI session transcripts; older than 90 days
-- have no evaluation value and inflate the rowcount. All other ClickHouse
-- application tables already have matching 90-day TTL (ADR-044).
-- Production ALTER TABLE applied 2026-11-26 (see backlog L144).
ALTER TABLE work_evaluation_session_messages
  MODIFY TTL created_at + INTERVAL 90 DAY;
