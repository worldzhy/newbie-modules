# ADR-017: Scope 名称从模块装饰器移到宿主配置

状态：已采纳
日期：2026-10-23
取代：ADR-012 §3（scope 名称在装饰器 options 里声明）+ ADR-012 §5（框架内置 defaultProjectScopeResolver）

## 背景

当前 newbie-modules 的 controller 在 `@RequirePermission` 装饰器里硬编码 scope 名称：

```typescript
// packages/modules/aws-cloudwatch/ec2-instance/ec2-instance.controller.ts
@RequirePermission(PermissionAction.List, Prisma.ModelName.Ec2Instance, { scope: "project" })
```

这里 `"project"`、`"application"`、`"task"`、`"task-space"` 是 nightwatch-backend 的业务词汇（宿主数据模型里有 Project 表、ProjectMember 表、projectId 外键）。换一个宿主（比如没有 project 概念的单租户 SaaS），这些 scope 名称就对不上号了。违反 newbie-modules 设计原则：

> **禁止把具体宿主或厂商概念焊进通用模块**

ADR-012 的原始设计意图是"框架不绑宿主"，但 scope 名称作为字符串暴露在装饰器 API 里后，宿主特定词汇就不可避免地泄漏进了模块源码。

## 候选方案

| 方案 | 模块层 | 宿主层 | 框架层改动 |
|------|--------|--------|------------|
| **A. 什么都不做** | 保持 `{ scope: "project" }` | 注册同名 resolver | 无改动 |
| **B. scope 名称移到宿主配置（选定）** | 移除 `{ scope: ... }` | 提供 `HOST_SCOPED_RESOURCES: Record<scopeName, resourceNames[]>` 配置表 | Guard 从装饰器参数查 scope → 从宿主配置表查 scope |
| C. scope 参数可选化 + 默认跳过 | `{ scope?: string }` 可选 | 有 scope 的资源传，没有的跳过 | 检查 scope 参数，无参数则跳过 |

## 决策

**方案 B**。决定性理由：

1. **模块零业务感知**：模块只声明"操作资源"，完全不知道 scope、project 等词汇——这是"框架不绑宿主"原则的真正实现
2. **宿主完全控制**：换宿主只改配置表 + resolver，模块一行不动
3. **零架构变化**：resolver 机制不变，只是查找方式从"装饰器参数"变成"宿主配置"——现有 4 个 resolver（project 默认 + application + task + task-space）直接复用
4. **改动量极小**：模块侧移除 25 处 scope 参数（机械），宿主侧加 ~30 行配置表，框架 Guard 改 ~20 行自动查找逻辑

**被否决的方案**：

- **A**：维持现状，继续泄漏宿主概念到通用模块
- **C**：表面"可选化"，实际上是"没传参数就跳过 scope 检查"——等于给 scope 机制留后门；同时无法表达"资源 A 必须 project scope"的约束

## 跨宿主 / 演进检验

| 维度 | 框架层（SPI） | 宿主层（实施） |
|------|--------------|----------------|
| 接口签名 | `@RequirePermission(action, resource)` 移除 `options.scope`；Guard 注入新 token `HOST_SCOPED_RESOURCES: Record<string, string[]>` | `ScopeResolver` 接口不变；`SCOPE_RESOLVERS` token 不变；resolver 实现不变 |
| Scope 类型 | `type Scope = { type: "none" } | { type: "project"; id: string }`（ADR-012 原契约不变） | 宿主决定有哪些 scope 类型；框架不定义 |
| 资源枚举 | 框架层不定义 | 宿主自定（Prisma.ModelName + 字符串字面量） |
| 可移植性 | 任意消费方按本 ADR 装配即可 | matrix、种子数据是宿主特有 |

换一个宿主（比如单租户 SaaS，没有 project 概念，用 organization 做隔离）：

