# newbie.backend-monitor

Backend application monitoring ingestion for nightwatch.

## Responsibilities

- `POST /backend-monitor/ingest` (`@NoGuard`) — batched request metrics + error
  reports authenticated by a **MonitorInstallation** report token sent as
  `X-Backend-Monitor-Token`, stored in ClickHouse `application_request_logs` /
  `application_error_logs`.
- `GET /backend-monitor/request-logs` / `error-logs` — paginated, application-scoped
  log queries for the monitoring UI (query contract unchanged by the
  installation cutover).
- Host integration API (platform JWT):
  - `POST /backend-monitor/installations` — enroll; `{ label, externalRef?, env?, kind? }`,
    the plaintext token is returned **once**.
  - `GET /backend-monitor/installations` / `GET :id` — list / read
    (supports `?externalRef=` filter).
  - `POST /backend-monitor/installations/:id/token/regenerate` — rotate; new
    plaintext returned once.
  - `DELETE /backend-monitor/installations/:id` — soft revoke; subsequent ingest
    gets 401.

## Identity model (module-hub design §9.2, Phase 3 pilot)

The module owns its own token table, `MonitorInstallation`
(PostgreSQL schema `"module/backend-monitor"`), instead of reading
`application.Agent` of type `SERVER_MONITOR`:

- token is a random UUID, only its SHA-256 hash is stored (`tokenHash`);
- `externalRef` is an opaque host tag by convention `projectId/applicationId`;
  the ingest resolver maps the `applicationId` segment onto every ClickHouse row;
- liveness (`firstSeenAt` / `lastSeenAt`, online threshold 180s) and runtime
  facts (`env` / `appVersion` / `instanceId` / `kind`) are derived/refreshed on
  ingest (PG write throttled to 30s; positive/negative token caches 60s/10s).

The reporter side ships in `@newbie/core` (`BackendMonitorModule.forRoot`,
env `BACKEND_MONITOR_API_URL` / `BACKEND_MONITOR_REPORT_TOKEN`); it POSTs to
`/backend-monitor/ingest` with `X-Backend-Monitor-Token`.

## Storage

- PostgreSQL: module Prisma fragment in `prisma/schema.prisma` (assembly copy in
  the consuming project's `prisma/models/backend-monitor.prisma`).
- ClickHouse DDL is maintained in the consuming project under
  `clickhouse/migrations/` and applied manually with `clickhouse-client`
  (ClickHouse has no built-in migration runner). `installation_id UUID` was added
  after `application_id` in
  `20260930_add_installation_id_to_backend_monitor.sql`; `application_id` stays
  the leading partition/sort dimension.

## SERVER_MONITOR agent decommission path

As of the Phase 3 pilot the ingest resolver no longer reads
`Agent(type=SERVER_MONITOR)`; legacy agent tokens are rejected (401). The
`AgentType.SERVER_MONITOR` enum and the SERVER_MONITOR row created at backend
application creation in `src/application/` are intentionally **retained** this
milestone (the application creation flow is outside this module's boundary;
`NEWBIE_MANAGEMENT` is the existing precedent of a retained agent type with no
ingest consumer). Follow-up cleanup path:

1. Application creation (`src/application/project/application/application.service.ts`)
   stops creating the SERVER_MONITOR agent and instead enrolls a
   `MonitorInstallation` (via this module's host API or its service), returning
   the one-time token in onboarding.
2. Remove `AgentType.SERVER_MONITOR` from the Prisma enum plus
   `CREATION_AGENT_TYPES` / `AGENT_REPORT_ENDPOINTS` and the onboarding DTO
   mapping.
3. Drop `Agent` rows of that type in a PG migration.
