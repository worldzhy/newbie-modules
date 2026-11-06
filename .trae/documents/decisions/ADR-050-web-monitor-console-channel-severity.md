# ADR-050: web-monitor 错误来源分级与告警口径

状态：已采纳
日期：2026-11-06
归属注记：本决策治理 registry 模块的告警契约（真源为 `packages/modules/web-monitor/modules/jobs/jobs.service.ts` 与 `common/utils.ts` 的来源枚举），存放于本仓；SDK 实现位于 `devbie/packages/web-monitor-sdk`，nightwatch-backend 侧仅为装配产物，不另立 ADR。与 ADR-013 / ADR-014 / ADR-015（ClickHouse 表与库治理）无冲突：本 ADR 处理告警语义与来源分类线，不触碰表结构。

## 背景

2026-11-06 nightwatch-frontend 收到 `new-monitor` 告警：`iam/scopes/page.tsx` 出现 `ReferenceError`，归为高危"新 JS 错误"。排查结论是该位置并无真实崩溃，告警来自 next-intl 的 `ENVIRONMENT_FALLBACK`——`format.relativeTime(date)` 未传 `now` 时，next-intl 走全局兜底并调用 `onError`（默认 `console.error`）。前端调用点已由 `6ca7473` 修复，但暴露了观测层的结构性问题：**任何依赖库的 `console.error` 都会与真实异常同形进入高危告警**。

取证（2026-11-06 读码，round18 评审复验）：

- `devbie/packages/web-monitor-sdk/src/core.ts` L46-L67：`ErrorInstanceReport` 无条件 `defaults.type = ERRORTYPES.script`；`name` 取自 `error.name`（可为 `TypeError` 等，并非恒为 `Error`）。
- 同上 L523-L548：`console.error` 被覆写——单参数且栈可解析走 `ErrorInstanceReport`（`api = conso.err`、`type = script`），多参数或不可解析走 `type = log`。生产构建同样触发，文案为空但分类不变（next-intl 默认 `onError = console.error`）。
- 同上 L461-L482：资源加载失败以 `type = resource`、`api = onerror` 入库；L483-L498 的 JS 未捕获异常同样使用 `api = onerror`。
- `devbie/packages/web-monitor-sdk/src/common/utils.ts` L86-L90：`ERRORAPIS = { consoleError: "conso.err", onerror: "onerror", unhandleReject: "reject" }`。
- `newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts` L294-L333：`js-error-first-seen` 按 `name + resourceUrl + line + type` 分组，`severity: high`；"历史是否出现过"的基线查询 L311-L316 仅按 `name/resourceUrl/line`，**不带 `api` / `type` 过滤**。
- 同上 L253-L288：`js-error-spike`（`severity: high`，阈值 `JS_ERROR_SPIKE_COUNT = 10`、`JS_ERROR_SPIKE_USER_COUNT = 2`）对错误表做**全窗口 `count()`**，同样无来源过滤。
- `packages/modules/web-monitor/models/clickhouse/web/error.ts` L17：`api` 已存在，类型 `LowCardinality(String)`。

因此问题有两层：(1) console 噪音占用高危首现通道，且可能占据指纹，使后续真实崩溃被判"已见过"而不再告警；(2) 即便把噪声降级，仍有一条无来源过滤的高危尖峰通道——以及 `onerror` 被资源加载失败共用，使"运行时通道"的断言不成立（round18 评审 R18-01 / R18-02）。

## 候选方案

- **A. 逐点修调用方**：只改前端调用点。被否——观测层缺陷仍在，任何依赖库都会复现。
- **B. 新增 `channel` 来源字段**：与既有 `api` 同义，制造第二真源。被否。
- **C. 复用 `api` 作来源真源，并在告警层显式分级（选定）**：成本最低、无 schema 变更、判定可测。
- **D. 用栈帧启发式识别"库代码"**：不可验证、随压缩/内联漂移。被否。
- **E. 覆盖 next-intl `onError` 或 Provider 全局 `now`**：会掩盖真实的 `ENVIRONMENT_FALLBACK` 信号，且不解决观测层问题。被否。

## 决策

1. **`api` 是错误来源的唯一真源**，不新增同义字段，不改 ClickHouse schema。
2. **枚举规范化**（`ERRORAPIS` → `ERROR_APIS`），取值从别名改为可读通道名：
   - `consoleError: "console-error"`
   - `onerror: "onerror"`（仅指 JS 未捕获异常）
   - `unhandledRejection: "unhandled-rejection"`（原 `unhandleReject: "reject"`）
   - **新增 `resourceError: "resource-error"`**：资源加载失败从 `onerror` 拆出，`type` 仍为 `resource`。
