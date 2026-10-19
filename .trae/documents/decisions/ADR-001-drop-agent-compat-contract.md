# ADR-001: 移除 application.Agent 兼容契约，Web Monitor 凭证以 installation 语义直接对外

状态：已采纳（2026-10-12 用户批准，同日实施）
日期：2026-10-12
副本注记：本决策原件存于 nightwatch-backend `.trae/documents/decisions/`（nightwatch-backend 侧编号 ADR-001、newbie-modules 侧编号 ADR-001，同文）。

## 背景

要决定什么：`application.Agent` 实体已于 2026-10-05 随 B1（web-monitor 脱离 Agent 改用 `WebMonitorInstallation`）整表删除（migration `20261005120000_web_installation_drop_agent`，`DROP TABLE` + `DROP TYPE AgentType/AgentStatus`，定论）。但对外 HTTP 契约在 B1 决策 D7 中被刻意保留为"兼容外壳"：

- `GET /applications/:applicationId/agents`
- `POST /applications/:applicationId/agents/:type/credential/regenerate`
- `DELETE /applications/:applicationId/agents/:type/credential`
- `ApplicationDto.agents: AgentSummaryDto[]`
- `ApplicationOnboardingDto.agentType`（常量 `WEB_MONITOR`）
- 手写的 TS 枚举 `AgentType`/`AgentStatus`（`application.dto.ts` 注释原话："Formerly generated from Prisma ... Inlined here so ..."），由 `WebMonitorInstallation` 行在读取时派生

D7 保留 URL 的唯一理由是"前端业务代码（非 `_gen`）不消费这些端点，改端点不破坏前端"（见 `web-monitor-installation-b1-plan.md` D7 与"取证发现的额外事实"）。

**该前提现已被证伪（定论，有代码证据）**：

- `nightwatch-frontend` 的 `CredentialPanel`（`settings/application-manager.tsx`）实际调用 list/regenerate/revoke 三个端点并展示状态；
- `use-application-app-key.ts` 读 `application.agents.find(a => a.type === "WEB_MONITOR")?.appKey`；
- Applications 表格存在 "Agent Credential" 列，对 BACKEND 应用恒显示无意义的 `Not enabled / —`（BACKEND 从不持有 web installation）。

后果：一个已删除的领域概念继续支配对外契约、DTO 命名、Swagger 模型与 UI 文案；`:type` 路径参数是假分叉（枚举只有一个值，`revokeCredential` 里参数名为 `_type` 且完全未使用）；前端要靠 `APPLICATION_AGENT_TYPE` 映射猜测"这个应用有没有 agent"。

为什么必须在写代码前决定：这是对**既有对外契约的重命名与收缩**（HTTP 路径、响应字段名、枚举名同时变化），按工程治理规则需要 ADR；且存在"只改文案 / 新旧并存 / 硬切换"等真实分叉，影响面跨后端与前端两个仓。

## 候选方案

### 方案 A：全链路正名 + 硬切换（本 ADR 提议）

删除全部 agent 兼容契约，改为 web-monitor 单例凭证语义；无 DB 变更；不保留旧端点别名。

新契约：

| 操作 | 旧 | 新 |
|---|---|---|
| 读状态 | `GET .../agents` → `AgentSummaryDto[]` | 删除独立列表端点；`ApplicationDto.webMonitor: WebMonitorSummaryDto \| null` 直接承载（null = BACKEND 应用或遗留未 enroll 的 FRONTEND 应用） |
| 签发/轮转 | `POST .../agents/:type/credential/regenerate` | `POST .../web-monitor/credential/rotate` → `WebMonitorCredentialDto` |
| 吊销 | `DELETE .../agents/:type/credential` | `DELETE .../web-monitor/credential` → `WebMonitorSummaryDto` |

新 DTO（去掉恒为 `WEB_MONITOR` 的 `type` 字段）：

```
WebMonitorCredentialStatus { PENDING, ACTIVE, DISABLED }   // 仍由 installation 状态派生：revokedAt→DISABLED，lastSeenAt→ACTIVE，否则 PENDING
WebMonitorSummaryDto    { status, lastSeenAt, appKey, hasToken }
WebMonitorCredentialDto { appKey, token, endpoint }        // 明文仅本次返回
```

