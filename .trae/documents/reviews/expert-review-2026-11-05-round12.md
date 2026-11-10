# Expert Review round12（2026-11-05）— plan scope：round9 §10 C 层切片草案

评审对象：具名方案 = round9 报告 §10 修复优先级第 2 条「**C 层（含 R8-04/R9-04）**：`flushBuckets` 返回 `{failed, dropped}`；drain per-item catch 区分瞬时（回写）与永久（记账丢弃）；有界重试。」（`expert-review-2026-11-04-round9.md` L133），连同其支撑 finding R9-04/R9-07（round9 §6）与 round10 §10.4 的引用。只读评审，未修改任何代码。本报告是 plan scope 的首次 dogfood，编号 round12（round11 已被他会话占用）。

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 备注 |
|---|---|---|---|---|
| newbie-modules（真源 / 报告所在） | dev | `affe628` | 9 dirty：`M backlog.md`、`M findings.md`、`M report-task.service.ts`、`M shared/utils.ts`，未跟踪 round8/9/10/11 报告 + `report-task.service.test.ts` | `report-task.service.ts`/`utils.ts`/test 为 R9-01 修复在途（round10 verified）；评审以**工作树**为准。round11 报告属他会话（ADR-033 域），不重叠 |
| nightwatch-backend（装配 live） | dev | `16cf4b7` | 0 dirty | 装配面为 R9-01 修复**前**代码；live 暴露面判断以此为准 |

- 评审开始/结束：2026-11-05（Asia/Shanghai）。
- 命令出处：`git branch --show-current && git rev-parse --short HEAD && git status --porcelain`（两仓各一次）。
- R9-01 修复在途触及被审域（drain），但该修复已经 round10 复核（4/4 绿 + 未修复 3/4 红阴性对照），本轮对修复后工作树评审，不标 provisional。

## 2. 范围与方法

- scope：`plan`，方案引用见上。审查范围 = 主张 ∪ 依赖路径（`report-task.service.ts`、`report.controller.ts`、4 个 Mongo schema、CH `ajax.ts`、`shared/utils.ts`），不扩审无关代码。
- 主张清单与映射表（主张文本均逐字摘自方案/支撑 finding）：

| # | 主张 | 出处 | 依赖路径 / 命令 |
|---|---|---|---|
| C1 | （现状）flushBuckets 只返回 failed 集合，无 dropped 记账 | §10.2 隐含 | `report-task.service.ts` L325-369、L307 |
| C2 | （现状）drain per-item catch 吞错、不区分瞬时/永久、无记账，覆盖 getSiteForAppId 瞬时故障 | R9-04 | L298-305、L99 |
| C3 | （现状）无重试计数/退避/死信 | R9-07 | `Grep -i 'retry\|attempt\|dead.?letter\|maxRetries\|backoff\|retries'` 全模块 → 仅 1 行注释命中 |
| C4 | （背景）重入队 lpush 绕过限流 llen 检查 | R9-01/round9 §8 | L315 vs `report.controller.ts` L82-89 |
| P1 | （方案）`flushBuckets` 返回 `{failed, dropped}` 可闭合 R8-04/R9-04 记账缺口 | §10.2 | 同 C1/C2 |
| P2 | （方案）per-item catch 区分瞬时（回写）/永久（记账丢弃） | §10.2 | L298-305 |
| P3 | （方案）有界重试 | §10.2 | 全模块（C3 命令） |
| P4 | （支撑论证）分类法无法覆盖全部永久失败，「日期铸造在 Mongoose 侧」即反例 | R9-07 | schema 层 + 探针（§4） |
| P5 | （隐含）C 层三件套足以闭合 R8-04/R9-04/R9-07 | §10.2 整体 | — |

- 方法：现状主张 static 核验 + 命令取证；方案主张按证据门禁判 成立/不成立/证据不足；反驳轮 = 无共享上下文的独立代理（部分独立：同基础模型），只移交结论 + file:line；新发现向量用运行时探针（容器 `66b958b39256`，mongoose 7.8.13 取自 nightwatch-backend node_modules；CH 8123 `worldzhy` 账号）。
- 偏差披露：本评审与 R9-01 修复（已完成的异批工作）在同一仓库工作树相遇，但本轮未改代码；关键结论已尽量升级为 executed。

## 3. 结论摘要

**C 层草案方向正确（现状主张 C1–C4 全部成立，支撑论证 P4 成立且被新证据加强），但方案粒度不足以直接执行：三条方案主张均「证据不足/待细化」，且发现草案盲区——per-item catch 的分类管不到存储层铸造失败（R12-01，P1）。**

