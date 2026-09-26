# newbie.backend-monitor

Backend application monitoring ingestion for nightwatch.

## Responsibilities

- `POST /backend-monitor/ingest` — batched request metrics + error reports from
  SERVER_MONITOR agents (token auth via `X-Application-Token`), stored in
  ClickHouse `application_request_logs` / `application_error_logs`.
- `GET /backend-monitor/request-logs` / `error-logs` — paginated log queries for
  the monitoring UI.

## Storage

ClickHouse DDL is maintained in the consuming project under
`clickhouse/migrations/` and applied manually with `clickhouse-client`
(ClickHouse has no built-in migration runner). The module owns no Prisma schema;
agent credentials are resolved from the framework's `Agent` table.
