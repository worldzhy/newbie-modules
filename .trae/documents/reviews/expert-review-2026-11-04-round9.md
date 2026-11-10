# 专家评审 round9（2026-11-04）— 对 round8 结论的严格复核

评审对象：`expert-review-2026-11-04-round8.md` 的结论本身（方案裁决的裁决），非代码变更。只读评审，未修改任何代码、未改 round8 报告。

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 备注 |
|---|---|---|---|---|
| newbie-modules（真源 / 报告所在） | dev | `e944fbf` | 1 dirty：`?? .trae/documents/expert-review-2026-11-04-round8.md` | dirty 路径即 round8 评审产物，非被审代码；代码域结论非 provisional |
| nightwatch-backend（装配 live） | dev | `cf4e47c` | 0 dirty | — |
| nightwatch-frontend（契约消费） | dev | `c96e9a7` | 0 dirty | 仅读 `src/api/_gen/api.ts` |

- 评审开始 2026-11-04T15:57:50Z，结束 2026-11-04T16:10Z（UTC）。
- 装配一致性：round8 已记录 `diff -rq` 零差异；本轮未重新比对（代码未变动，HEAD 相同）。
- 与 round8 锚点差异：仅新增 round8 报告文件本身。代码基线一致，故 round8 的代码级证据可沿用；**但其结论仍需按不变量重验**（§5 铁律）。

## 2. 范围与方法

- scope：`modules: [web-monitor]`，评审形态为**元评审**（复核 round8 的结论与定级），不扩审模块外代码。
- 方法：
  1. 对 round8 的每条计数/枚举做机械重算（`grep` 计数 + 逐文件读码），不采信其自述；
  2. 对 round8 的"不可达"结论做**反例构造**（换一种毒丸来源，而非重复其 appId 论证）；
  3. 运行一个最小探针验证静态推断（Mongoose 对 `Invalid Date` 的铸造行为），其余标注"待运行时确认"；
  4. 核对前端生成物以验证 round8 的契约变更结论。
- 未运行：`npm run build` / `tsc`（本轮无代码变更，无可归因对象）；未查 Mongo 实库（无凭证）。
- 未审：`web-monitor` 之外模块、角色/权限种子数据（无法从仓内取得，故 R8-07 仍不定级）。

## 3. 结论摘要

**round8 的方向与多数结论成立，但有 2 处实质性错误、4 处计数/清单错误、1 处遗漏 finding。**

- 成立（已重验）：R8-01 的**结论**（边界清单不完整）、R8-02（DTO 会改 apits 契约）、R8-04（flush 丢弃无记账）、R8-06（改点可枚举）、R8-07（跨项目读写缺项目级校验）、R8-08（无重试上限）。
- **错误 1（P1）**：R8-03 把"毒丸"整体判为不可达。appId 维度确实不可达，但**同一队列存在另一条可达毒丸**——payload `time` 可被调用方置为不可解析值，写入确定性地失败并永久重入队；重入队绕过上报侧的速率限制。round8 因此低估 R6-13 的真实等级。
- **错误 2（P1）**：round8 §10 的执行顺序（B+C 先行、A 最后）**违反其自己 R8-01 写下的前置条件**（"未覆盖者不得先行落地 B"）。按该顺序执行会把 custom/remove 等端点的 400 变成 500。
- 计数错误（P2）：`site` 端点 7→8（且 appId 消费端点只有 5 个）、`custom` 5→4、controller 10→11、`assertAppId` "9 处"→7 调用点；R8-01 清单**自身遗漏** `analysis` 4 个端点与 8 个 controller 的 `throw new Error`（今日即 500）。
- 遗漏（P2）：round8 只查了 flush 阶段的丢弃；drain 循环的 per-item `catch` 也在**无记账丢弃**，其中包含瞬时故障。

维度评分（对 round8 报告质量）：安全 中（毒丸结论过窄）｜架构 良｜契约 良（apits 判断正确）｜测试 中（只提 seam，未跑任何验证）｜门禁 未涉及｜治理 中（有裁决但优先级与前置条件自相矛盾，且计数不实）。

## 4. P0

无。

## 5. P1

### R9-01（代码级，新增）毒丸并非不可达：payload `time` 是第二个、且匿名可达的确定性失败源

