# Expert Review — 2026-11-04 round7：R6-09 / R6-12 / R6-13 最终方案裁决

> 本报告是时点快照。scope = `modules: [security-evaluation, account, web-monitor]`，按协议 §7 落模块真源仓。
> 评审会话只读，不改代码；修复另起会话。

## 1. 锚点

| 仓 | branch | HEAD | dirty | 备注 |
|---|---|---|---|---|
| devbie | dev | `4973f455` | 0 | 台账与 R7-01 修复所在仓 |
| newbie-modules | dev | `3b35feb` | 0 | 模块真源，本轮裁决对象 |
| nightwatch-backend | dev | `68074d5` | 0 | 装配产物 |
| nightwatch-frontend | dev | `b3f3b9c` | 0 | apits 生成物 |

- 评审窗口：2026-11-04 22:26 – 22:47 CST。
- 并行会话：无。四仓工作树均干净，结论**非** provisional。
- 运行时取证：`nightwatch-backend-postgres` 容器实测，`module/account`.`ApiKey` **0 行**（`organizationId` 非空 0 行）；`module/security-evaluation`.`SecurityEvaluationThreatVerdictCache` **0 行**。两处 schema 变更均无存量数据风险。

## 2. 范围与方法

**范围**

- `newbie-modules/packages/modules/{security-evaluation, account, web-monitor}`
- 装配面：`nightwatch-backend/src/modules/{security-evaluation, account, web-monitor}` + 渲染产物 `prisma/models/{security-evaluation, account}.prisma`
- 生成物：`nightwatch-frontend/src/api/_gen/api.ts`（仅用于确认 `organizationId` 对外暴露面）

**明确排除**：`organization` 模块本体（仅在 §6 作为关联建议提及，不计入本轮 finding）、`web-monitor` 的 ClickHouse/Mongo 其余集合逻辑、`aws-*` 与 `evaluation` 框架层。

**方法**

1. 静态取证：端口/适配器/schema/调用链逐层读码。
2. 运行时取证：DB 行数与列分布（见 §1）。
3. 反驳轮：对每条原方案构造最强反对意见，再由主会话读码裁决（结果见 §7）。

## 3. 结论摘要

| ID | 原方案（R6 收口时） | 本轮裁决 | 一句话理由 |
|---|---|---|---|
| R6-09 | 把候选内容 hash 并入 scope 级 `inputSignature` | **否决原方案，改为两层签名** | scope 级签名无法表达条目级差异；并入会导致任一文本变化使整 scope 缓存失效 |
| R6-12 | 不删，完整建模 organization 维度 | **改判为彻底删除** | 用户确认 organization 不进入未来领域；领域维度不成立 → 半建模状态是唯一必须消灭的形态 |
| R6-13 | 维持 fail-closed，仅调整台账定性 | **保留 fail-closed，细化异常语义分层** | appId 来源混合（服务端生成 / 客户端 query / 库内值），单一异常类型必然有一层语义错误 |

**维度评分**（本轮针对三条方案，不覆盖整个工作区）

| 维度 | 评分 | 依据 |
|---|---|---|
| 安全 | 中 | R6-09 是静默漏报（false clean），R6-12 的 5 个 `*ForOrganization` 方法一旦接线即跨租户越权 |
| 架构 | 中 | R6-12 是「半个能力」；R6-09 是缓存维度缺失；R6-13 是防御正确但异常分类错位 |
| 契约 | 好 | 端口边界清晰（negative-cache port / public API DTO），R6-12 需同步收窄 DTO 与生成物 |
| 测试 | 中 | `account` 无任何 organization 相关用例（删除不引发测试破坏）；`security-evaluation` 有 intel 用例但无签名维度用例 |
| 门禁 | 好 | `modules update --check` / `apply --check` 可按 pin 快照发现 registry↔装配漂移（R7-01 修复后已验证） |
| 治理 | 好 | findings 台账 + backlog 职责分离；R6-12 的注释已如实记录「移除原因 + 重加前提」 |

## 4. P0

无。

