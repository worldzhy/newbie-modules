# Expert Review Round 36 — copilot 模块：基于平台功能的完善缺口

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 备注 |
| --- | --- | --- | --- | --- |
| newbie-modules | dev | `8cbc60f` | 干净 | 模块真源 |
| nightwatch-backend | dev | `2c4212a` | 干净 | 唯一装配宿主 |
| nightwatch-frontend | dev | `4c25111` | 4 个 dirty 文件（`iam/users/page.tsx`、`iam/users/user-modal.tsx`、`i18n/messages/en.json`、`i18n/messages/zh.json`） | dirty 落在 iam 域，非被审域，copilot 结论不受污染，不标 provisional |

评审时间：2026-11-11 12:25 CST 开始，当日结束（Asia/Shanghai）。评审会话只读，未改代码。

## 2. 范围与方法

- `scope: modules: [copilot]`，评审动机为用户提问「基于目前的平台功能，copilot 需要哪些完善」——本报告以**平台功能 ↔ copilot 覆盖**对照为主线。
- 解析范围：真源 `newbie-modules/packages/modules/copilot/**`；装配面由 `nightwatch-backend/newbie-modules.json:147-151` 命中（sourceCommit `a7718c6`）；随之纳入 `nightwatch-backend/src/modules/copilot/**`、`nightwatch-backend/src/application/copilot/**`、`nightwatch-backend/src/application/chat-binding/**`、`nightwatch-frontend/src/components/copilot/**` 与 `src/api/copilot/**`。对照基线（平台功能）取自 nightwatch-backend `src/application/**` 控制器与 nightwatch-frontend `app/(dashboard)/**` 页面。
- 明确排除：llm 模块本体（仅核对接口接缝）、非 copilot 域的业务实现细节、生成物（prisma/migrations、frontend `_gen`）。
- 方法：3 路并行 Explore 子代理做清单盘点（kernel / 宿主 skill 与传输层 / 平台功能与前端面），主会话对全部关键结论逐条读码复核；计数全部附命令出处。
- 装配一致性：`diff -rq packages/modules/copilot nightwatch-backend/src/modules/copilot` → exit 0，零差异。

## 3. 结论摘要 + 维度评分

**结论（定论）**：copilot 的 kernel 骨架（agent 循环、确认门、幂等重放、块协议、审计缝）完整且装配一致；当前缺口集中在**覆盖面**——平台 14 个 dashboard 页面中 11 个无路由上下文，17 个 skill 只覆盖 7 个功能域，写能力仅任务域 3 个技能；另有 1 条治理缺口（工具级动作不入平台审计库）与 1 条文案契约漂移。

| 维度 | 评分 | 依据 |
| --- | --- | --- |
| 安全 | 良好 | 身份 only from `req.user`、会话/确认归属绑定、写技能全量确认门；未发现新 P0 |
| 架构 | 中 | kernel/传输/技能三层清晰；但平台内存在第二条独立 AI 管线（`/analysis/chat`）与 kernel 不互通（R36-06） |
| 契约 | 中 | `/security-evaluation` 推荐提示词引用不存在的 project 上下文（R36-02） |
| 测试 | 良好 | kernel 6 个测试文件（blocks/system-prompt/consume-agent-run/agent-kernel/conversation-store/audit-logging）+ 宿主 skill/datasource 测试 + 前端 chat-stream 测试 |
| 门禁 | 良好 | 装配 diff 零差异；模型预检 fail-closed |
| 治理 | 弱 | copilot 工具级动作不进平台审计库，audit-logs 页不可见（R36-01） |

## 4. P0

无。

## 5. P1

### R36-01（nightwatch-backend + newbie-modules）copilot 工具级动作不入平台审计库

- 证据：
  - `grep -r "AuditService|audit\.record|AUDIT" nightwatch-backend/src/application/copilot` → 0 命中（命令已跑）。
  - `grep -ri "audit" nightwatch-backend/src/modules/task-management` → 0 命中（命令已跑）；copilot 写技能委托的同一服务（`application/copilot/skills/datasource/task.datasource.ts:164,291` 调 `tasks.createTask/deleteTask`）自身也不写审计。
  - 平台审计模块只有 HTTP 信封级拦截器：`nightwatch-backend/src/modules/audit/http-access.interceptor.ts`；copilot 的工具调用发生在单个 `POST /copilot/chat` SSE 运行内部，审计页只能看到聊天请求信封，看不到「哪个用户在哪个项目删除了哪个任务」。
  - kernel 审计缝存在但落点为 stdout：`newbie-modules/packages/modules/copilot/observability/copilot-audit.logger.ts:14-16` 仅 `Logger.log(JSON.stringify(entry))`，不入 audit 模块的 Prisma 存储，audit-logs 页查询不到。
