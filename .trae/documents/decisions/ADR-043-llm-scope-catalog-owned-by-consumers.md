# ADR-043: LLM scope 目录由消费者注册，绑定以目录为主实体

状态：已采纳（2026-10-28 用户批准）
日期：2026-10-28
归属注记：本决策治理 newbie-modules 的 `llm` 模块契约，单一源存放于本仓。
Supersedes：ADR-005 的「GET 只返回已绑定 scope」与「PATCH 以自由 body 传 connectionId」两处接口语义（两表模型、级联清理、upsert 移动等其余契约保持）

## 触发问题

ADR-004/ADR-005 定下"连接（凭证 + 当前模型）与 scope 绑定分离"的两表模型后，scope 名单仍散落在两处，且互不同步：

| 真源                 | 位置                                                         | 漂移表现                                                     |
| -------------------- | ----------------------------------------------------         | ------------------------------------------------------------ |
| 代码里实际解析的 scope | 5 个消费者各自的常量（copilot / analysis / jdy / work-evaluation / security-evaluation-intel） | 新增消费者时管理页不会自动出现                             |
| 管理页可选项          | 前端硬编码的 `SCOPE_SUGGESTIONS`                             | 只有 4 项，漏掉 `security-evaluation-intel`，绑定该 scope 只能靠手输 |
| 绑定 API             | `PATCH /llm/scopes/:scope` 用自由 body + 手写 ApiBody        | 拼错 scope 也能写库；缺字段抛 `Error` → 500；无白名单校验   |
| 绑定列表 API          | `GET /llm/scopes` 只返回已有绑定                             | 未绑定的 scope 在管理页不可见，无法"先看全貌再选择"          |

根因：scope 是**消费者声明的领域概念**，llm 模块并不知道有哪些；让前端或运维去猜，必然漂移。

## 决策

1. **目录端口归 llm 模块**：`llm` 模块新增 `LlmScopeCatalog`（`{ scope, label }` 注册表），作为 `@Global` 模块导出；llm 自身不硬编码任何具体 scope。
2. **消费者在启动时注册**：每个消费者在自己的 `onModuleInit` 中调用 `catalog.register({ scope, label })`，声明所拥有的常量与人类可读名称。注册发生在请求服务之前，目录在首个请求到达时必然完整。
3. **重复注册即失败**：同一 scope 被两个消费者注册时抛错并阻止启动——一个 scope 只能有一个所有者，避免"谁在用它"再次分叉。
4. **GET `/llm/scopes` 返回目录 ⋈ 绑定**：以目录为主实体，逐个列出（含 `connectionId: null` 的未绑定项），字段为 `scope`、`label`、`connectionId`、`connectionName`、`connectionModel`。已不在目录中的历史绑定仍会追加返回（`label` 回退为 scope 原值），保证残留行可见、可解绑，但不可再绑定。
5. **PATCH `/llm/scopes/:scope` 收紧契约**：body 改为 `BindLlmScopeDto { connectionId }`（`@IsUUID`）；未注册的 scope 返回 400，连接不存在返回 404；成功即 upsert（跨连接移动仍是移动，不产生第二行）。DELETE 语义不变（按 scope 解绑，包括残留 scope）。
6. **管理页以绑定为操作单位**：删除前端硬编码 `SCOPE_SUGGESTIONS` 与自由文本绑定入口；"Scope Bindings" 区块按目录逐行展示，行内下拉选择连接完成绑定。连接行上的 scope 徽标只读，不再提供重复的破坏性解绑入口（删除连接时的级联清理仍会列出受影响 scope）。
7. **编辑连接时提示影响面**：连接被若干 scope 绑定时，编辑弹框显式说明"改动应用到这些 scope 的下一次调用，并重置健康状态；改名不影响"。

## 行为级测试

`llm-scope.service.test.ts` 覆盖：重复注册抛错、未知 scope 绑定拒绝（400）、未知连接绑定拒绝（404）、未绑定 scope 出现在列表、残留绑定仍可见、跨连接移动不产生重复行、解绑后仍以未绑定状态列出。

## Cross-host check

| 维度       | 框架层（newbie-modules `llm`）                                             | 宿主层（nightwatch-backend）                                                 |
| ---------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 目录声明   | `LlmScopeDefinition { scope, label }` + `LlmScopeCatalog.register/list/has`   | 5 个消费者各自持有常量与注册 provider；`analysis` 常量从 service 私有导出     |
| 注册时机   | `onModuleInit`，由 Nest 生命周期保证先于请求                                 | 各消费模块把 `*ModelScopeRegistration` 加入 `providers`                       |
| 资源枚举   | 不定义具体 scope                                                             | 消费者决定 scope 字符串与 label（copilot / analysis / jdy / work-evaluation / security-evaluation-intel） |
| 可移植性   | 任意宿主按本 ADR 装配即可；新增消费者只加一行注册                            | 管理页与 API 自动收敛，无需改 llm 模块或前端常量                              |
| 权限       | 绑定写操作仍走 `LlmScopeAssignment` 资源上的 `Manage`                         | 宿主 seed 与角色映射不变（权限对齐是独立里程碑，不在本 ADR 内）               |

## 后果

- 新增/删除消费者：只改消费者自身的注册与常量，管理页自动同步；残留绑定可见并可清理。
- 拼写错误、未注册 scope、非法连接 ID 在入口即被拒绝，不再产生死绑定。
- 前端不再维护第二份 scope 名单，消除"少一个 scope"的结构性缺陷。
- 代价：消费者必须记得注册；漏注册的 scope 无法绑定（这正是期望的失败方向，比静默漂移安全）。

## 参考

- ADR-004（统一 LLM 模型提供方）
- ADR-005（连接配置与 scope 绑定分离）
- 实现：`packages/modules/llm/management/llm-scope-catalog.service.ts`、`llm-scope.service.ts`、`llm-scope.controller.ts`