## 5. P1

### R6-09 负缓存缺少判定输入维度 → 静默漏报

**仓**：newbie-modules（security-evaluation），live。
**可达性**：持有可触发 INTEL 评估 run 权限的角色（一次 run 即可污染缓存，无需特殊构造）。
**影响**：正确性 —— 已判 `not-relevant` 的 (条目, scope) 对被跳过 7 天，而判定输入可能已变。

**证据**

- [security-evaluation-intel-negative-cache.repository.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/persistence/security-evaluation-intel-negative-cache.repository.ts#L45-L63)：`filterUncached` 的 `where` 只有 `scopeKey` + `knowledgeItemId in ids` + `verdict: notRelevant` + `updatedAt > cutoff`。
- [security-evaluation.prisma](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/prisma/schema.prisma)：`SecurityEvaluationThreatVerdictCache` 无签名/模型/内容指纹列，唯一键仅 `@@unique([knowledgeItemId, scopeKey])`。
- 三个会改变判定结果的输入维度，现有缓存均不可感知：
  1. **实体集**：[security-evaluation-evidence.provider.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/evidence/security-evaluation-evidence.provider.ts) 每次 run 从 `scopeEntitiesProvider.listScopeEntities()` 现取；实体集动态是注释里已承认的事实。
  2. **模型/提示词版本**：[security-evaluation-intel-re-ranker.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/intel/security-evaluation-intel-re-ranker.ts) 的 `SYSTEM_PROMPT` 是模块内常量，模型经 `resolver.resolve(SECURITY_EVALUATION_INTEL_LLM_SCOPE)` 解析，`ChatModelPort.modelId` 可读。
  3. **条目文本**：[security-evaluation-knowledge.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/knowledge/security-evaluation-knowledge.service.ts#L92-L118) 的 `upsertOne` 在 `update` 分支覆盖 `title/summary/severity/signalTags` 并刷新 `lastSeenAt` —— `lastSeenAt` 每次采集都变，不能当内容指纹。

**复现路径（逻辑级）**

1. run #1：实体集 `{A}`，条目 X 判 `not-relevant` 入缓存。
2. 用户在 scope 里新增实体 `B`（X 恰好描述 B 的漏洞）。
3. run #2（7 天内）：`filterUncached` 命中旧行 → X 不进入证据、不进入判定 → 报告 clean。
4. 结果：新增了受影响的实体，却得到「无风险」的结论。

**修复方向（裁决：两层签名，否决单层）**

- 新增纯函数模块 `judgment/intel/security-evaluation-intel-verdict-signature.ts`（无基础设施依赖，满足 `judgment-layer.contract.test.ts` 约束）：
  - `SECURITY_EVALUATION_INTEL_PROMPT_VERSION = 1`（`SYSTEM_PROMPT` 变更时必须 bump）。
  - `scopeInputSignature(entities, modelId)` = SHA-256(canonical(归一化去重排序的实体值) + `model:<modelId|unbound>` + `prompt:vN`)。
  - `itemContentFingerprint(title, summary)` = SHA-256(`title + "\n" + (summary ?? "")`)，即送入硬召回与 LLM 的同一份 haystack。
- schema 增两列（**nullable**，跨宿主迁移安全；null 一律视为签名不匹配 → 重新判定）：
  - `inputSignature String?`
  - `contentFingerprint String?`
  - 唯一键保持 `@@unique([knowledgeItemId, scopeKey])`，`record` 仍 upsert 覆盖签名 —— 不把签名并入唯一键，避免行数无界增长。
- 端口签名改为对象入参（避免 6 个位置参数）：
  - `filterUncached(scopeKey, inputSignature, candidates: {knowledgeItemId, contentFingerprint}[])`
  - `record({ knowledgeItemId, scopeKey, verdict, inputSignature, contentFingerprint, reason, matchedEntity })`
- 仓储实现：一次 `findMany`（仍带 TTL 条件）后在内存做**精确等值**比对，不匹配（含 null）即视为未缓存。
- 读取侧仍在 evidence 采集层（保持现状）：缓存命中必须早于证据预算，否则命中项会挤占预算。模型 id 通过 llm 侧只读来源获取（优先 `LlmScopeCatalog` 的绑定；不可得时用 `ChatModelResolver.resolve().modelId`，`@Optional` + 解析失败记 `unbound`）—— 解析失败只会让签名不同 → 缓存 miss → 重新判定，属 fail-open，不产生错误结论。
- 写入侧 `SecurityEvaluationIntelMatchService.match` 一次算出 scope 签名与逐条指纹，随 `hard-hit` / `not-relevant` 一并落库。
- 硬约束：签名算法**只能有一处实现**，读侧写侧都必须调用同一函数，禁止各自拼串。

**回归测试**（新增）

- 签名：顺序无关、大小写归一、模型/提示词版本变化即变。
- `filterUncached`：签名不符 → 返回未缓存；条目指纹不符 → 未缓存；完全一致 → 命中；TTL 过期 → 未缓存；`hard-hit` 行不参与过滤。
- 集成：实体集变化后，上一轮缓存不再屏蔽条目。

## 6. P2

### R6-12 `ApiKey.organizationId` 与组织维度主体（裁决：彻底删除）

**仓**：newbie-modules（account），source（未装配 organization，live 面仅暴露裸列）。**severity 维持 P2，但标注潜在 P0**：5 个 `*ForOrganization` 方法一旦被接线且不带 membership 授权，即可让任意登录用户读取/删除任意组织的 key —— 这正是 `api-key.module.ts` 注释记录的历史问题。当前安全，因为无入口。

**领域裁决**

用户输入「organization 以后不会使用」是决定性的。按 `project_memory` #31（字段存废只看领域语义与跨宿主成立性，不看当前调用面），无入口**不是**删除理由，领域不成立**才是**。既然本产品未来领域里「API key 的所有者」只有用户一个主体，则：

- `organizationId` 列 = 永远为 null 的裸列（且无 relation，organization 模块未装配）；
- `ApiKeyOwner` 联合类型 = 第二个分支永不可达；
- 5 个 `*ForOrganization` 方法 = 不可达代码；
- `ownerWhere` 的 `organizationId: null` 过滤 = 对不存在维度的断言。

这是**半个能力**形态：既没有完整语义，又不肯被移除。唯一两个自洽状态是「完整建模（含 organization 装配 + membership 授权 + relation）」与「全部移除」。前者被用户输入排除，故取后者。

**反驳与裁决（针对「registry 需要通用性」）**

反对意见：account 是 registry 模块，未来宿主可能装配 organization，删列会破坏该组合。

裁决：该组合**当前不存在契约** —— organization 的 schema 里没有任何 ApiKey 反向引用，account 的 `newbie.module.json` 也没有对 organization 的依赖声明。若将来真需要组织级 key，正确做法是在 organization 模块侧建模（自有表或自有端口），而不是在 account 的 ApiKey 上留一个无 relation、无授权、无入口的裸列。删除不降低通用性，只移除「看起来支持、实际不支持」的误导。

**删除清单（registry 与装配产物同源同改）**

1. `packages/modules/account/prisma/schema.prisma`：删除 `organizationId String? @db.Uuid`。
2. `modules/api-key/api-key.service.ts`：
   - 删除 `ApiKeyOwner` 类型（`listApiKeys/getOwnedApiKey/updateOwnedApiKey/deleteOwnedApiKey/getOwnedApiKeyLogs/ownerWhere` 改收 `userId: string`）；
   - 删除 `getApiKeysForOrganization` / `getApiKeyForOrganization` / `updateApiKeyForOrganization` / `deleteApiKeyForOrganization` / `getApiKeyLogsForOrganization`；
   - `createApiKey` 删除 `organizationId?` 参数与 `organizationId: params.organizationId` 写入；`data` 的类型 `Omit<..., "user" | "organization">` 收窄为 `Omit<..., "key" | "secret" | "user">`；
   - `ownerWhere` 返回 `{ user: { id: userId } }`（删除 `organizationId: null`）；
   - `getOwnedApiKey` 改 `apiKey.userId === userId`。
3. `modules/api-key/api-key.dto.ts`：删除响应 DTO 的 `organizationId?: string | null`。
4. `security-ports/api-key.verifier.ts`：删除 `if (apiKey.userId)` 条件包裹 → 所有者状态检查无条件执行；删除注释中的 R6-12 记载。
5. `modules/api-key/api-key.module.ts`：删除「Re-add ... once an organization/membership module is assembled」注释（前提已不成立），改为一句「API keys are user-scoped」。
6. 宿主渲染产物 `prisma/models/account.prisma` 由 `newbie modules apply` 重生成，禁止手改；随后 `db push`（0 行，无数据损失）。
7. `nightwatch-frontend` 重新生成 apits（`ApiKeyResponse.organizationId` 消失，当前无业务代码消费它）。
8. 测试：`account` 下无 organization 相关用例（已核验），无需改写。

**关联但不并入本条**：若 organization 确认永不使用，registry 中的 `organization` 模块本体（`packages/modules/organization/**`）同样是无人消费的能力，建议单列一条 finding 评估删除，避免把它塞进 R6-12 造成范围膨胀。

### R6-13 `appId` 校验异常语义错位（裁决：fail-closed 保留，异常分层）

**仓**：newbie-modules（web-monitor），live。
**现状**：`APP_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/`，[utils.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/shared/utils.ts#L14-L19) 的 `assertAppId` 统一抛 `BadRequestException`；5 个 Mongo 集合工厂与 2 个 ClickHouse 表工厂首行调用（[web-monitor-models.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/models/mongo/web-monitor-models.service.ts#L43-L75)）。

**appId 来源是混合的（本轮实测）**

| 来源 | 证据 | 正确定性 |
|---|---|---|
| 服务端生成 | `web-installation.service.ts:77`、`site.service.ts:43` 均为 `func.randomString(7).slice(0, 7)` | 不可达；若触发说明代码缺陷 |
| 客户端 query | `site.controller.ts:46` `@Query("appId") appId`；`siteService.upsertSiteForWebMonitor(body.appId)` | 400（客户端过错） |
| 库内既有值 | ingest 按 appId 分组（`report-task.service.ts`），jobs 用 `system.appId` | 5xx + 告警（不变量破坏，客户端无过错） |

`randomString` 字符集为纯字母数字（`ABCDEFGHJKMNPQRSTWXYZ…23456789`），是 pattern 的子集，生成器合规；64 字符上限与 `[A-Za-z0-9_]` 对 Mongo 集合名与 ClickHouse 标识符均安全（排除 `$`、引号、反引号）。

**裁决**

- **保留 fail-closed**：绝不 sanitize/escape 后进入 DDL，也绝不静默跳过。静默跳过会把数据写进未知集合，比报错更糟。
- **拆成两个断言**：
  - `assertAppId`（边界用，400）：只在 controller / DTO 层对**客户端可控** appId 调用，让错误在请求边界暴露。
  - `assertStoredAppId`（不变量用，内部错误 + 结构化告警）：放在 5+2 个集合/表工厂，值来自库或服务端生成；失败即 `InternalServerErrorException` 并记录 appId 与调用点。
- **补边界校验**：对 `site.controller.ts:46` 的 `@Query("appId")` 与 `upsertSiteForWebMonitor` 的 body 字段显式加 `assertAppId`，否则把客户端错误下沉到 DDL 层，变成 5xx。

**反驳与裁决（针对「统一改 5xx」）**

反对意见：既然 appId 绝大多数来自服务端或库，统一改 5xx 更简单。

裁决：存在真实客户端来源（上表第 2 行）。全局改 5xx 会把客户端输入错误报成服务端故障，污染告警并误导排障。故必须按来源分层，不能一刀切。

## 7. 误报剔除（本轮被推翻的论断）

| 被推翻的论断 | 推翻理由 |
|---|---|
| 「把所有候选的内容 hash 并入 scope 级 `inputSignature` 即可」 | 签名是 scope 级，无法表达条目级差异；并入后任一候选文本变化即令整个 scope 全部失效，缓存命中率坍塌，退化为无缓存。 |
| 「R6-12 应删除，因为没有 controller 入口、是死代码」 | 违反 `project_memory` #31：调用面不能作为删改依据。本轮改以「组织维度不进入未来领域」为唯一理由，结论相同但依据不同。 |
| 「R6-13 统一改为内部错误」 | 见上节反驳：appId 存在客户端来源，统一 5xx 会把客户端错误变成服务端故障。 |
| 「`lastSeenAt` 可作条目内容指纹」 | `upsertOne` 每次采集都刷新 `lastSeenAt`，它反映「最近出现」而非「内容变化」，用作指纹会导致每次采集都失效。 |

## 8. 已核验通过的不变量

1. **负缓存 fail-safe 方向正确**：`unavailable` 判定从不入缓存（`security-evaluation-intel-match.service.ts` 在 `verdict.kind === "unavailable"` 时直接 `continue`），因此 LLM 故障不会固化成「不相关」。
2. **硬召回不依赖缓存**：`hard-hit` 行不参与 `filterUncached`（`verdict` 条件限定 `notRelevant`），实体集动态变化时硬召回每轮都会重跑。
3. **缓存写入幂等**：`(knowledgeItemId, scopeKey)` 唯一键 + upsert，并发 scope 判定不会互相覆盖行。
4. **appId 不进入 DDL 前必校验**：5 个 Mongo 集合工厂 + 2 个 ClickHouse 表工厂首行均调用断言，无绕过路径（`grep` 全量命中）。
5. **API key 越权面当前为零**：`api-key.controller.ts` 只暴露 `/users/:userId/api-keys`，`*ForOrganization` 方法无入口；跨租户越权需先接线才成立。
6. **失败隔离粒度正确**：`report-task.service.ts` 的 ingest flush 按 appId 分组失败，记 `failedAppIds`，不是整批丢弃。
7. **DDL 变更无数据风险**：`ApiKey` 0 行、`SecurityEvaluationThreatVerdictCache` 0 行（容器实测）。

## 9. 覆盖率清单

**审了**

- `security-evaluation`：`judgment/intel/**`（judgment / match service / re-ranker / model-scope / negative-cache port）、`evidence/security-evaluation-evidence.provider.ts`、`persistence/security-evaluation-intel-negative-cache.repository.ts`、`knowledge/security-evaluation-knowledge.service.ts`、`prisma/schema.prisma`、模块根目录测试清单。
- `account`：`modules/api-key/**`（service / controller / module / dto）、`security-ports/api-key.verifier.ts`、`prisma/schema.prisma`、测试文件（组织相关用例 0 命中）。
- `web-monitor`：`shared/utils.ts`、`models/mongo/web-monitor-models.service.ts`、`models/clickhouse/web/{ajax,error}.ts` 断言点、`site.controller.ts`、`site.service.ts`、`web-installation.service.ts`、`report-task.service.ts`。
- 跨仓：`nightwatch-backend/modules.json`（33 个模块键，无 organization）、`prisma/models/account.prisma`、`nightwatch-frontend/src/api/_gen/api.ts`。

**没审**

- `organization` 模块本体（仅作为关联建议）。
- `web-monitor` 的其余 ClickHouse 查询/报表代码、`aws-*`、`evaluation` 框架层。
- 非本轮三条 finding 的其他 R6 项。

## 10. 修复优先级

1. **R6-09**（P1，静默漏报，影响安全结论正确性）—— 双仓交付：端口签名变更 + schema 加两列 + 签名纯函数 + 回归测试 + `db push` + `diff -rq` 零差异。
2. **R6-12**（P2，半个能力，潜在 P0 越权）—— 双仓交付：registry 删除 → `modules apply` → `db push` → apits 重生成。
3. **R6-13**（P2，健壮性/语义）—— 单仓（registry）改动 + 边界校验补齐 + 台账定性修正。

三条互不依赖，可串行执行；R6-12 与 R6-09 触同一批装配流程，建议 R6-09 在前验证流程，R6-12 紧随。

## 11. 台账指针

- 模块真源：`newbie-modules/.trae/documents/findings.md`（R6-09 / R6-12 / R6-13）
- 工作区台账：`devbie/.trae/documents/findings.md`
- 上一轮复核：`devbie/.trae/documents/expert-review-2026-11-04-round6-fix-verification.md`

本轮不改写上述台账：状态变更与修复 commit 由修复会话写入。

## 12. 补充裁决（同日追加）：R6-09 方案收敛

§5 给出的两层签名（scope 级 `inputSignature` + 条目级 `contentFingerprint`）**方向正确，但不是最标准形态**。裁决如下。

**不足三条**

1. **手工枚举失效维度**。签名要求人工列出「实体集 + 模型 + 提示词版本 + 条目文本」。任何新增的判定输入（实体 `context`、`temperature`、`responseFormat`、未来的规则表版本）只要忘了同步进签名，缓存就会**静默脏读**——在安全评估里脏读等于漏报。这是缓存键设计的典型缺陷（enumerate-and-forget）。
2. **提示词版本靠人工 bump**。`SECURITY_EVALUATION_INTEL_PROMPT_VERSION` 是纪律约束，不是机制约束；忘记 bump 即产生陈旧判定。用内容哈希替代常量可把「纪律」换成「机制」。
3. **一致性靠约定而非构造**。读侧（evidence 采集）与写侧（judgment 记录）各自解析模型、各自调用哈希函数；两者一致依赖"大家都调同一个函数"的约定。把「模型实际输入」的装配收敛到一个纯函数后，签名的正确性成为**构造性质**（hash 的就是模型看到的字节）。

**推荐形态：内容寻址单签名**

新增纯函数 `judgment/intel/security-evaluation-intel-request.ts`，同时产出**发给模型的请求**与其**签名**：

```ts
export interface IntelReRankRequest {
  messages: { role: "system" | "user"; content: string }[];
  responseFormat: "json";
  temperature: number;
  signature: string; // sha256(model + system + user + options)
}

export function buildIntelReRankRequest(
  item: { title: string; summary?: string | null },
  entities: readonly SecurityEvaluationScopeEntity[],
  modelId: string | null,
): IntelReRankRequest;
```

- 写侧（`SecurityEvaluationIntelMatchService`）与读侧（`collectIntel`）都只调这一个函数：写侧取 `messages` 发请求、取 `signature` 落库；读侧只取 `signature` 比对。
- schema 只加**一列** `inputSignature String?`（不再拆两列）；`null` 或不等即视为未缓存。
- 唯一键保持 `@@unique([knowledgeItemId, scopeKey])`，`record` 仍 upsert 覆盖（不扩唯一键，避免行数无界增长）。
- 提示词改动、实体 `context` 开始下传、采样参数调整，全部**自动失效**，无需改签名代码。
- 诊断需求（区分「scope 变了」还是「条目变了」）用日志字段承载，不进 schema。
- `updatedAt` + TTL 必须保留：同一 `modelId` 的后端行为漂移无法被任何签名感知，TTL 是唯一兜底。

**附带发现（不新增 finding ID，随 R6-09 修复一并处理）**

`SecurityEvaluationScopeEntity.context` 在投影链中被丢弃：`collectIntel` 的 declared item payload 只带 `entity: entity.value`，`SecurityEvaluationIntelJudgment.entities()` 也只重建 `{ value }`，而 [security-evaluation-intel-re-ranker.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/intel/security-evaluation-intel-re-ranker.ts) 仍按 `e.context ?? null` 发送——即端口声明的 `context` **从未到达模型**。这正是「手工枚举维度」的现成反例：将来把 `context` 接通时，枚举式签名不会自动感知，内容寻址会。

**结论**：R6-09 修复采用内容寻址单签名；§5 的两层签名作为过程方案保留在本报告，不进入实现。
