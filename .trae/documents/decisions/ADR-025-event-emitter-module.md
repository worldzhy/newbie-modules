# ADR-025: event-emitter 能力模块（wiring 归属、声明制事件目录、发射历史落库）

状态：已采纳
日期：2026-10-26

> 归属：registry 模块契约决策 → 本仓。nightwatch-backend 删除宿主侧 `EventEmitterModule.forRoot` 属宿主实施，不另立 ADR。

## 背景

nightwatch 的事件总线已实际运行：宿主 `application.module.ts` 注册 `EventEmitterModule.forRoot({ wildcard: true })`，7 个模块发射事件（job-scheduler、url-check、web-monitor、task-management、aws-audit、dependency-scan、threat-intelligence），6 个宿主应用层服务经 `@OnEvent` 监听转通知/风险快照。但存在三个缺口：

1. wiring 长在宿主层——其他宿主复用事件能力时需自行注册 forRoot，且全应用若出现第二个 forRoot 会产生两个 `EventEmitter2` 实例，listener 挂在哪个取决于 DI 解析，事件静默丢失。
2. 事件名是散落各模块的字符串常量，无目录——无法回答"系统里有哪些事件、谁发的、payload 长什么样"。
3. 发射无记录——无法回答"过去发生了什么事件、当时谁监听了"。

job-scheduler 已给出同型基础设施的成熟模板（`@Global()` 模块独占 `ScheduleModule.forRoot()` + 声明注册 + 运行记录落库 + 权限守卫 controller + 前端管理页）。写代码前需决定三件事：forRoot wiring 归属、事件目录来源、发射历史持久化策略。

## 候选方案

1. **wiring 归属**：A 模块独占 forRoot（照搬 job-scheduler 独占 `ScheduleModule.forRoot` 模式，宿主删除现有注册）；B 宿主保留 forRoot，模块只做目录+日志。
2. **事件目录**：A 声明制 + 兜底捕获（发射方启动时 `declareEvent`；onAny 捕获到未声明事件照常落库并以 declared=false 呈现）；B 纯声明制（未声明的发射不可见）；C 纯运行时捕获（无"应该有哪些事件"基线）。
3. **发射历史**：A 落库 `EventEmission` 表；B 内存 ring buffer（重启丢失）；C 不记录。

## 决策

三项均选 **A**（2026-10-26 用户拍板）。决定性理由：

1. job-scheduler 已确立"能力模块独占 forRoot + `@Global()` re-export"的先例，并在模块注释中把双 forRoot 列为硬约束；事件总线与调度器是同型基础设施，没有理由采用第二种模式。宿主侧现存 forRoot 只是历史生长起点不同，搬家即对齐，目标形态与 job-scheduler 完全一致。
2. 声明制提供"应该有哪些事件"的基线，顺带把散落的事件名常量收敛为目录（命名纪律收益）；纯运行时捕获无法区分"声明了但没发"与"发了但没声明"；onAny 兜底补漏的成本极低，不值得省。
3. 管理页的核心价值是"过去发生了什么"，不落库则价值减半；当前全部事件均为低频（扫描完成、告警、任务状态变更），落库量级无压力；系统未上线，不预先设计保留策略。

### D1. 模块形态

- `event-emitter`，capability 层，`@Global()`，独占 `EventEmitterModule.forRoot({ wildcard: true })` 并 re-export；宿主及任何消费方禁止再次 forRoot（模块注释固化为硬约束，同 job-scheduler 先例）。
- `EventCatalogService`：`declareEvent({ key, name?, description?, payloadExample? })` 内存注册表——目录无需运行时编辑，不落库；重复 key 声明抛错（与 `JobHandlerRegistryService` 一致）。
- 发射记录：`onAny` 监听所有发射 → 写 `EventEmission` 表（`eventKey`、`payload` JSON、`listenerCount`、`emittedAt`）。监听器失败不影响记录语义——onAny 回调内只写库，不调用业务监听器。
- Controller（权限守卫同 job-scheduler 的 `RequirePermission` 模式）：`GET /event-emitter/events`（目录 + 每事件当前 listener 数 + 最近发射时间，未声明事件 declared=false）、`GET /event-emitter/emissions`（分页历史，可按 eventKey 过滤）。
- Prisma：`EventEmission` 单表；目录在内存，无表。

### D2. 消费方契约

- 发射方模块：`moduleDependencies` 增加 `event-emitter`，构造函数注入 `EventEmitter2` 不变（类型与 DI token 仍来自 `@nestjs/event-emitter`，npm 依赖继续由使用方在自己的 `newbie.module.json` 显式声明，与本模块声明不冲突）；启动时 `declareEvent`。
- 监听方：继续用 `@OnEvent`，无需感知本模块——单 forRoot 下 `EventSubscribersLoader` 扫描全应用上下文，listener 位置不受 wiring 搬家影响。
- nightwatch 宿主：删除 `application.module.ts` 的 `EventEmitterModule.forRoot`；7 个发射点模块在同一个 PR 补齐 `declareEvent`（技术债规则：不留"以后补"）。

### D3. 前端管理入口

nightwatch-frontend 新增 `/event-emitter` 页（事件目录表 + 发射历史表），顶级导航图标位于 job-scheduler（CalendarClock）右侧。

## 跨宿主 / 演进检验

换一个宿主消费这个模块，决策仍然成立：

| 维度 | 框架层（本模块） | 宿主层（实施） |
|---|---|---|
| forRoot 配置 | 固定 `wildcard: true`——事件 key 的点分命名空间（`module.event`）是框架约定 | 宿主不再注册任何 forRoot |
| 事件 key 命名 | 约定 `kebab模块名.kebab事件名` 写入 README，不硬编码进代码 | 宿主模块按约定命名（现有 7 个发射点已符合） |
| payload | `unknown`/JSON，模块不做 schema 校验——校验是发射方与监听方之间的契约 | 各模块自定 payload 类型与事件常量 |
| 权限资源 | `Prisma.ModelName.EventEmission` 由宿主权限体系按既有模式接入 | 宿主种子权限 |
| 可移植性 | 任意宿主装配本模块即获得总线 + 目录 + 历史 | 宿主删除自有 forRoot 是一次性对齐动作 |

不泄漏任何厂商/宿主概念（无 notification-center、无宿主表依赖）。

## 影响

- 更容易：事件可观测性（目录 + 历史 + listener 数）、事件总线跨宿主复用、事件命名收敛。
- 更难/后续工作：发射方模块多一条 `moduleDependencies` 与启动声明；nightwatch 同 PR 完成宿主删 forRoot + 7 个模块补声明。
- 明确不覆盖：跨进程/跨实例事件（本决策只管单进程 in-memory 总线；未来多实例需求出现时另立 ADR）；emission 保留策略（量级增长后再议）。
