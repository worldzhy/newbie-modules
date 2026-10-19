# ADR-005: LLM 连接配置与 scope 绑定分离——两表模型取代 per-scope 记录

状态：已采纳（2026-10-13 用户批准方案 B：两表分离）
日期：2026-10-13
归属注记：本决策治理 newbie-modules 模块代码，单一源存放于本仓（nightwatch-backend 侧编号 ADR-006，该处现为同编号重定向存根）。2026-10-19 起按单一源规则执行。
Supersedes：ADR-005 的决策 2（scope 作为记录固有属性、per-scope 唯一 active 记录）与决策 7 中的 activate 语义

## 触发问题

ADR-005 把 scope 维度放在了 LlmModel 记录上——一条记录 = 一个 scope + 一个连接配置（provider + model + baseUrl + apiKey），per-scope partial unique index 保证单 scope 单 active。

这个设计有一个隐含假设：**不同消费方可能需要不同的连接配置**。但当多个消费方恰好使用完全相同的 provider/model/baseUrl/apiKey 时，就暴露出结构性冗余：

| 问题                 | 表现                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| 凭证冗余             | jdy 和 copilot 用同一个 DeepSeek 端点，API Key 存两份，改 key 要改两处      |
| health 冗余          | 同一条连接的健康状态被记录两次，且可能不一致（一条刚 probe 过、另一条还没） |
| Test Connection 冗余 | 同一条连接的可用性测试要做两次                                              |
| activate 冗余        | 想让所有 scope 共用一个新模型，得逐条 activate                              |

根本原因：scope 是"谁使用这条连接"的**分配关系**，不是连接的**固有属性**。把两者绑在同一张表上，等于在每条记录里嵌入了一个隐式的一对一分配关系，导致"多对一共享"无法自然表达。

## 候选方案

### 方案 A：default scope fallback（轻量）

`LlmModelService.getActive(scope)` 先查 exact scope，没记录再 fallback 到 scope=`"default"`。无 schema 变更、无 migration，一条 `"default"` 记录可被所有 scope 共享。

缺点：隐式 fallback 语义；无法表达"某些 scope 共享 default、个别 scope 有专属"的混合场景；active 概念模糊（default 的 isActive 和具体 scope 的 isActive 是两套）。

### 方案 B：两表分离（本 ADR 采纳）

- **LlmConnection**（连接配置表）：provider + model + baseUrl + apiKey + name + health 快照——一条记录描述一个可调用的 AI 端点
- **LlmScopeAssignment**（scope 绑定表）：scope（唯一）→ connectionId——一条记录表达"scope X 使用连接 Y"

共享关系变成显式多对一：多个 LlmScopeAssignment 可以指向同一条 LlmConnection。health 和 Test Connection 只跟 LlmConnection 有关，scope 不参与连接层。

### 方案 C：维持现状 + 接受冗余

用户手动维护多条记录，各自独立切换、独立 health、独立 activate。语义最直观但用户体验差，且冗余是可消除的。

## 决策

### 1. Schema 拆分

**LlmConnection**（替代原 LlmModel 的连接字段 + health 字段）：

```prisma
model LlmConnection {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name      String   @db.VarChar(255)
  provider  String   @default("openai-compatible") @db.VarChar(40)
  model     String   @db.VarChar(255)
  baseUrl   String   @db.VarChar(255)
  apiKey    String   @db.VarChar(500)

  // Health snapshot (shared across all scopes using this connection)
  lastCallAt          DateTime?
  lastCallSuccess     Boolean?
  lastFailureCategory String? @db.VarChar(20)
  lastFailureMessage  String? @db.VarChar(500)

  scopes    LlmScopeAssignment[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@schema("module/llm")
}
```

**LlmScopeAssignment**（新增，scope 绑定关系）：

```prisma
model LlmScopeAssignment {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  scope        String   @unique @db.VarChar(64)
  connectionId String   @db.Uuid
  connection   LlmConnection @relation(
    fields: [connectionId],
    references: [id],
    onDelete: Cascade
  )

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@schema("module/llm")
}
```

关键设计：

- scope 是 LlmScopeAssignment 的唯一键——一个 scope 只能绑定一条 connection，不存在 isActive 字段（assignment 存在即激活）
- health 字段从 LlmModel 移到 LlmConnection——健康是连接的状态，不是 scope 的；同一条连接被多 scope 共享时 health 自然共享
- LlmConnection 删除时级联删除所有引用它的 LlmScopeAssignment

### 2. Migration 策略

旧表 `LlmModel` 按连接维度去重（同 provider + model + baseUrl + apiKey 合并为一条 LlmConnection），每条旧记录的 scope 转为一条 LlmScopeAssignment：

