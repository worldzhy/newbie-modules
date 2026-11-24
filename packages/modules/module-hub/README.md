# Module Hub

Newbie module-hub observer plane. One report token = one running deployment endpoint.

## API Groups

| Group            | Auth                 | Base path                                          |
| ---------------- | -------------------- | -------------------------------------------------- |
| Host integration | Host JWT/Guard       | `/module-hub/installations`, `/module-hub/catalog` |
| Instance report  | `X-Module-Hub-Token` | `POST /module-hub/reports`                         |
| GitHub webhook   | HMAC-SHA256          | `POST /module-hub/webhooks/registry`               |

The report endpoint carries two kinds:

- `kind="full"` — process-start self-registration with runtime facts and module snapshot.
- `kind="ping"` — periodic liveness touch without snapshot.

Catalog ingestion has two paths: the GitHub push webhook (automatic) and
`POST /module-hub/catalog/sync` (operator-triggered — local development or a
missed webhook delivery). Both share the same idempotent upsert.

## Environment Variables

Both settings are declared under `requires.env` in `newbie.module.json`, so
`newbie modules apply` renders them into the consumer's `.env.example` and every
environment must provision the key (devbie ADR-033); the example value is scaffolding,
never a runtime default.

- `MODULE_HUB_GITHUB_WEBHOOK_SECRET` — an empty value disables the webhook path:
  deliveries are rejected and the daily cron sync is the only ingestion path.
- `MODULE_HUB_REGISTRY_REPO` — example `worldzhy/newbie-modules`; leave it blank and the
  catalog sync requests an empty repository, so blank is a misconfiguration rather than
  a fallback.

The catalog sync reads GitHub through the `github` module, so a configured GitHub credential is a **required dependency of installing module-hub, not an option**. This module declares `github` under `requires.modules`, and the host must provide `GITHUB_AUTH` (or the App triplet). A host without a credential fails the sync; there is no anonymous fallback.

| Variable                           | Empty value                       | Description                                                                                                               |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `MODULE_HUB_REGISTRY_REPO`         | sync requests an empty repository | Registry repository read by the catalog sync (example: `worldzhy/newbie-modules`)                                         |
| `MODULE_HUB_GITHUB_WEBHOOK_SECRET` | webhook disabled                  | GitHub webhook HMAC secret; without it webhook deliveries are rejected and the daily cron sync is the only ingestion path |

## Upgrade Hints

`GET /module-hub/installations/:id/modules` derives `updateAvailable` at read time (the CLI snapshot never carries it). A module counts as upgradeable only when the catalog's latest release for that module has a **commit date strictly newer** than the commit date of the installed pin — a plain "commit differs" check would flag almost every module, because pins usually sit on an assembly-time HEAD that is newer than the module's own last change.

Two different questions, two different answers:

- **Panel / hub**: "did this module's own files change after my pin?" — precise, ignores unrelated registry commits.
- **`newbie modules update`**: "does my pin differ from the registry ref I resolved?" — coarse, flags every module whose pin is not that exact ref.

The response also carries `hint: { total, dated, catalogued }`. `dated < total` or `catalogued < total` means the hub could not resolve every pin date or has no catalog row — treat it as "version information incomplete", not as "everything is up to date".

`latestRegistrySourceCommit` in the report response is the most recently ingested release commit, **not** necessarily the registry branch HEAD.

## Design Reference

See `module-hub-design.md` (v3) in the nightwatch repository's `.trae/documents/`.