3. **console 通道一律 `type = log`**：包括单参数且栈可解析的情形；栈与 `resourceUrl/line/col` 照常保留（诊断信息不丢）。
4. **`js-error-first-seen`（high）只在运行时崩溃发声**：白名单 `api ∈ {onerror, unhandled-rejection}`；**分组查询与基线查询同口径**（基线也加该过滤，避免资源/日志行占指纹）。
5. **`js-error-spike`（high）用黑名单而非白名单**：`api != "console-error"`；**计数查询与 topItems 分组查询同口径**。理由：该信号语义是"错误量异常"，`ajax` / `fetch` / `resource-error` 行（`api` 为空或各自取值）必须继续计入，否则一次 5xx 爆发或 CDN 故障会静默失聪。
6. **console 通道采用 5B（降级入库）**：`type = log` 写表，可查询、可统计、可诊断，但不进入首现告警，也不进入首现基线。不采用 5A（完全剔除）——留表与现有"多参 console 已 `type=log` 入库"的行为一致，且不需要在 SDK 内再造一条丢弃分支。
7. **不做历史数据迁移**：平台未上线。验证前对错误表做一次性清表（运维动作，不是功能），避免旧 `api` 取值污染基线判定。

判定逻辑集中在模块侧两个常量（如 `FIRST_SEEN_SOURCES`、`NON_ERROR_SOURCES`），以上三处查询全部引用同一常量，禁止在各查询内手写字面量。

## 跨宿主检验

| 维度 | 模块侧（真源） | 宿主侧（装配） |
| --- | --- | --- |
| 来源枚举 | SDK 定义 `ERROR_APIS` 四个取值，`api` 单列承载 | 不改枚举、不改表结构 |
| 首现谓词 | 白名单 `{onerror, unhandled-rejection}`，分组 + 基线 | 装配即生效，无宿主配置项 |
| 尖峰谓词 | 黑名单 `{console-error}`，计数 + topItems | 同上 |
| 新增通道 | `resource-error` 为一个新取值，不新增信号 | 无需迁移，旧行按既定清表处理 |
| 可移植性 | 任意消费方按本 ADR 装配即获得同一口径 | 前端口径差异见"影响"一节 |

## 影响与验证

**更容易**

- "是否告警"从隐式的"所有入库错误"变为**显式来源判定**，并且两个 high 信号各有明确语义（逐指纹崩溃 vs 总量异常）。
- 资源加载失败不再冒充 `onerror`，资源行也不会再占据崩溃指纹。

**更难 / 行为变化**

- 资源加载失败**不再产生 high 首现告警**（今天缺失图片即可触发"新 JS 错误"）。若未来需要资源故障告警，应另立信号，不塞回首现。
- console 事件 `type: script → log` 会改变前端错误列表的聚合口径（`error.service.ts` L72-L77 按 `type` 选 `groupBy`：`script` → `resourceUrl,name,type`；`log` → `resourceUrl,type`）。无需改前端代码，但属可观察变化。
- `ERROR_APIS` 是发布包导出符号（`dist/common/utils.d.ts`），改名须校验跨仓外部引用（当前为 0）并按 1.x minor 发布。

**验证（registry-first）**

1. SDK 改造 → 1.x minor 发布；registry 改造 → 契约测试四向 + **阴性对照**（同一测试在未修复代码下必须变红）：console 窗口 → 两信号均不响；resource 窗口 → 首现不响、尖峰响；运行时异常 → 首现响；ajax/fetch 爆发 → 尖峰仍响。
2. `newbie modules update web-monitor` → 清空错误表 → 重启 → 构造三类事件各一组，核对入库 `type`/`api`、基线占用、两信号开关。
3. 复查历史噪音（如 next-intl `ENVIRONMENT_FALLBACK`）不再生成任何 high 告警。

## 不做清单

- 不新增 `channel` 或同义来源字段；不改 ClickHouse 表结构。
- 不用栈帧启发式判定"是否库代码"。
- 不改 next-intl `Provider` 全局 `now`，不覆盖 `onError`（会掩盖确定性信号）。
- 不回改历史提交信息。
- 不实现"删除历史事件"的功能（验证前清表是一次性运维动作）。

## Checklist

- [x] SDK：`ERROR_APIS` 改名与取值规范化；console 一律 `type=log`；资源加载失败改用 `resource-error`
- [x] SDK：核对导出面引用并按 1.x minor 发布
- [x] registry：`FIRST_SEEN_SOURCES` / `NON_ERROR_SOURCES` 常量 + 首现（分组/基线）与尖峰（计数/topItems）四处查询改造
- [x] registry：契约测试四向 + 未修复代码下的阴性对照
- [x] 装配验证：update → 清表 → 重启 → 三类事件核对（type/api、基线、告警开关）
- [x] 文档：round18 评审 R18-05 / R18-06 的措辞与路径订正并入本文

## 更新记录

- 2026-11-06 落地验收：SDK `devbie 6837c2ee`（`@devbie/web-monitor-sdk@1.6.0` 已发布）；registry `1218851`（含 `error-source.ts` 与 `error-source.test.ts`）；宿主装配 `nightwatch-backend 6422537`（无 schema 变更）。E2E 四向：console 13 行 / resource 1 行零告警，runtime 1 行触发首现，ajax 12 行触发尖峰（计 12 条，console 未计入）。
- 2026-11-06 定稿（状态：提议中 → 已采纳）：决策 5 定为 5B；决策 4 覆盖 `js-error-spike`（与首现分开：白名单 / 黑名单）；决策 2 增加 `resource-error`。依据 `expert-review-2026-11-06-round18.md`（R18-01 / R18-02）。