- 可达性：任意登录用户（web 传输 `@RequireOwner()` 为 self-by-token 构造成立，`transports/web/chat.controller.ts:53-54`）。
- 暴露面：live。
- 影响：可追溯性治理缺口——`create_task/update_task_status/delete_task` 三个写动作及确认决策（confirmed/denied）在平台审计 UI 不可见；违反「不可追溯零容忍」价值观。
- 缓解（定级依据）：kernel stdout JSON 审计含 userId/skillName/decision 字段（`kernel/audit-sink.ts`）；写技能有确认门；HTTP 层有请求信封。
- 定级：P1（任意登录用户可达，影响有限）。
- 修复方向：kernel `CopilotAuditSink` 增一个桥接到 audit 模块存储的实现（宿主侧提供），写动作与确认决策落平台审计库；audit-logs 页事件类型枚举同步扩展。

## 6. P2（按主题归并）

### R36-02（nightwatch-backend）`/security-evaluation` 推荐提示词引用不存在的项目上下文

- `transports/web/chat-recommended-prompts.ts:91-98`：该路由两条推荐提示词均为「…for this project」；而路由规范化明确该页无 project 段（`nightwatch-frontend/src/components/copilot/route-context.ts:19-21`：「its only entry is the header, so the route id has no project segment」）。模型在该页收到「this project」提示无可绑定参数，会追问或平台域作答，文案与上下文契约漂移。
- 注意（防止误读）：该页**并非无 skill**——`aws.skill.ts:100,165` 与 `dependency.skill.ts:42,111` 共 4 个 skill 声明了 `SECURITY_EVALUATION_PAGE_ROUTE`；缺的是 security-evaluation 域本体（评估 run/finding）的 skill。

### R36-03（覆盖缺口·读）11/14 dashboard 页面无 copilot 上下文

- 页面清单（命令：`ls nightwatch-frontend/src/app/(dashboard)`）：audit-logs、backups、event-emitter、iam、jdy、job-scheduler、lark-bindings、llm-models、notifications、projects、security-evaluation、settings、users、work-evaluation 共 14 个。
- 路由上下文仅覆盖 projects\*、security-evaluation、notifications（`route-context.ts:15-34`）；其余 11 个页面（audit-logs、backups、event-emitter、iam、jdy、job-scheduler、lark-bindings、llm-models、settings、users、work-evaluation）全部 fallback 到 General（`route-context.ts:68-69`），无页面标签、无路由推荐提示词（`chat-recommended-prompts.ts:19-109` 仅 5 条路由有映射）。
- skill 清单（命令：`grep -rn 'name: "' skills/*.skill.ts` → 17 个）：project×3、aws×3、backend-monitoring×2、frontend-monitoring×1、dependency×2、task×4、notification×2。**无查询 skill 的平台功能域**：security-evaluation 本体、work-evaluation、evaluation、audit 日志查询、backups 状态、job-scheduler、event-emitter、iam/users、jdy、llm-models、lark-bindings、url-check/heartbeat 状态。

### R36-04（覆盖缺口·写）写能力仅任务域 3 技能

- 命令：`grep -rn 'access: "write"' skills/` → 3 命中，全部在 `task.skill.ts:138,207,256`（均 `confirmation: "always"`）。
- 平台已有但 copilot 不可执行的写面：项目 CRUD（`projects/page.tsx`）、应用创建与监控绑定、通知规则配置、调度任务启停/手动触发（`job-scheduler/page.tsx:64-129`）、LLM 连接与 scope 绑定（`llm-models/page.tsx:39-127`）、安全/工作评估 run 触发、lark 绑定管理。

### R36-05（会话生命周期）会话不持久、无历史、无反馈回路

- 服务端：`InMemoryConversationStore`，30min 滑动 TTL、每用户 20 会话、每会话 50 条（`kernel/conversation-store.ts:15-27`、`kernel/agent-config.ts:22-31`）；注释明示「a persistent implementation can replace the in-memory one later」。进程重启全丢。
- 前端：`conversationId` 仅存 `useState`（`use-copilot-chat.ts:99`），页面刷新即开新会话；`components/copilot/` 无会话列表/历史组件（命令：`ls`，10 个文件均为 dock/block/timeline 类）。
- 反馈回路：`grep -ri "feedback|thumbs"` components/copilot → 仅 query-block 的 Copy 按钮；无赞/踩、无质量度量出口。

