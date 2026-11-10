# Expert review round18 — ADR-050（web-monitor 错误来源分级）

scope：`plan`（`newbie-modules/.trae/documents/decisions/ADR-050-web-monitor-console-channel-severity.md`）
评审时间：2026-11-06 19:00–19:04 CST

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 备注 |
| --- | --- | --- | --- | --- |
| newbie-modules（评审主仓、ADR 所在） | dev | `971721e` | 0 dirty | 与本报告写入前一致 |
| devbie（SDK 依赖仓） | dev | `4df0a04c` | 3 untracked：`.trae-html-share-packages/`、`nightwatch-assessment-2026-11/`、`packages/newbie-cli/package-lock.json` | 均不在 `packages/web-monitor-sdk` 内，SDK 区结论**非** provisional |

执行环境：ClickHouse `localhost:8123`（容器 `nightwatch-backend-clickhouse`）。查询 `system.tables` 无 `nightwatch` 库、无 `%web%` 表，故本报告的"历史数据"类结论只能条件成立，见 R18-04。

**偏差披露（§10.7 教训 7）**：本会话主评审者即 ADR-050 作者，存在自审偏差；补偿措施：(a) 全部关键结论升级为 executed 证据（合成数据集探针 + 命令输出）；(b) 独立反驳代理只拿到主张与 file:line，未拿到论证过程；(c) 主会话对代理输出中与实际代码不符之处按读码裁决（§7）。

## 2. 范围与方法

审查范围 = ADR-050 主张集合 ∪ 其依赖路径；不扩审无关模块。

主张清单与依赖映射：

| # | ADR 主张 | 依赖取证路径 |
| --- | --- | --- |
| A1 | 带可解析栈的单参数 `console.error` 记为 `type=script`、`api=conso.err` | `devbie/packages/web-monitor-sdk/src/core.ts` L46-L67、L523-L535 |
| A2 | `console.error` 覆写位于 core.ts L523 起 | 同上 L523-L548 |
| A3 | `ERRORTYPES` / `ERRORAPIS` 定义于 utils L76-L90 | `devbie/packages/web-monitor-sdk/src/common/utils.ts` L76-L90 |
| A4 | 告警按 `name+resourceUrl+line+type` 分组、不按 `api` 过滤 | `newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts` L294-L333 |
| A5 | "历史已出现"基线查询不带 `api` 过滤 | 同上 L310-L316 |
| A6 | `api` 列已存在且为 `LowCardinality(String)` | `newbie-modules/packages/modules/web-monitor/models/clickhouse/web/error.ts` L17 |
| A7 | 任意库 `console.error` 与真实异常"同形"进入首现即 high 的通道 | jobs.service.ts L294-L333 + core.ts L46-L67 |
| A8 | 决策 4：运行时通道 = `api ∈ {onerror, unhandled-rejection}` | core.ts L461-L521 |
| A9 | 决策 5B：console 事件不入首现告警与基线 | jobs.service.ts L294-L333 |
| A10 | 与 ADR-013/014/015/041 无冲突 | `.trae/documents/decisions/` 存在性 |
| A11 | 平台未上线、历史事件可丢弃、无迁移 | 无代码证据，属口径声明 |
| A12 | 前端 3 处调用点已修，本决策不再涉前端 | 范围外（nightwatch-frontend），本报告不判定 |
| A13 | SDK 走同一条 1.x minor | `devbie/packages/web-monitor-sdk/package.json` |

方法：机械取证（grep/read/命令）+ 1 路独立反驳代理（Explore，只读，仅接收主张与 file:line）+ 2 个 ClickHouse 合成数据集探针（复现告警查询口径，不写表、不落数据）。无并行路失败。

## 3. 结论摘要与维度评分

ADR 的核心方向（复用既有 `api` 作来源真源、不新增列、不改 schema）成立且取证准确；但**两条 high 级信号的来源边界没有闭合、且 `onerror` 语义被误述**，按现状实施会留下两类 high 误报，并使 ADR 自己写的验收标准（"console 事件不产生 high 告警"）无法通过。

| 维度 | 评分 | 依据 |
| --- | --- | --- |
| 安全 | 通过 | 不新增攻击面、不新增字段、不改 DDL |
| 架构 | 良 | `api` 单源复用正确，避免同义字段漂移 |
| 契约 | 不足 | R18-01、R18-02 两条 P1；Gap 在于信号集未全量纳入分级 |
| 测试 | 未落地 | ADR 所需契约测试尚不存在，且现有信号集下"console 不产生 high"测试会红 |
| 门禁 | N/A | 不涉 CI/模板门禁 |
| 治理 | 良 | 归属（registry 治理、SDK 实现、宿主装配）与编号（ADR-050 未复用，现存最大 ADR-049）正确 |

## 4. 主张判定表

