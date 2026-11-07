# Module Hub

Newbie module-hub observer plane. One report token = one running deployment endpoint.

## API Groups

| Group            | Auth                 | Base path                                          |
| ---------------- | -------------------- | -------------------------------------------------- |
| Host integration | Host JWT/Guard       | `/module-hub/installations`, `/module-hub/catalog` |
| Instance report  | `X-Module-Hub-Token` | `POST /module-hub/report`                          |
| GitHub webhook   | HMAC-SHA256          | `POST /module-hub/webhooks/registry`               |

The report endpoint carries two kinds:

- `kind="full"` — process-start self-registration with runtime facts and module snapshot.
- `kind="ping"` — periodic liveness touch without snapshot.

Catalog ingestion has two paths: the GitHub push webhook (automatic) and
`POST /module-hub/catalog/sync` (operator-triggered — local development or a
missed webhook delivery). Both share the same idempotent upsert.

## Environment Variables

This module declares **no** variables in `newbie.module.json`, so `newbie modules apply` adds nothing to the consumer's `.env.example` or config block. Every setting below is optional and read from the environment at runtime (compose passes `.env` through).

| Variable                           | Required                                | Description                                                                                                               |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `MODULE_HUB_REGISTRY_REPO_TOKEN`   | No (falls back to `GITHUB_AUTH`)        | GitHub token for catalog sync; the anonymous quota (60/h) is not enough for a cold sync (~2 calls per module)             |
| `MODULE_HUB_REGISTRY_REPO`         | No (default: `worldzhy/newbie-modules`) | Registry repository read by the catalog sync                                                                              |
| `MODULE_HUB_GITHUB_WEBHOOK_SECRET` | No (webhook disabled when unset)        | GitHub webhook HMAC secret; without it webhook deliveries are rejected and the daily cron sync is the only ingestion path |

By default the sync reuses the host's existing `GITHUB_AUTH` (the `github` module's PAT). GitHub App credentials cannot read a repository outside the app's installation, so an App-only host should set `MODULE_HUB_REGISTRY_REPO_TOKEN` explicitly or accept the anonymous rate limit.

## Upgrade Hints

`GET /module-hub/installations/:id/modules` derives `updateAvailable` at read time (the CLI snapshot never carries it). A module counts as upgradeable only when the catalog's latest release for that module has a **commit date strictly newer** than the commit date of the installed pin — a plain "commit differs" check would flag almost every module, because pins usually sit on an assembly-time HEAD that is newer than the module's own last change.

Two different questions, two different answers:

- **Panel / hub**: "did this module's own files change after my pin?" — precise, ignores unrelated registry commits.
- **`newbie modules update`**: "does my pin differ from the registry ref I resolved?" — coarse, flags every module whose pin is not that exact ref.

The response also carries `hint: { total, dated, catalogued }`. `dated < total` or `catalogued < total` means the hub could not resolve every pin date or has no catalog row — treat it as "version information incomplete", not as "everything is up to date".

`latestRegistrySourceCommit` in the report response is the most recently ingested release commit, **not** necessarily the registry branch HEAD.

## Design Reference

See `module-hub-design.md` (v3) in the nightwatch repository's `.trae/documents/`.