### R36-06（架构）平台存在第二条独立 AI 管线，与 kernel 不互通

- `application/analysis/analysis.controller.ts`：`@Post("chat")` 独立 SSE 管线，自带事件协议（status/text-token/block/analysis-token…）、独立 model scope（`analysis-model-scope.ts`）、独立提示词构建（`prompt-builder.ts`）与查询隔离（`query-isolation.ts`）；权限 `@RequirePermission(Create, "AiAnalysisReport", { scope: "project" })`。
- 与 copilot kernel 的关系：两套流式协议、两个 model scope、两套提示词体系；copilot 不能调用数据分析员能力，analysis 管线无工具调用/确认门/审计缝。前端同样两套（`api/analysis/chat-stream.ts` vs `api/copilot/chat-stream.ts`）。
- 属架构决策点（合并 or 保持分离），按流程应先出 ADR 再动手。

### R36-07（提示词体系）prompt-sections 仅监控两域

- 命令：`ls application/copilot/prompt-sections/` → 仅 `backend-monitoring.prompt-section.ts`、`frontend-monitoring.prompt-section.ts` 2 个文件；其余功能域（含已装配的 aws/dependency/notification/task）无领域知识注入，模型对这些域的理解仅靠 skill description。

## 7. 误报剔除

| 候选 | 裁决 | 依据 |
| --- | --- | --- |
| 「`@RequireOwner()` 等于无鉴权，任何人可聊」 | REFUTED | `require-owner.decorator.ts:8-10` 明示 self-by-token 路由 ownership 构造成立；身份只取 `req.user.userId`（`chat.controller.ts:31-33,59`）；逐技能授权在 skill 内（aws/dependency 注入 `PermissionAuthorizer`，`skill.module.ts:73,76`） |
| 「task 写技能无权限检查」 | REFUTED | 项目可见性 `findProjectById(projectId, ctx.userId)`（`task.skill.ts:148-151`）+ 服务层 forbidden outcome（`:183-184,240-241`）+ 全量确认门 |
| 「/security-evaluation 页完全无 skill」 | REFUTED | 4 个 aws/dependency skill 声明该页（见 R36-02 注） |

## 8. 已核验通过的不变量

- 装配一致性：`diff -rq` registry vs 宿主 copilot → 零差异（exit 0）。
- 写技能确认门：3/3 `confirmation: "always"`（命令：`grep -rn 'confirmation: "always"' skills/` 与 access 计数一致）。
- 会话归属：同名 conversationId 跨用户 → `conversation_forbidden`（`conversation-store.ts:130-132`）；确认跨用户 → `confirmation_forbidden`（`chat.controller.ts:167-173`）。
- 幂等重放：完成 run 5min 内同 requestId 重放不二次执行模型（`conversation-store.ts:116-126`、`agent-config.ts:25`）。
- 模型预检 fail-closed：无 active scope → 409 `no_active_model`（`chat.controller.ts:62-73`）。
- 资源上限：MAX_AGENT_STEPS=10、MODEL_TIMEOUT 60s、SKILL_TIMEOUT 30s、确认 5min 自动拒绝（`agent-config.ts:7-19`）。
- SSE 中断清理：写失败路径 `handle.fail()` 释放会话锁（`chat.controller.ts:141-146`，即历史「会话锁泄漏」修复，仍闭合）。

## 9. 覆盖率清单

- 审了：kernel 全部 19 文件、宿主 copilot（skills/datasources/prompt-sections/transports/model-scope）、chat-binding 概览、前端 copilot 组件与 api 层、平台功能基线（14 页面 + application 域控制器抽样）、audit 模块接缝。
- 没审：lark 传输卡片流程的逐行逻辑（仅架构面）、llm 模块内部、analysis 管线内部实现细节、chat-binding 全量、测试运行（本轮为静态评审，未跑 tsc/测试，标记 static）。

## 10. 修复优先级

1. R36-01 审计入流（P1，治理硬缺口）。
2. R36-02 提示词契约漂移（P2，小改）。
3. 战略项按用户拍板顺序推进（见下方决策点）：R36-03 读覆盖扩展、R36-04 写能力扩展、R36-05 会话持久化+历史 UI、R36-06 双管线合并（需 ADR）、R36-07 prompt-sections 补域。

## 11. 台账指针

findings 登记于 `newbie-modules/.trae/documents/findings.md` round36 段。