| # | 判定 | 依据 |
| --- | --- | --- |
| A1 | 成立（措辞需订正） | 单参数且栈可解析才走 `ErrorInstanceReport`（core.ts L525-L532）；`defaults.type = ERRORTYPES.script` 无条件（L49）；`api` 为 `consoleError`（L528）。**订正**：`name` 来自 `error.name`（L50），并非恒为 `Error` |
| A2 | 成立 | L523 `const oldError = console.error` |
| A3 | 成立 | utils.ts L76-L90 |
| A4 | 成立（主体写错） | 分组发生在告警任务 `jobs.service.ts` L297-L304，不是"ClickHouse 错误模型"；模型只声明列（error.ts L8-L38） |
| A5 | 成立 | L311-L316 仅 `name/resourceUrl/line`，无 `api`/`type` |
| A6 | 成立 | error.ts L17 |
| A7 | 成立但不完整 | 首现通道成立；同时 `js-error-spike`（high，阈值 10）对全表计数、无来源过滤（jobs.service.ts L253-L288、L77）→ 见 R18-01 |
| A8 | **不成立** | `api=onerror` 同时用于资源加载失败（core.ts L473，`type=resource`）与 JS 未捕获异常（L491/L497）；按该集合过滤无法"只保留运行时异常"→ 见 R18-02 |
| A9 | 成立（字面）／不成立（隐含） | 字面只承诺不入"首现告警与基线"，成立；但 5B 建议理由中的"是否告警已由来源显式判定"不成立——spike 仍按总量告警 |
| A10 | 成立 | `ADR-013/014/015/041` 四个文件均存在（见 §8 命令） |
| A11 | 证据不足（口径自洽） | "历史可丢弃"与"不删除已入库历史事件"并存；缺"验证前是否截断"的明确前置，见 R18-04 |
| A12 | 范围外不判定 | 属 nightwatch-frontend，前轮 round16 已核 |
| A13 | 成立 | `"version": "1.5.3"`；但导出面未声明，见 R18-03 |

## 5. 新发现

### R18-01 · P1 · 契约破坏：`js-error-spike` 不看来源，5B 下降级事件仍触发 high 告警

- 仓/文件：`newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts` L253-L288；阈值 L77（`JS_ERROR_SPIKE_COUNT = 10`）。
- 证据（executed）：对 10 条 `type=log / api=console-error` 的合成行执行与代码同型的窗口计数，得到 `total=10, markedUsers=3`，满足 `count >= 10` 且 `markedUsers >= 2`（L266-L267）→ 必然发出 `signal=js-error-spike, severity=high`（L276-L286）。查询本身无 `type`/`api` 谓词。
- 可达性：anonymous 访客即可产生（任何依赖库 `console.error` 累计 10 条/窗口）；暴露面：artifact + live（本地已装配）。
- 影响：ADR §影响 要求契约测试覆盖"console 事件不产生 high 告警"，在该信号集下**不可达**；5B 建议理由（"把是否告警变为显式来源判定"）对 6 个信号中的 1 个失效。
- 反驳轮：独立代理复核 L253-L288 / L77 / `threshold-alert.event.ts` L14-L17，未发现任何配置开关或上游条件能绕过该全表计数；主张维持。
- 修复方向（供实现会话）：决策 4 的来源集合须同时约束 `js-error-spike` 的计数查询与 topItems 分组查询（或对 5B 事件在入库前分流），并在 ADR 中显式写出该信号。

### R18-02 · P1 · 契约错误：`api=onerror` 混用，决策 4 的"运行时通道"不成立

- 仓/文件：`devbie/packages/web-monitor-sdk/src/core.ts` L461-L482（资源加载失败：`type=resource`、`api=onerror`）与 L483-L498（JS 异常：`api=onerror`）。
- 证据（executed）：合成 6 条 `resource/onerror` + 4 条 `script/onerror`，按决策 4 的 `api IN ('onerror','unhandled-rejection')` 过滤，结果 `resource onerror 6` / `script onerror 4` —— 资源噪音全部通过过滤。
- 可达性：anonymous（缺失图片/字体/CSS 即触发）；暴露面：artifact。
- 影响：按字面实施后，资源加载失败仍会进入 high 首现告警与基线（并占据指纹），与 ADR "只对运行时通道发声"的断言矛盾；若改为只过滤 `type='script'`，又需同步改写决策 4 的来源定义。
- 修复方向：二选一并在 ADR 定稿——(a) 为资源加载失败引入独立 `api` 取值（如 `resource-error`），保留 `onerror` 专指 JS 异常；(b) 保留现有取值，但过滤条件改为 `(api='onerror' AND type='script') OR api='unhandled-rejection'`，基线查询同口径。

### R18-03 · P2 · `ERRORAPIS` 是对外发布符号，ADR 未声明导出面校验

- 证据：`devbie/packages/web-monitor-sdk/dist/common/utils.d.ts` L15-L18 `export declare const ERRORAPIS`；源码 `src/common/utils.ts` L86 亦为 `export`。
- 现状：跨仓 grep 外部消费为 0（仅 SDK 内部引用），故非现网破坏；缺口是 ADR 未写明"改名须校验发布入口与消费方"这一步。按未上线口径可接受，但应在决策 2 补一句校验命令。

