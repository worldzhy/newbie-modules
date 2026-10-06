# newbie.github

GitHub API wrapper module. Provides dual-mode authentication and the common methods needed for repository orchestration (create repo / write `.env.example` / delete repo). Hosts (e.g. the repository provisioning service in nightwatch-backend) install it and inject `GitHubService`.

## Authentication (dual mode)

The authentication method is selected at construction time by config priority:

1. **GitHub App mode**: when `appId` + `privateKey` + `installationId` are all present, uses `createAppAuth` from `@octokit/auth-app` and mints an installation token per request. Recommended for production (scoped, revocable, not tied to a personal account).
2. **PAT mode**: when only `auth` (PAT / personal token) is present, uses `auth: token`. For migration / single-user scenarios.

When neither is present, `octokit` is still constructed but logs a warning; method calls will fail due to missing credentials. Use `isConfigured()` for an upfront check.

## env

| env                      | Required             | Description                                                                     |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------- |
| `GITHUB_USER_AGENT`      | No                   | User-Agent, defaults to `saas-starter`                                          |
| `GITHUB_AUTH`            | Optional in App mode | PAT / personal token                                                            |
| `GITHUB_APP_ID`          | Optional in PAT mode | GitHub App ID                                                                   |
| `GITHUB_PRIVATE_KEY`     | Optional in PAT mode | App PEM private key; newlines stored as literal `\n` (restored at construction) |
| `GITHUB_INSTALLATION_ID` | Optional in PAT mode | App installation ID (numeric string)                                            |

## Methods

| Method                                                         | Semantics                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isConfigured()`                                               | Whether enough credentials exist for orchestration (the App triplet or a PAT)                                                                                                                                                                             |
| `ensureRepoExists(org, name, tplOwner, tplRepo, description?)` | Idempotent repo creation: GET 200 skips; 404 generates from the template (private:true); 422 throws `RepoNameConflictError`. After generate returns 202, retries 3 times internally (2s each) until the repo is readable. Returns `{cloneUrl, generated}` |
| `upsertEnvExample(org, repo, placeholderLines)`                | Idempotently writes `.env.example`: GET fetches sha + current content, dedupes by env-var key, appends only missing placeholder lines (comment format, no real values), PUT with sha; 404 creates. **Does not overwrite template content**                |
| `deleteRepo(org, repo)`                                        | best-effort repo deletion; 404 is ignored. Used for teardown cleanup                                                                                                                                                                                      |

`RepoNameConflictError` is thrown when the generate call in `ensureRepoExists` returns 422, meaning the repository name is occupied by a repository not owned by the caller.

## Out of scope

- Does not write GitHub Secrets (plan B: credentials are written only as `.env.example` placeholder lines; plaintext is returned once in the host's create/retry responses)
- Does not include a `libsodium-wrappers` dependency
- Contains no nightwatch business concepts (Application / ProvisioningStatus / credential assembly live in the host orchestration service)