```sql
-- 1. 去重旧 LlmModel，按连接维度合并为 LlmConnection
INSERT INTO "module/llm"."LlmConnection" (id, name, provider, model, "baseUrl", "apiKey", "lastCallAt", "lastCallSuccess", "lastFailureCategory", "lastFailureMessage", "createdAt", "updatedAt")
SELECT DISTINCT ON (provider, model, "baseUrl", "apiKey")
  gen_random_uuid() as id,
  name, provider, model, "baseUrl", "apiKey",
  "lastCallAt", "lastCallSuccess", "lastFailureCategory", "lastFailureMessage",
  "createdAt", "updatedAt"
FROM "module/llm"."LlmModel";

-- 2. 每条旧记录生成一条 LlmScopeAssignment，指向去重后的连接
INSERT INTO "module/llm"."LlmScopeAssignment" (id, scope, "connectionId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  scope,
  c.id,
  m."createdAt", m."updatedAt"
FROM "module/llm"."LlmModel" m
JOIN "module/llm"."LlmConnection" c
  ON m.provider = c.provider
 AND m.model = c.model
 AND m."baseUrl" = c."baseUrl"
 AND m."apiKey" = c."apiKey";

-- 3. 删除旧表
DROP TABLE "module/llm"."LlmModel";
```

### 3. API 契约重构

| 旧端点                          | 新端点                                          | 语义变化                                                                                |
| ------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /llm/models`               | `GET /llm/connections`                          | 返回所有连接，每项带 `scopes: string[]`                                                 |
| `POST /llm/models`              | `POST /llm/connections`                         | 创建连接配置，不再带 scope                                                              |
| `PATCH /llm/models/:id`         | `PATCH /llm/connections/:id`                    | 更新连接                                                                                |
| `DELETE /llm/models/:id`        | `DELETE /llm/connections/:id`                   | 删除连接（级联解绑）                                                                    |
| `POST /llm/models/:id/test`     | `POST /llm/connections/:id/test`                | 测试连接（同上一次提交的统一 adapter 路径）                                             |
| `POST /llm/models/:id/activate` | `PATCH /llm/scopes/:scope` → `{ connectionId }` | activate 语义变为"scope X 绑定到连接 Y"；旧的 per-scope deactivate 由新 assignment 覆盖 |
| ——                              | `DELETE /llm/scopes/:scope`                     | 解绑 scope（该 scope 的消费方报 NoActiveScopeError）                                    |

DTO 重命名：`LlmModelResponseDto` → `LlmConnectionResponseDto`（新增 `scopes: string[]`）；新增 `AssignScopeDto`（`connectionId: string`）。

### 4. ChatModelResolver 适配

`resolve(scope: string)` 逻辑变更：

```
旧: 查 LlmModel WHERE scope = ? AND isActive = true → NoActiveModelError
新: 查 LlmScopeAssignment WHERE scope = ? → 拿 connectionId → 查 LlmConnection 不存在时 → NoActiveScopeError
```

health decorator 不变——port 构建后仍用 withHealthTracking 包装，outcome 落 `LlmConnection`。

### 5. ModelStatusProbeService 适配

遍历 `listConnections()`（而非 `listActiveModels()`），每条 LlmConnection probe 一次，probe 结果经 health decorator 落库。

### 6. 错误类型

删除 `NoActiveModelError`，新增 `NoActiveScopeError(scope)`——语义更精确：scope 未绑定任何 connection。

## 影响面

- **newbie-modules registry**：llm 模块 prisma schema 全量重写；management/service/controller/dto 改名 + 重写；ChatModelResolver/ModelStatusProbeService 适配；registry 自身 clean 全量构建 + 测试 + `newbie dev lint`。
- **nightwatch-backend**：手写 migration（旧 LlmModel → LlmConnection + LlmScopeAssignment 去重拆分 + 删旧表）；装配后 host 层 import 路径/类型名更新（jdy service、backend-monitor、copilot 等消费方的 `NoActiveModelError` → `NoActiveScopeError`）。
- **nightwatch-frontend**：settings/models 页面重写为"连接列表 + scope 分组"视图；copilot-dock 的 `model.scope === "copilot" && model.isActive` 过滤改为查 `getLlmScopes` 或同一条 `getLlmConnections()` 结果里 scope 为 copilot 的连接；model-status 组件类型从 `LlmModelResponseDto` 改为 `LlmConnectionResponseDto`；apits 重生成。
- **验证**：migration 后检查 LlmConnection 去重正确（原 jdy + copilot 两条同 DeepSeek 记录合并为一条 LlmConnection，两条 LlmScopeAssignment 各指一条）；E2E 覆盖 scope 绑定/解绑、共享连接 health 传播（jdy 调用更新 copilot-dot 的状态）、无绑定 scope 的友好错误。

## 不做什么

- **不引入 default fallback**：隐式语义。需要共享时直接把多个 scope 绑定到同一条 LlmConnection 即可。
- **不做连接级别的环境变量桥接**：同 ADR-005 决策 6，env 来源已清理。
- **不引入 provider/connection 二级分离**（经验库 1323838 的建议）：当前 provider/model/baseUrl/apiKey 四元组即连接定义；同 baseUrl 多 model 是 LlmConnection 多条不同记录（baseUrl 相同但 model 不同），不需要 Provider 抽象。