### R18-04 · P2 · 枚举改值 + 不迁移：验证前置未写明

- 机制：改名后 `api='reject'` 的历史行不再落入新基线集合（`api ∈ {onerror, unhandled-rejection}`），已见运行时错误会被判"首现"并重新告警一次。
- 现状：本机 ClickHouse 实例无 web 错误表（`SELECT database, name FROM system.tables WHERE name LIKE '%web%'` 返回空），故**当前无实际影响**；缺口仅在 ADR 验证步骤：应写明验证前截断/重建错误表，否则"构造两条事件核对基线占用"结果会被历史行污染。
- 另：决策 6 "历史噪音数据不保留" 与不做清单 "不删除已入库的历史事件" 需一句话说清（截断=运维动作，非删除逻辑）。

### R18-05 · P2 · 背景取证措辞与路径

- `name = Error` 实为 `error.name`（core.ts L50），`TypeError` 等不适用该措辞。
- "ClickHouse 错误模型以 … 分组" 实为告警任务分组（jobs.service.ts L297-L304）。
- `models/clickhouse/web/error.ts` 缺 `packages/modules/web-monitor/` 前缀（L19），不可从仓根直接定位；按 round15 教训 1 应写全路径。

### R18-06 · P2 · 决策 3 的可观察影响未记录

- `type` 从 `script` 改为 `log` 会改变前端错误列表的聚合口径：`newbie-modules/packages/modules/web-monitor/modules/web/services/error.service.ts` L72-L77 按 `type` 选择 `groupBy`（`script` → `resourceUrl,name,type`；`log` → `resourceUrl,type`）。无需改前端代码，但 ADR §影响 称"前端不涉及改动"时遗漏了这一行为变化。

## 6. P0/P1 汇总

| ID | 严重度 | 仓 | 暴露面 | 可达性 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R18-01 | P1 | newbie-modules | artifact + live | anonymous | open |
| R18-02 | P1 | devbie（SDK） | artifact | anonymous | open |

## 7. 误报剔除

- 反驳代理将 `console.error` 分支概括为"`type = log`"（其摘要第 6 条），与 L528 `ErrorInstanceReport(stack, consoleError)` → L49 `type=script` 不符；按读码裁决，以主会话 L46-L67 / L523-L535 为准。该误述不影响两条 P1 的成立。
- "基线占住指纹导致真崩溃永不告警"：仅在 console 行与真崩溃的 `name/resourceUrl/line` 重合时发生；不作为独立 finding，已并入 A7 的结论表述，避免夸大。

## 8. 已核验通过的不变量（正面结论）

- 单参数 + 可解析栈 → `ErrorInstanceReport`（`type=script`）；多参数或不可解析 → `type=log`（core.ts L523-L547）。
- `api` 列已存在（`LowCardinality(String)`），决策 6 的"不改 schema"成立。
- `js-error-first-seen` 基线查询确无 `api`/`type` 过滤（L311-L316），缺陷可复现。
- 告警信号共 6 个且 `js-error-spike` **已实现**（命令：`sed -n '15p' threshold-alert.event.ts | grep -oE '"[a-z-]+"' | wc -l` → 6；实现见 jobs.service.ts L253-L288）。
- ADR-050 编号未复用（命令：`ls .trae/documents/decisions | grep -oE '^ADR-[0-9]+' | sort -u | tail -3` → ADR-048/049/050）；引用 ADR-013/014/015/041 四个文件均存在（逐号 `ls` 校验）。
- SDK 版本 `1.5.3`（1.x 线成立）。

## 9. 覆盖率清单

已读：ADR-050 全文；`core.ts` L462-L561；`common/utils.ts` L60-L90；`jobs.service.ts` L150-L345；`threshold-alert.event.ts` L14-L17；`models/clickhouse/web/error.ts` L1-L40；`report-task.service.ts` L528-L581；`error.service.ts` L45-L105；`package.json`（SDK）。

未审：SDK 其余源码（performance/identity/types）；nightwatch-frontend 前端调用点（前轮已核）；nightwatch-backend 装配副本（本 scope 不要求 diff）；告警通知渠道映射；ClickHouse 历史数据（实例中不存在）。

## 10. 修复优先级

1. 拍板 5A/5B 后，先补 ADR 决策 4 的信号覆盖（R18-01）——否则 5B 的验收标准不可达。
2. 定稿 `onerror` 语义（R18-02），再写契约测试（console 不告警 / 运行时告警 / 资源不告警 三向）。
3. 写清验证前置（清表）与导出面校验（R18-03/R18-04）。
4. 文档订正（R18-05/R18-06）随后一次提交完成。

## 11. 台账指针

`newbie-modules/.trae/documents/findings.md` → 本轮追加 R18-01…R18-06；ADR-050 状态不变（仍为「提议中」，待决策 5 拍板）。