- `ApplicationDto.agents` → `ApplicationDto.webMonitor: WebMonitorSummaryDto | null`
- `ApplicationOnboardingDto.agentType` 删除（常量、前端无消费，定论）
- 内部符号同步：`toAgentSummary` → `toWebMonitorSummary`；`listAgents/regenerateCredential/revokeCredential` → `getWebMonitorSummary/rotateWebMonitorCredential/revokeWebMonitorCredential`；`siteService.upsertSiteForWebAgent` → `upsertSiteForWebMonitor`；报错文案 `Agent not found for this type` → `Web monitor is not enabled for this application`
- 前端：swagger/apits 重新生成；`application-manager.tsx`（列名改 "Web Monitor"、删除 `APPLICATION_AGENT_TYPE`/`AGENT_TYPE_LABEL`/`AGENT_STATUS_META`、面板直读 `app.webMonitor`、BACKEND 行显示 `—`）、`use-application-app-key.ts` 改读 `webMonitor?.appKey`
- 不变项：上报入口 `POST /api/v1/report/web`、SDK 凭证载体（body `query.token`）、`WebMonitorInstallation` 表结构与鉴权解析链路

### 方案 B：只改前端文案

列名与面板标题改为 Web Monitor，后端 URL/DTO 全部保留。成本最小，但过时契约继续裸露在 Swagger 与生成代码中，与"不留过时契约在工作树"的治理取向直接冲突；假分叉的 `:type` 参数也继续存在。

### 方案 C：新旧端点并存，旧端点标 Deprecated

加新端点、旧端点保留一个 deprecation 窗口再删。适用于有外部消费方的上线后服务；本项目未上线、无外部消费方（定论），并存只制造双倍表面与切换协调成本，没有消费者受益。

### 方案 D：什么都不做

维持现状。兼容层持续以已死概念命名全部对外表面，BACKEND 空列噪声与术语误导保留。

## 决策

采纳**方案 A**。

决定性理由：D7 保留兼容层的**唯一**论据是"前端无消费"，而该论据已被现存代码证伪——兼容层的存在前提不成立了，这不是偏好变化，是事实变化后对旧决策的正式推翻。在此前提下，方案 A 是唯一让"对外契约 = 真实领域模型（per-module installation 单例凭证）"的选项；方案 B 保留假契约，方案 C 为不存在的消费者支付双表面成本。项目未上线、无外部消费方，pre-launch 阶段 breaking change 走硬切换与既定约定一致，semver major 护栏此时不适用。

次要点但同向：新形状（application 下挂模块名单例凭证子资源）与 module-hub/backend-monitor/heartbeat/health 的 installation 模型同构，未来若开放其他模块的凭证轮转，路径模式可直接复用 `.../<module>/credential`。

## 跨宿主 / 演进检验

- 这组管理 API 是 nightwatch **宿主层产品表面**，不是拟沉淀进 newbie-modules 的通用能力；不涉及 registry 改动与装配。
- 框架侧（newbie / fewbie / `@devbie/web-monitor-sdk`）只与上报入口 `/api/v1/report/web` 及凭证载体打交道，两者均不变，本次改动对框架仓零影响、无需跨仓发布窗口。
- 换一个宿主消费 newbie 框架时根本看不到这组 API，宿主特定概念（nightwatch 的 Application/Project）不向框架泄漏。
- 命名不绑定任何具体厂商；`web-monitor` 是模块名而非宿主名，跨宿主成立。

## 影响

**变得更容易**：

- UI 直接按 `application.webMonitor` 是否为 null 渲染，删掉 application type → agent type 的猜测映射；BACKEND 行的空状态噪声消失。
- Swagger 模型与真实表一一对应，后续模块凭证管理有可复制的路径模式。
- 删除三个端点中的一个（GET list）和一个假路径参数，契约表面积净缩小。

**变得更难 / 代价**：

- 一次性 breaking change：后端 controller/service/dto + provisioning service 中 `agentType`/`agents` 组装点（`project-application.service.ts` L150-181/L479/L625-687、`project-application-provisioning.service.ts` L393/L438-443）同步修改；前端需 apits regen 后改两个业务文件。
- 无 DB migration、无数据回填（installation 表 B1 已就位）；无框架仓协同。

**实施边界（验收项）**：

1. 后端 `tsc --noEmit` + `nest build` 通过；全仓 grep 不再有作为对外契约的 `Agent` 符号（`userAgent`、`module/llm-agent` 等同名词不在范围内）。
2. 前端容器内 `tsc --noEmit` 通过；Applications 页 FRONTEND 行显示 Web Monitor 凭证状态、BACKEND 行显示 `—`；轮转/吊销弹窗与一次性明文展示功能不变。
3. Living 设计文档同一 PR 回写：`module-hub-design.md`（L435 "DTO 兼容层"表述更新为已删除）、`application-creation-flow-design.md`（§5.1/凭证签发描述）、`provisioning-orchestration-plan.md`（FRONTEND Agent 明文 token 等表述）；`application-agent-model-design.md` 顶部加 superseded 横幅指向本 ADR（历史正文不重写，遵循时点快照规则）。
4. 双仓各自一次本地提交并推送 dev；无 npm 发布物。
