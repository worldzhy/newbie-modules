# ADR-050: web-monitor 错误来源分级——`api` 作为来源真源，首现告警仅限运行时通道

状态：提议中（待用户拍板：决策 5 的 console 通道策略）
日期：2026-11-06
归属注记：本决策治理 registry 模块 `web-monitor` 的上报与告警语义契约；SDK 侧实现位于 devbie 仓 `packages/web-monitor-sdk`，属该契约的浏览器端实现方；nightwatch-backend 侧仅为装配产物与宿主配置的同步执行，不另立 ADR。与 ADR-013 / ADR-014 / ADR-015 / ADR-041（web-monitor ClickHouse 数据面治理线）无冲突，本 ADR 处理的是告警语义与来源分类线。

## 背景

2026-11-06 收到一条 high 级"新 JS 错误"告警：

- 事件：`ReferenceError` 之外的另一类——next-intl 的 `ENVIRONMENT_FALLBACK`，文案提示调用方在 `format.relativeTime` 时未传 `now`；
- 栈：`webpack-internal:///(app-pages-browser)/src/app/(dashboard)/iam/scopes/page.tsx` 所在的 dashboard 渲染路径；
- 实际来源：库用 `console.error(new Error(...))` 发出的一条**开发期配置提示**，不是页面崩溃。

链路取证（截至 2026-11-06 的代码）：

1. SDK 在 `ErrorInstanceReport` 中把**所有**带可解析栈的单参数 `console.error` 记为 `type = script`、`name = Error`，`api = conso.err`（`devbie/packages/web-monitor-sdk/src/core.ts` L46-L67，`console.error` 覆写位于同文件 L523 起）。类型定义见 `src/common/utils.ts` L76-L90：`ERRORTYPES` 含 `log/script/ajax/fetch/...`，`ERRORAPIS` 含 `conso.err/onerror/reject`。
2. 该事件入库后，ClickHouse 错误模型以 `name + resourceUrl + line + type` 分组，**不按 `api` 过滤**，并以 `api` 之外的四个字段判定"是否历史已出现"（`newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts` L294-L333）。
3. 结果：任意依赖库通过 `console.error` 发出的提示都会与真实未捕获异常**同形**进入"首现即 high"的通告通道。`api` 列本身已经存在（`models/clickhouse/web/error.ts` L17，`LowCardinality(String)`），信息并未丢失，丢失的是**告警语义上的分级**。

结论：调用点漏参只是触发源（已在前端 3 个调用点修复）；真正的缺陷是"来源已记录、但告警不区分来源"。

## 候选方案

- **A. 逐个修掉产生噪音的调用点**：被否——类问题仍在，下一个依赖库的任意 `console.error` 都会复现；无法验证"不会误报"。
- **B. 新增 `channel` 字段承载分级**：被否——与已有 `api` 语义重复，同一事实出现两个真源，后续必然漂移；违反命名单源原则。
- **C. 复用 `api` 作为来源真源，SDK 规范化 console 事件，告警按来源分级（选定）**：不新增列、不改 schema，语义落在一个已存在的字段上。
- **D. 按栈帧是否来自 `node_modules` 降级**：被否——判据依赖栈解析可靠性，同库警告若从业务帧触发仍会告警；规则分散且不可被契约测试稳定断言。

## 决策

1. **来源真源为 `api`**。不新增 `channel`/`source` 之类的同义字段；任何"事件从哪来"的判定一律读 `api`。
2. **枚举在契约化前规范化**（`ERRORAPIS` → `ERROR_APIS`；取值 `conso.err` → `console-error`、`unhandleReject` → `unhandled-rejection`，`onerror` 保持不变）。理由：`api` 一旦成为告警分级的真源，其取值即成为跨仓契约，必须先消除自造缩写与拼写不一致；平台未上线，历史事件可丢弃，无迁移负担。
3. **SDK 的 console 分支一律记 `type = log`**，不再复用 `ErrorInstanceReport` 的 `script` 分类——即使 `console.error` 的参数是 `Error` 对象。`api` 字段同时标为 `console-error`，栈信息可保留但不再使事件具备"崩溃"语义。
4. **`js-error-first-seen`（high）只对运行时通道发声**：`api ∈ {onerror, unhandled-rejection}`。"历史已出现"的基线查询也必须限定在同一集合内，否则一条库警告会占据指纹，使随后发生的真实崩溃被判为"已见过"而永不再告警。
5. **console 通道策略（待拍板）**：
   - 5A 完全剔除：console 类事件不入错误表；
   - 5B 降级入库（建议）：console 类事件以 `type = log` 入库，可查询、可统计，但不进入首现告警与告警基线。
   建议 5B 的理由：保留诊断价值，同时把"是否告警"从启发式判断变为显式来源判定，可被契约测试断言。
6. **不改 ClickHouse schema**：`api` 列已存在且类型足够；不新增列、不写迁移。按系统未上线口径，历史噪音数据不保留、不兼容处理。

## 跨宿主 / 演进检验

| 维度 | 框架层（registry 模块 + SDK 契约） | 宿主层（nightwatch-backend） |
| --- | --- | --- |
| 来源枚举 | `api` 取值集合由契约定义，SDK 与告警共用 | 不新增枚举；装配产物随 registry 再生 |
| 分级规则 | 运行时通道 vs console 通道的划分写在模块侧，可被任意宿主复用 | 宿主不覆盖、不扩展分级规则 |
| 表结构 | 复用既有 `api` 列（LowCardinality String） | 动态表随 `createModel` 再生，无需手工 DDL |
| 告警阈值 | 首现信号的高级别仅绑定运行时通道 | 宿主侧通知渠道配置不变 |
| 可移植性 | 任意宿主装配 web-monitor 即获得同一分级语义 | 宿主的业务告警渠道、接收人不属于框架契约 |

演进边界：

- 若未来确需"多级来源"（例如资源加载失败、业务显式上报），应扩展 `api` 的取值集合与告警映射，而不是叠加新字段。
- 若未来需要"console 通道按库名白名单降噪"，属策略变更，单独 ADR，不在本决策内预埋。
- 本决策不涉及 next-intl 的 Provider 全局 `now` 取舍（那是前端渲染确定性问题，另行评估）。

## 影响与验证

- SDK：分类规则调整 + 枚举规范化。按未上线口径走同一条 1.x minor（不进 2）。
- registry：`jobs.service.ts` 首现信号与基线查询增加来源过滤；契约测试须覆盖"console 事件不产生 high 告警"与"运行时事件仍产生 high 告警"两个方向。
- 装配与验证：registry-first → `newbie modules update web-monitor` → 重启 → 构造两类事件各一条，核对入库类型、基线占用与告警触发；随后复查历史噪音是否不再生成新告警。
- 前端：3 个 `format.relativeTime` 调用点已修并完成运行时复验，本决策不再涉及前端改动。

## 不做清单

- 不改写已推送的提交信息；
- 不覆盖 next-intl `onError` 做静音；
- 不为依赖库建立 `console.error` 文案白名单；
- 不删除已入库的历史事件（可由库重建，但不在本次动作内）；
- 不做数据迁移或兼容层（系统未上线）。
