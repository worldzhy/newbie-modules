# newbie.security

Infrastructure security primitives: authentication, authorization, cookies, token
signing, rate limiting, and the shared installation identity every collector
reports through. `security` is a mandatory base module — collectors declare it in
`requires.modules` and do not start without it.

## Subdomains

| directory        | owns                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `authentication` | login flows (JWT, Google OAuth, API key), account guards, and the installation HTTP guard/decorator |
| `authorization`  | permission and ownership guards, `@RequirePermission` / `@RequireOwner`                             |
| `cookie`         | cookie reading/writing and redirect-path sanitisation                                               |
| `token`          | access / refresh / API-key signing and verification                                                 |
| `rate-limiter`   | request throttling primitives and the `@RateLimit` guard                                            |
| `installation`   | installation identity, credential verification, reporting budget, receipts, presence and snapshot   |
| `prisma`         | the module's Prisma schema fragment                                                                 |
| `ports`          | host-bound ports for account, permission, scope and API-key resolution                              |

## Installation identity

One `Installation` row backs every collector: `heartbeat`, `health`, `module-hub`,
`backend-monitor`, `frontend-monitor` and `work-evaluation`. The row owns `kind`,
`label`, `tokenHash`, `tokenFingerprint`, `externalRef`, `appKey` and the
first-seen / last-seen / issued / revoked timestamps; each collector keeps only its
own 1:1 fact table and nothing about credentials. Decisions live in
`nightwatch-backend ADR-078` (identity), `ADR-079` (report budget) and `ADR-080`
(ingest observability).

Installation identity stays inside `security` because it is the same authentication
surface as the rest of the module: issuing a credential, verifying it, attributing
the caller and throttling the caller are one deployment unit. A separate
`installation` module would either make `security` depend on it (the guard, the
401/413 receipt filter and the budget live here) or rename this module to
"installation", without removing a single dependency edge.

## Dependency direction

Collectors depend on `security`; `security` never depends on a collector:

- every collector lists `security` in `newbie.module.json` → `requires.modules`;
- `security` learns collector specifics only from host-registered `KindDescriptor`
  declarations (report path, interval, offline threshold, reporting budget, whether an
  `appKey` is required). It imports no collector source, so adding a collector adds a
  registration, not a change here;
- `security` requires the `redis` module — budget counters and receipt buckets are
  Redis-backed and degrade fail-open when Redis is unavailable.

## Configuration

`newbie.module.json` declares each key under `requires.env` with an **example** value,
never a default (devbie ADR-033): the example only seeds `.env.example` and the local
`.env` scaffold, no code path reads it, and every environment must declare every key
explicitly — `newbie secrets check` fails the deploy when a `.env.example` key is absent
from that environment's secret. An empty example renders `KEY=` for the operator to fill.

| variable                              | example | runtime contract                                                                                                                                           |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SECURITY_DEFAULT_TOKEN_SECRET`       | empty   | required: `TokenService` asserts a non-public secret of at least 32 characters and fails startup otherwise                                                 |
| `SECURITY_USER_ACCESS_TOKEN_SECRET`   | empty   | optional: falls back to `SECURITY_DEFAULT_TOKEN_SECRET`                                                                                                    |
| `SECURITY_USER_REFRESH_TOKEN_SECRET`  | empty   | optional: falls back to `SECURITY_DEFAULT_TOKEN_SECRET`                                                                                                    |
| `SECURITY_APIKEY_ACCESS_TOKEN_SECRET` | empty   | not read here: API-key authentication delegates to the host-bound `ApiKeyVerifier`                                                                         |
| `INSTALLATION_TRUSTED_PROXY`          | `false` | only `"true"` trusts `x-real-ip` / `x-forwarded-for`; otherwise the socket peer feeds the per-IP budget and startup warns when such a budget is registered |
