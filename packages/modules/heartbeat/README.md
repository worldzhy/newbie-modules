# Heartbeat

Newbie heartbeat module. One heartbeat token = one running deployment endpoint.

## API Groups

| Group            | Auth                | Base path                  |
| ---------------- | ------------------- | -------------------------- |
| Host integration | Host JWT/Guard      | `/heartbeat/installations` |
| Instance ping    | `X-Heartbeat-Token` | `POST /heartbeat/ping`     |

A ping is a pure liveness touch (`lastSeenAt`), optionally carrying
self-reported facts (`appVersion` / `env` / `instanceId`). The response carries
`serverTime` and `reportIntervalSeconds` (v1 fixed 30s; offline after 90s
silence, derived at read time).

## Design Reference

See `module-hub-design.md` (v3) §9.3 / Phase 4 in the nightwatch repository's
`.trae/documents/`.
