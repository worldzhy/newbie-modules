-- The evaluated person is identified as a developer (ADR-068 D6); the
-- denormalized owner column follows the PG rename. The sorting key is
-- rewritten by ClickHouse together with the column rename.
ALTER TABLE work_evaluation_session_messages RENAME COLUMN evaluatee_user_id TO developer_id;