- 证据链：
  - 入队前**不校验 `time`**：`report.controller.ts` 只解析 JSON、覆盖 `appId`、查 site，然后 `lpush`（[report.controller.ts#L62-L90](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/report.controller.ts#L62-L90)）。
  - 归一化直接铸造日期：`createTime: func.toDate(query.time)`（[report-task.service.ts#L375](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/services/report-task.service.ts#L375)），`func.toDate` = `new Date(String(value))`，非法值得到 `Invalid Date`（[shared/utils.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/shared/utils.ts)）。
  - 该值进入每一条 Mongo 行（page/environment/resource/custom 的 `createTime`），Mongoose 在写入前铸造失败。**运行时探针**（node 容器 `66b958b39256`，同仓 mongoose）：
    `new M({createTime: new Date("x")}).validateSync()` → `Cast to date failed for value "Invalid Date" at path "createTime"`。
  - 失败被 flush 归入 `failedAppIds` → 原 raw 重新 `lpush`（[report-task.service.ts#L307-L322](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/services/report-task.service.ts#L307-L322)），下一 tick 重复，无重试计数或死信。
- 可达性：**anonymous**。installation token 按 ADR-016 走 body（`navigator.sendBeacon` 无法设 header），随前端 JS 公开；任何站点访客都能取到并发送任意 `time`（或干脆省略 `time`，`String(undefined)` 同样得到 `Invalid Date`）。
- 暴露面：live（已装配，`cf4e47c`）。
- 影响：可用性。重入队直接 `lpush`（L315），**绕过**上报侧的 `llen >= total_limit_web` 速率限制（[report.controller.ts#L83-L89](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/report.controller.ts#L83-L89)）；队列是**单全局 key** `web-monitor:WebReportDatas`，毒丸占比升高后，其它 app 的正常上报被 429 拒绝，形成跨租户的采集面拒绝服务。
- 复现路径（静态可推导，运行时待确认写入拒绝）：持任一有效 installation token，`POST /web-monitor/report` body `{"type":1,"time":"x"}` → 返回 `ok` → 下一次 drain 起该 app 的条目永久重入队。
- 定级说明：round8 的 R8-03（"非法 **appId** 不可达"）为真，但毒丸**类别**可达；round8 用"appId 不可达"推出"R6-13 = P2"，属以偏概全。R9-01 为 P1（anonymous + 可用性 + live + 直接利用），不升 P0（未触及越权/密钥/既有数据破坏）。
- 修复方向：入队前或 drain 层拒绝不可解析 `time`（400 / 丢弃并记账）；与 C 层"非法 vs 可重试"分类、以及**重试上限/死信**合并落地，仅靠错误分类无法覆盖全部确定性失败。

### R9-02（方案级）round8 的切片顺序与 R8-01 的前置条件自相矛盾

- 证据：R8-01 要求"**未覆盖者不得先行落地 B**"（round8 §5），而 §10 优先级写"1. **B + C** … 3. **A**（独立批次）"（round8 §10）。
- 失败路径：B 把 `assertAppId` 从 `BadRequestException` 改为普通 `Error` 后，所有**未加参数级校验、直接把 appId 交给模型工厂**的请求端点，对非法 appId 由 400 变 500。当前已确认这类端点远不止 round8 列的两个：`custom`（4 端点，[custom.controller.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/custom.controller.ts)）、`remove`（1，[remove.service.ts#L46-L62](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/remove/remove.service.ts#L46-L62)）、`analysis`（4）、`ajax`（4）、`resource`（5）、`page`（4）、`environment`（2）、`error`（3）、`pvuvip`（5）。
- 影响：契约/正确性 P1（回归面覆盖 38 个端点，且会经 `throw new Error` 的既有 500 语义放大）。
- 修复方向（二选一）：
  1. **先 A 后 B**（round8 自己写的必要条件）；
  2. 或引入内部错误类型（如 `InvalidAppIdError extends Error`）+ 模块级异常过滤器把该类型映射为 400 —— 一次性覆盖全部 HTTP 端点，后台任务不经过过滤器故不参与重试；这比逐端点 pipe 更小、且不动 DTO/apits。round8 未考虑该选项。

## 6. P2

### R9-03（报告准确性）round8 的计数与清单不实

| round8 表述 | 实测 | 证据 |
|---|---|---|
| `site.controller` 7 个端点 | **8** 个（多出 `/list`）；其中**消费调用方 appId 的只有 5 个**（`update`/`getSystemForId`/`deleteUser`/`addUser`/`deleteSystem`），`/add` 由服务端铸造，`/getSysForUserId`、`/list` 按项目过滤 | [site.controller.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/site/site.controller.ts)；`@Get|@Post` 计数=8 |
| `custom.controller` 5 个端点 | **4** | `@Get|@Post` 计数=4（[custom.controller.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/custom.controller.ts)） |
| "10 个 controller" | **11** 个（`remove.controller` 不含 `appId` 字面量，未被计入） | `Glob **/*.controller.ts` = 11 |
| "约 35 处 `!appId`" | controller 内 **32** 处（全模块 42 处/14 文件） | `Grep '!appId|...'` 计数 |
| R8-06 "`assertAppId` 共 9 处调用 … 只需改这 7 个调用点" | **7 个调用点**（mongo 5 + CH ajax 1 + CH error 1）+ 1 定义 + 3 import = 11 行 | `Grep assertAppId` |
| R8-01 清单 | 遗漏 `analysis` 4 个端点；且 8 个 controller 共 **49 处** `throw new Error` —— "缺 appId"今日就是 500，不只是 B 落地后 | `Grep 'throw new Error\('` 计数 |

- 影响：这些错误不影响 R8-01 的**方向**，但会让"A 批次清单"在执行时再次遗漏；属文档/计划准确性，P2。

### R9-04（报告完整性）R8-04 的"丢弃记账"只覆盖了 flush，漏了 drain 的 per-item catch

- 现状：[report-task.service.ts#L298-L306](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/services/report-task.service.ts#L298-L306) 的 `catch` 打一条 error 后**直接丢弃该 raw**（不回写、不计数），与 L309-L311 注释"loss is not acceptable"直接冲突。该 catch 还覆盖 `getSiteForAppId` 的**瞬时故障**（Mongo 抖动），即合法数据也会被静默丢失。
- round8 的 R8-04 只要求 `flushBuckets` 返回 `{failed, dropped}`，未要求处理这一段；应扩展为"drain 内所有丢弃路径统一记账"，并区分瞬时错误（应回写）与永久错误（应丢弃）。

### R9-05（确认）R8-02 成立：DTO 会改 apits 产物

- 前端生成物已有 `export interface PostWebMonitorSystemAddRequest { [k: string]: unknown; }`（[api.ts#L9359-L9361](file:///Users/worldzhy/src/nightwatch-frontend/src/api/_gen/api.ts#L9359-L9361)）；改 DTO class 会使该 interface 变为具体字段，`api.ts` 必 diff。`GetWebMonitorSystemGetSystemForIdRequest` 已是 `{ appId: string }`，参数级 pipe 不改它。round8 结论正确，无需修正。

### R9-06（确认但未定级）R8-07 的跨项目读写成立，round8 未给出矩阵定级

- `getSystemForId`、`deleteSystem`、`deleteWebSiteUser`、`addWebSiteUser`、`custom`/`analysis`/`page`/`ajax`/`resource`/`environment`/`error`/`pvuvip` 读接口全部只要求模块级 `WebMonitorSite` 权限，服务层**不按 projectId 过滤**（对照组：`getSitesForUserId` 与 `getWebSiteListForUser` 有过滤，[site.service.ts#L117-L161](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/site/site.service.ts#L117-L161)）。
- 但"谁被授予该权限"在仓内无种子数据可证（`Grep WebMonitorSite` 仅命中装饰器）。按 §4 铁律，**未复核角色前只能记 P2/待定级**；round8 只写"按矩阵定级"未落定，属流程不完整而非结论错误。

### R9-07（确认）R8-08 成立，但修复不能只做分类

- 无重试计数、无退避、无死信（`Grep retry|attempt|dead-letter` 零命中）。R9-01 给出一个**分类无法覆盖**的确定性失败实例（日期铸造在 Mongoose 侧，不属"4xx/存储故障"二分）；因此 C 层分类 + **有界重试/死信**需同时落地。

### R9-08（补充证据）R8-03 的"appId 不可达"论证可加强，但措辞需收窄

- 加强：除 installation `appKey`（[web-installation.service.ts#L77](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/services/web-installation.service.ts#L77)）外，**站点创建也由服务端铸造** appId（[site.service.ts#L40-L43](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/site/site.service.ts#L40-L43)：注释明确"must never be caller-supplied"）。round8 未引用后者。
- 收窄：结论应限定为"**非法 appId 毒丸**不可由 API 注入"，而非"毒丸不可达"；历史脏行是否存在仍"待运行时确认"。

## 7. 误报剔除（对 round8 结论的反驳）

1. **撤回 round8 §3 的"R6-13 真实影响是 P2 健壮性"**：仅对 appId 向量成立；毒丸类别因 `time` 向量可达（R9-01），整体等级应为 P1。
2. **撤回 round8 §10 的顺序**（B+C → A）：违反 R8-01 前置条件（R9-02）。
3. **修正 round8 §7 误报 #1 的措辞**："上报入口不校验格式导致毒丸"被反驳的是 **appId 格式**部分；"入口不校验 payload 时间"仍成立。
4. **保留** round8 §7 误报 #2（"site 4 个端点"）与 #3（"无契约变更"仅参数级成立）：两者经本轮重验成立，仅需把 #2 的"实测 7 个"更正为"8 个端点 / 5 个消费 appId"。
5. **不撤回** R8-01/R8-02/R8-04/R8-06/R8-07/R8-08 的结论，仅按 R9-03/R9-04 补齐清单与范围。

## 8. 已核验通过的不变量（正面结论）

- **Redis 队列唯一写入口**：全模块 `lpush` 仅两处——`report.controller.ts:90`（上报）与 `report-task.service.ts:315`（重入队）；无第二个入队端点。这既支撑 R8-03 的 appId 结论，也定位了 R9-01 的绕过点。
- **appId 非调用方输入**：站点创建（`saveSiteData`）与 installation 绑定（`appKey`）两条路径均由服务端铸造，格式恒匹配 `APP_ID_PATTERN`。
- **动态集合/表名只在受守卫的工厂内拼接**：`${PREFIX}${appId}` 仅出现在 mongo 五个工厂与 CH `ajax.ts:42`/`error.ts:43`，全部先经 `assertAppId`；无直接 SQL/表名插值旁路（`Grep '${...appId...}'` 复核）。
- **apits 请求契约形态**：`Record<string, unknown>` body → `{ [k: string]: unknown }`，参数级 pipe 不改变生成物。
- **`flushBuckets` 失败粒度 per-app**：不会跨 app 误伤；`sdk-error` 的空 appId 不入 `rawsByApp`，不会误回写。
- **round8 的代码基线仍有效**：三仓代码 HEAD 与 round8 记录一致，仅新增报告文件。

## 9. 覆盖率清单

- 审了：round8 全文；`site/remove/custom/analysis/page` controller 实测；11 个 controller 的端点计数与 `!appId`/`throw new Error` 计数；`report-task.service` 的 drain/flush/requeue 全段；`func.toDate`；Mongoose 无效日期铸造（运行时探针）；前端 `api.ts` 的三类生成类型；`report.controller` 入队前校验；`saveSiteData` 的 appId 铸造。
- 没审：`ajax/resource/environment/error/pvuvip` controller 的逐个实现细节（仅计数与 grep）；CH 客户端对 `Invalid Date` 的序列化（未运行）；Mongo 实库是否有历史脏行；角色/权限种子；`web-monitor` 之外的模块。

## 10. 修复优先级（对 round8 的修订）

1. **R9-01 立即闭合**：`time` 不可解析时拒绝（上报侧 400 或 drain 侧丢弃并记账）+ 队列侧有界重试/死信；此项单独构成 P1，不应等待 R6-13 的完整分层。
2. **C 层（含 R8-04/R9-04）**：`flushBuckets` 返回 `{failed, dropped}`；drain per-item catch 区分瞬时（回写）与永久（记账丢弃）；有界重试。
3. **A 批次**：按 R9-03 修正后的清单（38 个消费调用方 appId 的端点）做参数级校验；**先于或与 B 同时落地**，或改用模块级异常过滤器。
4. **D**：上报侧 `isValidAppId(appKey)`，注释写明"防库内脏数据"（现状不可达）。
5. **R8-07**：另立 finding，补角色/权限种子取证后定级。
6. **测试 seam**：纯函数（错误分类、日期可解析判定、返回结构）+ 至少一条 drain 集成用例。

## 11. 台账指针

- **R9-01 是代码级 P1 open**，建议入 `newbie-modules/.trae/documents/findings.md`（暴露面 live、可达 anonymous、复现路径见 §5），并同步 `nightwatch-backend/.trae/documents/backlog.md` 引用 ID。
- R9-02..R9-08 为对 round8 的方案/报告缺陷，保留在本报告，不改写 round8（§0.2 快照规则）。
- 建议在 R6-13 行补记：`round8 裁决方向成立；round9 修订：切片顺序改为 A 与 B 同批或先用异常过滤器，毒丸等级上调 P1（R9-01）；计数与清单按 R9-03 修正。`