维度评分（对方案草案）：安全 中（方向对、覆盖有盲区）｜架构 中（dropped 粒度、计数载体等关键形态未定）｜契约 N/A｜测试 未涉及（测试 seam 条款在 round9 §10.6，不在 C 层文本内）｜门禁 N/A｜治理 良（优先级与先后约束明确）。

## 4. 主张判定表

| # | 判定 | 依据（置信级别） |
|---|---|---|
| C1 | **成立** | `flushBuckets(): Promise<Set<string>>`（L325），`return failedAppIds`（L368）；调用方仅用 failed（L307-322）。static |
| C2 | **成立** | L302-305 catch 仅 `logger.error` 后丢弃 raw，无计数/回写/分类；`getSiteForAppId`（L99）在 try 内，Mongo 抖动即合法数据被静默丢弃。static + 反驳轮确认 |
| C3 | **成立** | `Grep -i 'retry\|attempt\|dead.?letter\|maxRetries\|backoff\|retries'` 全模块仅命中 L310 注释；反驳轮扩 grep（`dlq\|failCount\|lrem\|ltrim`）并复核 jobs/pvuvip-task/ip-task，零实现。executed（命令）+ 反驳轮 |
| C4 | **成立** | 重入队 `lpush`（L315）无 `llen` 检查；限流只在上报侧（`report.controller.ts` L82-89）。static（round9 已核，本轮工作树复核一致） |
| P1 | **证据不足/待细化** | 草案未指明：dropped 的产出点（drain catch 还是 flush 层）、消费方（日志/指标/死信存储）、粒度（per-app 计数还是行级清单）。且**行级 dropped 在现有调用形态下不可实现**：flush 四处均为裸 `insertMany(rows)`（L353/358/362/366），ordered 默认 true，CastError 在文档构造阶段整批中止且不带行索引（反驳轮，mongoose 7.8.13）。返回结构本身不记账，记账形态未定。static + 反驳轮 |
| P2 | **证据不足/待细化（且有覆盖面缺陷）** | 分类表未定义（哪些异常算瞬时）。更关键：per-item catch 只能分类 **drain 期**异常（JSON 解析、getSiteForAppId、行构造）；**存储层铸造失败发生在 flush 期，不经过该 catch**——R12-01 类毒丸正是 flush 期失败，P2 条款管不到它。草案的分类位置与被防问题错位。static + 反驳轮 |
| P3 | **证据不足/待细化** | 界限值、计数载体（raw 为 opaque JSON string，计数需注入 payload 或旁路 Redis key）、死信形态、达到上限后的处置均未定义；草案也未说明有界重试与 C4 的关系——若保留 lpush 重入队仅加计数，限流绕过仍在。static |
| P4 | **成立（被加强）** | R9-01 的 time 向量已修，但同类「存储层铸造失败」向量仍存在 ≥3 个（R12-01，executed 探针 + 反驳轮）：永久失败可由客户端可控值在 Mongoose cast 阶段确定性触发，drain 层预分类无法穷举，有界重试/死信作为兜底必要。executed |
| P5 | **证据不足** | 至少四处设计缺口未定（dropped 粒度与行级识别、分类表须同时覆盖 drain+flush 两段、重试计数载体、与限流绕过的关系），草案粒度不足以评估充分性。static |

## 5. 方案外新发现（按 finding 记）

### R12-01（P1，open）Mongo 数字/字符串路径毒丸向量簇：R9-01 修复后仍 live

- 证据链（static）：
  - `page.screenWidth = item.screenWidth`、`page.whiteTime = performance.wit` 等原样入行（`report-task.service.ts` L135-136、L138-143）→ `WebPage` schema `screenWidth/whiteTime` 等为 number（`web-page.schema.ts` L15/L21/L27-28）。
  - `custom.customContent = item.customContent`（L163）→ `WebCustom.customContent` string（`web-custom.schema.ts` L12）；对象值触发 cast 失败。
  - `resource.bodySize = Number(item.bodySize)`（L204，`Number("abc")=NaN`）→ `WebResource.bodySize` number（`web-resource.schema.ts` L16）；行构造有 `duration >= slowTime` 门控（L186），攻击者设 `duration:5000` 即可通过。
  - 失败 → `failedAppIds.add`（L332）→ 该 app 全部 raw `lpush` 重入队（L313-318），无界循环，绕过限流（C4）。
- 探针（executed，环境断言：newbie-modules `affe628`、dirty 9；容器 `66b958b39256`，mongoose 7.8.13）：
  - `Number ← "abc"`：`Cast to Number failed for value "abc" (type string) at path "screenWidth"`；
  - `String ← {}`：`Cast to string failed for value "{}" (type Object) at path "customContent"`；
  - `Number ← NaN`：`Cast to Number failed for value "NaN" (type number) at path "bodySize"`；
  - 阴性对照：`Number ← "1920"` 正常铸造 1920（合法 SDK 不受影响）。
