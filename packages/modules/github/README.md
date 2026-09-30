# newbie.github

GitHub API 封装 module。提供双模式鉴权与仓库编排所需的通用方法（建仓 / 写 `.env.example` / 删仓），供宿主（如 nightwatch-backend 的建仓编排服务）装配后注入 `GitHubService` 调用。

## 鉴权（双模式）

构造时按 config 优先级选择鉴权方式：

1. **GitHub App 模式**：`appId` + `privateKey` + `installationId` 三件套齐全 → `@octokit/auth-app` 的 `createAppAuth`，每个请求 mint 一个 installation token。推荐生产环境使用（可限制 scope、可吊销、不绑定个人账号）。
2. **PAT 模式**：仅 `auth`（PAT / personal token）存在 → `auth: token`。用于过渡 / 单用户场景。

两者都不存在时，`octokit` 仍构造但会 warn；调用方法会因无凭证而失败。`isConfigured()` 用于前置检查。

## env

| env                      | 必填         | 说明                                               |
| ------------------------ | ------------ | -------------------------------------------------- |
| `GITHUB_USER_AGENT`      | 否           | User-Agent，默认 `saas-starter`                    |
| `GITHUB_AUTH`            | App 模式可空 | PAT / personal token                               |
| `GITHUB_APP_ID`          | PAT 模式可空 | GitHub App ID                                      |
| `GITHUB_PRIVATE_KEY`     | PAT 模式可空 | App PEM 私钥，换行用 `\n` 字面量存储（构造时还原） |
| `GITHUB_INSTALLATION_ID` | PAT 模式可空 | App installation ID（数字字符串）                  |

## 方法

| 方法                                                           | 语义                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isConfigured()`                                               | 是否有足够凭证执行编排（App 三件套或 PAT 至少其一）                                                                                                                                   |
| `ensureRepoExists(org, name, tplOwner, tplRepo, description?)` | 幂等建仓：GET 200 跳过；404 → 从模板 generate（private:true）；422 → 抛 `RepoNameConflictError`。generate 返回 202 后内部重试 3 次（每次 2s）等仓库可读。返回 `{cloneUrl, generated}` |
| `upsertEnvExample(org, repo, placeholderLines)`                | 幂等写 `.env.example`：GET 取 sha + 现有内容，按 env-var key 去重，仅追加缺失的占位行（注释格式，不含真实值），PUT 带 sha；404 → 创建。**不覆盖模板内容**                             |
| `deleteRepo(org, repo)`                                        | best-effort 删仓，404 忽略。用于 teardown 清理                                                                                                                                        |

`RepoNameConflictError` 在 `ensureRepoExists` 的 generate 返回 422 时抛出，表示仓库名被不属于自己的仓库占用。

## 不做

- 不写 GitHub Secrets（方案 B：凭证只写 `.env.example` 占位行，明文在宿主 create/retry 响应一次性返回）
- 不含 `libsodium-wrappers` 依赖
- 不含 nightwatch 业务概念（Application / ProvisioningStatus / 凭证组装那些在宿主编排服务里）
