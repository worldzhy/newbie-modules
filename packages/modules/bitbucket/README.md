# newbie.bitbucket

Bitbucket Cloud API wrapper module. Provides the repository surface security-evaluation needs (URL classification, file reads, commit lookup and recursive tree walks). Hosts install it and inject `BitbucketService`.

## Authentication

Two mutually-exclusive credential forms are supported; the module picks the auth header based on which env vars are present. Bearer form wins when both are configured.

### Form 1: Workspace/Project/Repository Access Token (Bearer, preferred for service identities)

Create it under the resource's settings (Workspace Settings → Security → Access tokens) with the `repository` (read) scope. Bound to the resource, not any person — suitable for CI runners and long-lived platform credentials.

| env                      | Required     | Description                                                 |
| ------------------------ | ------------ | ----------------------------------------------------------- |
| `BITBUCKET_ACCESS_TOKEN` | Yes (Form 1) | Access token value; sent as `Authorization: Bearer {token}` |

### Form 2: Personal API Token (Basic Auth)

Create under Personal Settings → Access tokens → API tokens. Expiry required (max 1 year). The service uses RFC-2617 Basic HTTP Auth: `Authorization: Basic base64(email:token)`. Bound to your personal account — every API call runs with the same permissions you have.

| env                   | Required     | Description                  |
| --------------------- | ------------ | ---------------------------- |
| `BITBUCKET_API_EMAIL` | Yes (Form 2) | Your Atlassian account email |
| `BITBUCKET_API_TOKEN` | Yes (Form 2) | API token value              |

`isConfigured()` returns true when **either** form is fully supplied. `BitbucketNotConfiguredError` is thrown by any API method when the service was constructed without usable credentials, so an unconfigured deployment fails fast with a meaningful error.

## env summary

| env                      | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `BITBUCKET_ACCESS_TOKEN` | Bearer token for workspace/project/repository access tokens     |
| `BITBUCKET_API_EMAIL`    | Basic auth username — required only for personal API token form |
| `BITBUCKET_API_TOKEN`    | Basic auth password — required only for personal API token form |

The workspace is not configured separately: every API call addresses the workspace parsed from the repository URL.

## Methods

| Method                                        | Semantics                                                                                                                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isConfigured()`                              | Whether any usable credentials exist (either auth form)                                                                                                                                                                                  |
| `parseBitbucketUrl(url)`                      | Parse `https://bitbucket.org/<workspace>/<repo>` and `git@bitbucket.org:<workspace>/<repo>` (with or without `.git`/trailing slash) into `{workspace, repo}`; null otherwise                                                             |
| `getFileContent(workspace, repo, path, ref?)` | Read a UTF-8 text file at HEAD (default) or at a specified branch/tag/sha. Returns null on 404, other API failures throw. Path segments URL-encoded individually                                                                         |
| `getCommit(workspace, repo, ref)`             | Read one commit's metadata (sha, message, author, date). Returns null on 404                                                                                                                                                             |
| `getTree(workspace, repo, ref, recursive?)`   | Read the Git tree at a commit ref. Recursive walks use `max_depth=999` + pagination. `truncated: true` is set on 555 (Bitbucket's "max_depth too large" timeout) or `TimeoutError` so callers can surface an honest partial-scan warning |

## Out of scope

- No write operations (no repo creation, no file updates).
- Contains no nightwatch business concepts (Application / Repository rows / security-evaluation subjects live in the host wiring).
- Does not enumerate repos you have access to — the host supplies coordinates via Repository row URLs.