- 反驳轮（部分独立代理）：**无法推翻**。确认无 lean/raw 旁路、无 DTO/Pipe 清洗层、CastError 必经 failedAppIds → lpush、PagePerf 门控非防御（`query.type` 缺省即 PagePerf，customs 不受门控）。
- 可达性：anonymous（持公开 installation token，同 R9-01 路径，`report.controller.ts` L62-76 无字段校验）。
- 暴露面：live——backend 装配面同位置同代码（`nightwatch-backend .../report-task.service.ts` L135/L163/L204/L432，`Grep` 取证）。
- 影响：可用性（同 R9-01：单全局队列毒丸占比升高 → 合法上报被 429）。
- 修复方向：与 R9-01 同模式——handleWebData/收集层对数值字段加 `toNumberOr(0)` 类归一化、字符串字段只收 string；建议并入 R9-01 提交链或紧随其后。

### R12-02（P2，open）CH 侧 `Number("abc")=NaN` 静默落 0：数据质量，非毒丸

- `_ajax.bodySize = Number(item.bodySize)`（L432）→ CH `WebAjax.bodySize Int32`（`ajax.ts` L15）。
- 探针（executed，CH 8123，`default.probe_r12b` Memory 表）：`INSERT ... {"bodySize":null}` 成功，存 `0`（`input_format_null_as_default` 默认）；探针表已 DROP。
- 定级 P2：写不失败、不构成重入队；但攻击者/异常 SDK 可静默污染 bodySize 统计。随 C 层或 R12-01 修复一并归一化即可。

## 6. 误报剔除

- **「CH bodySize NaN 构成同类写失败毒丸」——否决（executed）**：JSONEachRow 序列化 NaN 为 null，CH 非空 Int32 列对 null 落 0 不抛错（§5 R12-02 探针）。威胁降级为数据质量。
- **「round11 编号可用」——否决**：`.trae/documents/expert-review-2026-11-05-round11.md` 已存在（他会话，ADR-033 域），本报告编号 round12。

## 7. 已核验通过的不变量

1. Redis 队列写入口仍仅两处（`report.controller.ts:90`、`report-task.service.ts:315`）——工作树复核与 round9 §8 一致。static
2. Mongoose cast 失败发生在任何网络写入之前，且错误不携带行索引（反驳轮，mongoose 7.8.13）——决定「行级 dropped」不可在裸 `insertMany` 形态下实现。executed（读库源码 + 探针）
3. CH 非空数值列对 null 落 0 不抛错（executed 探针）。
4. R12-01 各向量在 registry 工作树与 backend 装配面**逐行一致**（`Grep` 四行命中，行号相同）。static

## 8. 覆盖率清单

- 审了：round9 §10.2 与 R9-04/R9-07、round10 §10.4 文本；`report-task.service.ts` drain/flush/全部 collect 段（L82-520）；`report.controller.ts` L40-92；`web-page/web-custom/web-resource/web-environment.schema.ts`；CH `ajax.ts`；mongoose 铸造探针 ×4；CH null 探针 ×2；反驳轮三路。
- 没审：`jobs.service.ts`/`pvuvip-task.service.ts`/`ip-task.service.ts` 逐行业务（仅反驳轮 grep）；SDK 端真实字段集；`error.ts`/`sdk-error.ts` CH schema 列型；前端；web-monitor 之外模块。

## 9. 对草案的修订建议（修复优先级）

1. **R12-01 立即闭合**：并入 R9-01 提交链（registry-first），数值/字符串字段归一化与 `toDateOrNow` 同模式；R12-02 顺带处理。
2. **C 层细化后再评审**，细化须回答四问：dropped 粒度与行级识别（裸 `insertMany` 无法行级归因，需逐行写或按值可识别）、分类表同时覆盖 drain 期与 flush 期、重试计数载体（payload 注入 vs 旁路 key）、有界重试与限流绕过（C4）的关系。
3. round9 §10 其余优先级项（A 批次 38 端点、D、R8-07 定级）维持原序，不受本轮影响。

## 10. 台账指针

- `newbie-modules/.trae/documents/findings.md`：新增 R12-01（P1，open）、R12-02（P2，open）；R9-04/R9-07 维持 open（C 层细化后关闭）；R10-01/R10-02 维持 open。
- 本报告不改写 round9/round10（§0.2 快照规则）；对 round9 §10.2 的修订以本报告 §4/§9 为准。