```typescript
// 宿主 B 的 authorization.module.ts
const HOST_SCOPED_RESOURCES = {
  organization: ["Ec2Instance", "RdsInstance", "AwsSecretsManagerSecret", ...],
};

// scope-resolvers.ts（宿主 B 自有）
const SCOPE_RESOLVERS = {
  organization: async (ctx) => {
    // 宿主 B 用 organizationId 做隔离
  },
};
```

模块一行不动。resolver 实现也可以不同——宿主 A 用 `projectId` 解析，宿主 B 用 `organizationId` 解析。框架层完全不知道两者的区别。

**成立**。模块只声明资源+操作，scope 是宿主安全策略，不是模块领域的一部分。

## 影响

### 1. newbie-modules（框架 SPI 源码）

| 文件 | 改动 |
|------|------|
| `packages/modules/security/authorization/require-permission.decorator.ts` | `RequirePermissionOptions.scope` 移除（过渡期可保留为可选但 Guard 不再读取） |
| `packages/modules/security/authorization/authorization.guard.ts` | 新增注入 `HOST_SCOPED_RESOURCES` token；L64-73 的"从 metadata.scope 查 resolver"改为"从宿主配置表自动查 scope 名称" |
| `packages/modules/security/authorization/scope.resolver.ts` | **不动**（`ScopeResolver` 接口 + `SCOPE_RESOLVERS` token 保持原契约） |
| SPI 新增 token | `HOST_SCOPED_RESOURCES: Record<string, string[]>`（scope 名称 → 资源名称数组） |

### 2. newbie-modules（registry 模块 controller）

| 改动 | 数量 |
|------|------|
| 移除 `{ scope: "project" }` / `{ scope: "application" }` / `{ scope: "task" }` / `{ scope: "task-space" }` | **约 25 处**，10 个 controller 文件 |
| provider / service 层 | 不动（scope 只出现在 controller 装饰器） |

### 3. nightwatch-backend（宿主）

| 改动 | 说明 |
|------|------|
| `src/application/authorization/authorization.module.ts` | 新增 `HOST_SCOPED_RESOURCES` 配置表，注册 token |
| `src/application/authorization/scope-resolvers.ts` | **不动**（4 个 resolver 直接复用） |
| `src/application/authorization/scope-role-permission.matrix.ts` | **不动**（矩阵不涉及 scope 名称，只涉及角色等级） |
| controller 路由层 | **不动** |

### 4. 迁移顺序

1. 框架层：Guard 支持新机制（从宿主配置表查 scope），同时兼容旧 `metadata.scope`（双轨并行）
2. 宿主层：新增 `HOST_SCOPED_RESOURCES` 配置表，双轨并行（旧装饰器 scope 参数 + 新配置表同时生效）
3. newbie-modules：移除 25 处 scope 参数（机械改动，一行一行删）
4. 验证：tsc + eslint + 测试全绿
5. 清理：框架层移除旧 `metadata.scope` 读取逻辑（下一里程碑）

### 5. 后续工作

- `HOST_SCOPED_RESOURCES` 可演进：scope 可以是数组（一个资源多层级 scope），框架层做笛卡尔乘积检查
- 宿主配置表可以被其他宿主消费方直接参考（配置是纯数据，不泄漏模块源码）
- ADR-012 后续里程碑追加 Superseded by: ADR-017（scope 名称声明位置变更）

---

## 勘误修订（2026-10-23，实施前）

### 触发原因

实施前发现正文中的机制设计（`HOST_SCOPED_RESOURCES: Record<scopeName, resourceNames[]>`）有根本问题：

1. **不存在 scope 名称这个东西**。SPI 里 Scope 类型只有两种：`{ type: "none" }` 和 `{ type: "project"; id: string }`。正文中 `"project"`、`"application"`、`"task"`、`"task-space"` 这些字符串不是 scope 名称，是 **resolver key**（"怎么从请求参数里找到 projectId"的查找策略标识符）
2. **同一个 resource 出现在多个 resolver key 下**。Task 资源在三个 resolver key 下出现：
   - `task`（路由 `PATCH tasks/:taskId`，从 taskId 追 projectId）
   - `task-space`（路由 `POST tasks/batch`，从 body.spaceId 追 projectId）
   - `project`（路由 `POST task-spaces/:projectId/tasks`，projectId 直给）
