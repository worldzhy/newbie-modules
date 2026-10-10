# newbie.account

Identity, authentication and session management for a host application.
Supports password, TOTP, approved-subnet, and OAuth login strategies
(Feishu/Lark, WeChat, Google). The Lark path is documented below; other
strategies are wired in `auth/` and configured through the matching
`modules.account.*` config blocks.

## Feishu / Lark login external setup

The Lark login (`auth/lark/lark-auth.service.ts`) depends on a self-built
app provisioned on the [Feishu Open Platform](https://open.feishu.cn/).
The settings below must be configured by an admin in the Feishu developer
console; the login chain fails at `oidcAccessToken.create` or
`userInfo.get` otherwise.

Facts sourced from the Feishu docs (verified 2026-10-10):

- [Get user info](https://open.feishu.cn/document/server-docs/authentication-management/login-state-management/get?lang=zh-CN)
- [Scope list](https://open.feishu.cn/document/ukTMukTMukTM/uYTM5UjL2ETO14iNxkTN/scope-list)

### 1. App credentials

1. Create a **self-built app** on the Feishu Open Platform.
2. Copy `App ID` and `App Secret` into the host config:
   - `modules.account.larkAuth.appId` (env `LARK_APP_ID`)
   - `modules.account.larkAuth.appSecret` (env `LARK_APP_SECRET`)

Consumed in `lark-auth.service.ts` `appId` / `appSecret` getters; the
env mapping lives in `newbie.module.json` under
`config-service.account.larkAuth` and the `env` block.

### 2. Redirect URL

Add the callback URL to the app's "Security Settings -> Redirect URLs".
The value must match the host config exactly:

- `modules.account.larkAuth.callbackURL` (env `LARK_AUTH_CALLBACK_URL`)

Consumed in `lark-auth.service.ts` `callbackURL` getter; used to build
the `redirect_uri` parameter of `buildAuthorizeUrl`.

### 3. App availability

Add the departments or users who need to log in to the app's
"App capability -> App availability". **Members outside the availability
range cannot complete OAuth authorization** (assumption: the token
exchange returns 401, which blocks the entire login chain, not just
individual fields).

### 4. Field permission matrix (core)

The `authen/v1/user_info` endpoint lists **no required scope** — it can
be called without any permission. But the response body contains
**sensitive fields** that are only returned after the corresponding
permission is enabled in "Permission Management"; otherwise they come
back as empty string or null.

#### 4.1 Default-returned fields (no permission needed)

| Field | Used by |
|---|---|
| `name` | `User.name` |
| `en_name` | (not consumed) |
| `avatar_url` | `User.uiAvatarsUrl` (falls back to `buildUiAvatarsUrl`) |
| `avatar_thumb` / `avatar_middle` / `avatar_big` | (not consumed) |
| `open_id` | `User.larkOpenId` (S1 primary key) |
| `union_id` | `User.larkUnionId` |
| `tenant_key` | (not consumed) |

> `avatar_url` is **not** a sensitive field. It is returned by default
> alongside `name` / `open_id` / `union_id`. No extra permission is
> required to fetch the avatar — this differs from the email/mobile field
> gating.

#### 4.2 Sensitive fields (must be enabled in the console)

The "Permission name" column below is the exact Chinese label shown in
the Feishu console; search by that string when enabling.

| Permission name (console) | Constraint | Returned fields | Consumed at |
|---|---|---|---|
| `获取用户邮箱信息` | self-built app only | `email`, `enterprise_email` | `lark-auth.service.ts` L134 -> `User.email` |
| `获取用户手机号` | self-built app only | `mobile` | `lark-auth.service.ts` L135 -> `User.phone` |
| `获取用户 user ID` | self-built app only | `user_id` | (not consumed) |
| `获取用户受雇信息` | — | `employee_no` and other employment fields | (not consumed) |

#### 4.3 Required permissions for this module

The code already consumes `email` (S2 email-merge path) and `mobile`
(S2b phone-merge path). A production deployment **must enable**:

- `获取用户邮箱信息`
- `获取用户手机号`

If either is missing, the field comes back empty — the code degrades
gracefully (skips the email/phone merge, falls through to S3
auto-provision), but loses account merge: the same Lark user logging in
across multiple `larkOpenId` values creates multiple `User` rows.

### 5. App capability

Enable the "Web" capability under "App capability" and configure the
home URL if needed. Pure OAuth login does not strictly require the web
capability, but enabling it helps with admin preview and future
extensions.

### 6. Version release

After changes to the app config (permissions, availability), create a
new version and release it to the tenant. Unreleased draft config does
not affect the live login chain.

## Troubleshooting

| Symptom | Direction |
|---|---|
| `Lark token exchange failed` | Wrong App ID/Secret, app not released, user not in availability range |
| `avatar_url` empty | User has not uploaded an avatar in Feishu (the field is empty when the user has no avatar — unrelated to permissions) |
| `email` empty | `获取用户邮箱信息` not enabled, or user has no email |
| `mobile` empty | `获取用户手机号` not enabled, or user has no mobile |
| Status 20005 / 20021 / 20022 | User invalid / resigned / frozen (see Feishu error code table) |
