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

## Environment Variables

| Variable                           | Required                                | Description                           |
| ---------------------------------- | --------------------------------------- | ------------------------------------- |
| `MODULE_HUB_GITHUB_WEBHOOK_SECRET` | For webhook                             | GitHub webhook HMAC secret            |
| `MODULE_HUB_REGISTRY_REPO`         | No (default: `worldzhy/newbie-modules`) | Registry repository for fallback sync |
| `MODULE_HUB_REGISTRY_REPO_TOKEN`   | No                                      | GitHub API token for private repos    |

## Design Reference

See `module-hub-design.md` (v3) in the nightwatch repository's `.trae/documents/`.