3. **Record 模型反查不唯一**。从 resource 名反查 resolver key 会匹配多个，Guard 拿不到唯一答案

### 修订内容（方向不变，机制简化）

| 正文位置 | 旧值 | 修订为 |
|---------|------|--------|
| §候选方案 B | `HOST_SCOPED_RESOURCES: Record<scopeName, resourceNames[]>` | `HOST_SCOPED_RESOURCES: string[]`（扁平资源名列表，标记"这个资源需要 scope 解析"） |
| §跨宿主接口签名 | `Guard 注入 HOST_SCOPED_RESOURCES: Record<string, string[]>` | `Guard 注入 HOST_SCOPED_RESOURCES: string[]` + 遍历 SCOPE_RESOLVERS（宿主控制优先级） |
| §跨宿主换宿主例子 | `HOST_SCOPED_RESOURCES = { organization: [...] }` | `HOST_SCOPED_RESOURCES = ["Ec2Instance", "RdsInstance", ...]`；resolver 注册顺序决定优先级 |
| §影响 1 SPI 新增 token | `HOST_SCOPED_RESOURCES: Record<string, string[]>` | `HOST_SCOPED_RESOURCES: string[]` |
| §影响 1 Guard 改动 | "从宿主配置表自动查 scope 名称" | "resource 在 HOST_SCOPED_RESOURCES 里 → 按宿主注册顺序遍历 SCOPE_RESOLVERS → 第一个返回非 `{type:"none"}` 的即为 scope" |
| §影响 3 宿主配置 | "新增 `HOST_SCOPED_RESOURCES` 配置表" | "新增 `HOST_SCOPED_RESOURCES` 配置（string[]），resolver 注册顺序即优先级" |

### 新机制说明

**HOST_SCOPED_RESOURCES token**（SPI 新增）：

```typescript
// packages/modules/security/ports/scope.resolver.ts
export const HOST_SCOPED_RESOURCES = Symbol("HOST_SCOPED_RESOURCES");
// 类型：Record<string, string[]> → 勘误为 → string[]
```

**Guard 逻辑**（勘误后）：

```
旧 metadata.scope 存在？
  ├─ 是 → 走旧路：resolver = scopeResolvers[metadata.scope] ?? defaultProjectScopeResolver
  └─ 否 → resource 在 HOST_SCOPED_RESOURCES 里？
              ├─ 是 → 按 SCOPE_RESOLVERS 注册顺序遍历，第一个返回非 {type:"none"} 的即为 scope
              └─ 否 → scope = undefined（系统级检查）
```

**为什么可行**：所有 5 个现有 resolver（task、task-space、application、url-monitor-target、defaultProjectScopeResolver）在缺少参数时短路返回 `{type:"none"}`。性能开销可忽略。宿主通过 SCOPE_RESOLVERS map 的 key 插入顺序控制优先级——具体 resolver（task/task-space/application/url-monitor-target）排前，defaultProjectScopeResolver 排最后兜底。

### 决策不变

本修订不改 §背景、§候选方案、§决策的任何理由。核心方向——**移走模块装饰器里的宿主特有词汇（"task"、"task-space"、"application"、"project" 这些 resolver key），让模块零业务感知**——完全不变。修订的是机制细节（从"反查映射"简化为"优先级遍历"），不是决策本身。

### 受影响的实施步骤

实施章节保持原迁移顺序不变（Phase 1 双轨 → Phase 2 移除 scope 参数 → 验证 → back-port）。只是 Phase 1 的具体代码按本勘误的新机制写。

---

