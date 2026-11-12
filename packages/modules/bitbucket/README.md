# newbie.bitbucket

Bitbucket Cloud API wrapper module. Provides the repository surface security-evaluation needs (URL classification and file reads). Hosts install it and inject `BitbucketService`.

## Authentication

Single mode: a static **workspace access token** used as the Bearer credential on every request. Create it under the target workspace's settings (Workspace settings → Security → Access tokens) with the `Repositories: Read` scope.

When the token is absent, `BitbucketNotConfiguredError` is thrown by any API call instead of surfacing a bare auth failure. Use `isConfigured()` for an upfront check.

## env

| env                      | Required | Description                                                 |
| ------------------------ | -------- | ----------------------------------------------------------- |
| `BITBUCKET_ACCESS_TOKEN` | Yes      | Workspace access token (Bearer, `Repositories: Read` scope) |

`isConfigured()` is true when the access token is present. The workspace is not configured separately: every API call addresses the workspace parsed from the repository URL.

## Methods

| Method                                      | Semantics                                                                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isConfigured()`                            | Whether an access token exists                                                                                                                                               |
| `parseBitbucketUrl(url)`                    | Parse `https://bitbucket.org/<workspace>/<repo>` and `git@bitbucket.org:<workspace>/<repo>` (with or without `.git`/trailing slash) into `{workspace, repo}`; null otherwise |
| `getFileContent(workspace, repo, path)`     | Read a UTF-8 text file at HEAD; null on 404, other API failures throw. Path segments are URL-encoded individually                                                            |
| `getRepository(workspace, repo)`            | Repository metadata as visible to the configured credential: `{fullName, cloneUrl, defaultBranch, private}`. Null on 404 (missing repo or no access); other failures throw   |
| `getCommit(workspace, repo, ref)`           | One commit's metadata (`{sha, message, authorName, authorEmail, committedAt}`); null on 404. Mirrors the GitHub accessor                                                     |
| `getTree(workspace, repo, ref, recursive?)` | Git tree at a branch/tag/sha: `{entries: {path, type, sha, size}[], truncated}`; `recursive` walks subdirectories. Null on 404                                               |

`BitbucketNotConfiguredError` is thrown by any API method when the service was constructed without a token, so an unconfigured deployment fails fast with a meaningful error.

## Out of scope

- No write operations (no repo creation, no file updates).
- Contains no nightwatch business concepts (Application / Repository rows / security-evaluation subjects live in the host wiring).
