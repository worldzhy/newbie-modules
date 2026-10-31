# newbie.bitbucket

Bitbucket Cloud API wrapper module. Provides the repository surface security-evaluation needs (URL classification and file reads), with dual-mode authentication. Hosts install it and inject `BitbucketService`.

## Authentication (dual mode)

The bearer token is resolved per request, in priority order:

1. **Workspace access token mode**: when `accessToken` is present, it is used directly.
2. **OAuth consumer mode**: when `clientId` + `clientSecret` are present, a workspace access token is minted from `https://bitbucket.org/site/oauth2/access_token` and cached until expiry (minus a 60s safety margin).

When neither is present, `BitbucketNotConfiguredError` is thrown by any API call instead of surfacing a bare auth failure. Use `isConfigured()` for an upfront check.

## env

| env                       | Required                  | Description                                      |
| ------------------------- | ------------------------- | ------------------------------------------------ |
| `BITBUCKET_WORKSPACE`     | Yes                       | Workspace slug used to log the configured target |
| `BITBUCKET_ACCESS_TOKEN`  | Optional in consumer mode | Static workspace access token                    |
| `BITBUCKET_CLIENT_ID`     | Optional in token mode    | OAuth consumer key                               |
| `BITBUCKET_CLIENT_SECRET` | Optional in token mode    | OAuth consumer secret                            |

`isConfigured()` is true when the workspace plus either the access token or the consumer pair are present.

## Methods

| Method                                  | Semantics                                                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isConfigured()`                        | Whether enough credentials exist (workspace + access token, or workspace + OAuth consumer pair)                                                                              |
| `parseBitbucketUrl(url)`                | Parse `https://bitbucket.org/<workspace>/<repo>` and `git@bitbucket.org:<workspace>/<repo>` (with or without `.git`/trailing slash) into `{workspace, repo}`; null otherwise |
| `getFileContent(workspace, repo, path)` | Read a UTF-8 text file at HEAD; null on 404, other API failures throw. Path segments are URL-encoded individually                                                            |

`BitbucketNotConfiguredError` is thrown by any API method when the service was constructed without credentials, so an unconfigured deployment fails fast with a meaningful error.

## Out of scope

- No write operations (no repo creation, no file updates).
- Contains no nightwatch business concepts (Application / Repository rows / security-evaluation subjects live in the host wiring).
