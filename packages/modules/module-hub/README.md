# Module Hub

Newbie module-hub control plane. One token = one installation instance.

## API Groups

| Group            | Auth                 | Base path                                          |
| ---------------- | -------------------- | -------------------------------------------------- |
| Host integration | Host JWT/Guard       | `/module-hub/installations`, `/module-hub/catalog` |
| Agent polling    | `X-Module-Hub-Token` | `POST /module-hub/agent/poll`                      |
| GitHub webhook   | HMAC-SHA256          | `POST /module-hub/webhooks/registry`               |

## Environment Variables

| Variable                           | Required                                | Description                           |
| ---------------------------------- | --------------------------------------- | ------------------------------------- |
| `MODULE_HUB_GITHUB_WEBHOOK_SECRET` | For webhook                             | GitHub webhook HMAC secret            |
| `MODULE_HUB_REGISTRY_REPO`         | No (default: `worldzhy/newbie-modules`) | Registry repository for fallback sync |
| `MODULE_HUB_REGISTRY_REPO_TOKEN`   | No                                      | GitHub API token for private repos    |

## Design Reference

See `.agent/documents/module-hub-design.md` in the newbie repository (v1.1).
