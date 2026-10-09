# Health

Newbie health module. One health token = one running deployment endpoint.

## API Groups

| Group            | Auth                | Base path               |
| ---------------- | ------------------- | ----------------------- |
| Host integration | Host JWT/Guard      | `/health/installations` |
| Instance snapshot| `X-Health-Token`    | `POST /health/snapshot` |

A snapshot carries the aggregated dependency health status (`ok` | `error`)
and per-indicator results (e.g. `prisma`, `mongo`, `clickhouse`, `redis`,
`aws-identity`). The response carries `serverTime` and
`reportIntervalSeconds` (v1 fixed 30s).

## Health State

Derived at read time from `lastSnapshotAt` + `lastSnapshotStatus`:

| State     | Condition                                                           |
| --------- | ------------------------------------------------------------------- |
| `unknown` | Never reported (`lastSnapshotAt` is null)                           |
| `healthy` | Last snapshot `ok` and within the online threshold (≤ 90s)          |
| `degraded`| Last snapshot `error` and within the online threshold               |
| `offline` | No snapshot within the online threshold (> 90s)                     |

## Design Reference

See health-sdk design in the newbie repository's `packages/health-sdk/`.