## 勘误修订 2（2026-10-23，实施后严肃复查）

实施完成后的逐项复查发现三类缺口，均已在同一批改动中修复。决策与机制不变，本节记录**机制落地时必须配套的三件事**。

### 1. 护栏盲区（回归，已修）

首版实施只改了 Guard 与 controller，没同步两个校验器——它们都只认旧机制的 `{ scope: ... }` 键：

| 护栏 | 首版问题 | 修复 |
|---|---|---|
| 启动期矩阵校验（host `MatrixCompletenessValidator`） | 只收集带 `scope` 元数据的资源 → 迁移后 8 个模块资源不再被校验 | 改为 `legacy scope ∪ HOST_SCOPED_RESOURCES` 取并集 |
| CI 契约测试（host `rbac-contract.test.ts`） | 同上 → 测试仍绿，但对已迁移资源完全失效；且单行正则漏掉 prettier 换行后的多行 decorator | 改为并集校验 + 全文多行正则 + 行号按匹配偏移计算 |

**教训**：把某个判据从 A 位置搬到 B 位置时，所有"读 A 位置"的校验器都要同步搬；否则护栏静默失效，且测试仍绿。

### 2. 资源粒度语义（设计澄清）

`HOST_SCOPED_RESOURCES` 是 **resource 级**白名单，不是 `(resource, action)` 级。因此该资源的**所有** action 都会尝试解析 scope，而旧机制允许逐 action 显式声明或不声明。

已核实的等价性与差异：

| 路由 | 旧机制 | 新机制 | 结论 |
|---|---|---|---|
| `PATCH /tasks/:taskId` | `{scope:"task"}` | task resolver 命中 | 等价 |
| `POST /tasks/batch`（body.spaceId） | `{scope:"task-space"}` | task-space resolver 命中 | 等价 |
| `POST /dependency-scan/applications/:applicationId/scan` | `{scope:"application"}` | application resolver 命中 | 等价 |
| `GET /ec2-metric?projectId=` | `{scope:"project"}` | project resolver 命中 | 等价 |
| `GET /task-spaces/by-project/:projectId` | **无 scope**（系统级） | project resolver 命中 → 项目级 | **行为变更**：成员从 403 → 允许 |

最后一行是唯一的实际变更，方向为放宽且符合 nightwatch-backend ADR-019 的语义（项目成员应能访问自己项目），但**必须知道它是白名单的副作用**，不是显式决策。若未来需要 action 级精度，应升级 token 类型为 `Record<resource, actions[]>`，而不是回到装饰器携带 key。

### 3. 迁移面遗漏（已修）

首版按当时的模块清单做一次性迁移，漏掉复查前才装配进宿主的 url-check 模块（8 处 legacy 键：2×`project` + 6×`url-monitor-target`）。

**根因**：registry 是装配真源，迁移必须**先改 registry、再同步消费者**；只改消费者会被下一次 `newbie assemble` 还原。本次已改 registry 的 `url-check.controller.ts` 并把 `UrlMonitorTarget` 加入 `HOST_SCOPED_RESOURCES_LIST`（对应 `url-monitor-target` resolver 早已注册，此前只能通过 legacy 键到达）。

### 4. 下一里程碑：清退 legacy 轨道

legacy 键并非死代码——宿主 app 层仍有 43 处 `{ scope: ... }`（Project / Application / SecurityOverview / ProjectDashboardMetric / AiAnalysisReport 等）。清退计划：

1. 把 app 层控制器的 scope 键全部移除，资源逐个登记进 `HOST_SCOPED_RESOURCES`
2. 删除 Guard 的 legacy 分支与 `RequirePermissionOptions.scope`（当前已标 `@deprecated`）
3. 删除对 `defaultProjectScopeResolver` 的直连兜底引用

清退前，`@deprecated` 标注与本节即为唯一约束。模块侧从现在起**禁止**新增 `{ scope: ... }`（registry 已无任何模块使用）。
