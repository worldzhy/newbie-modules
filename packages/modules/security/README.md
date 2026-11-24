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

`newbie.module.json` maps the `security` config block to env vars. An empty default in
that file means the host must supply the value — the registry uses empty strings for
"no default" everywhere, so none of the token secrets ships one.

| variable                              | default | behaviour when empty                                                                                                         |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `INSTALLATION_TRUSTED_PROXY`          | `false` | headers are ignored and the socket peer feeds the per-IP budget; startup warns when such a budget is registered; never fails |
| `SECURITY_DEFAULT_TOKEN_SECRET`       | none    | startup fails: `TokenService` asserts it in its constructor                                                                  |
| `SECURITY_USER_ACCESS_TOKEN_SECRET`   | none    | falls back to `SECURITY_DEFAULT_TOKEN_SECRET`                                                                                |
| `SECURITY_USER_REFRESH_TOKEN_SECRET`  | none    | falls back to `SECURITY_DEFAULT_TOKEN_SECRET`                                                                                |
| `SECURITY_APIKEY_ACCESS_TOKEN_SECRET` | none    | no fallback; API-key authentication uses the host-bound verifier instead                                                     |
