# 专家评审 round8（2026-11-04）— R6-13 修复方案

评审对象：会话中提出的 R6-13 分层修复方案（web-monitor `appId` 异常语义分层），非代码变更。只读评审，本文不修改任何代码。

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 备注 |
|---|---|---|---|---|
| newbie-modules（真源） | dev | `e944fbf` | 0 dirty | 09:40Z 前后取证 |
| nightwatch-backend（装配 live） | dev | `cf4e47c` | 0 dirty | 09:40Z 前后取证 |
| nightwatch-frontend（契约消费，只读） | dev | `c96e9a7` | 0 dirty | 未触及 |

装配一致性：`diff -rq newbie-modules/packages/modules/web-monitor nightwatch-backend/src/modules/web-monitor` → 零差异（`DIFF_RC=0`）。评审结论同时适用于两处。无并行会话在途改动，结论非 provisional。

## 2. 范围与方法

- scope：`modules: [web-monitor]`，评审形态为**方案裁决**，不产生代码 finding。
- 取证：静态读码 + `grep` 全量枚举 `appId` 入口（不采信方案自述清单）；核对 `assertAppId` 全部调用点（9 处/3 文件）；核对 assembly 归属与前端契约生成物。
- 未运行构建/测试（方案未落代码，无可运行对象）；文中"待运行时确认"均按此标注。
- 未审：`web-monitor` 之外模块、`organization` 模块去留、前端渲染逻辑。

## 3. 结论摘要

**方向正确，执行细节需三处修正。**

- 分层原则成立：请求边界 4xx、存储层不变量、异步任务按可重试性分类，三者分开是对的方向（优于"统一 400"或"统一 5xx"）。
- 但方案的**边界清单与实际问题陈述不准确**（R8-01/R8-03），**A 层的实现选型会引入未声明的契约变更**（R8-02），**C 层缺少丢弃记账**（R8-04）。
- 建议切片：**B+C+D 先落地（potions 修复本体，约 3 文件）**；A 作为独立的"边界一致性"批次，并按 R8-01 用 grep 清单驱动；R8-07/R8-08 单列，不并入 R6-13。

维度评分（方案层面）：安全 中（相邻风险未单列）｜架构 良（分层正确）｜契约 弱（A 层选型与"无契约变更"自述矛盾）｜测试 弱（无可执行 seam）｜门禁 未涉及｜治理 良（有裁决与台账意识）。

## 4. P0

无。

## 5. P1（方案缺陷）

### R8-01 边界清单不完整，B 层会造成 400→500 回归

- 证据：全模块 `appId` 入口经 grep 为 **10 个 controller、约 35 处 `!appId` 判断**；仅 `site.controller.ts` 就有 7 个端点（add/update/getSysForUserId/getSystemForId/deleteUser/addUser/deleteSystem），方案写成"site 4 个"；`modules/web/custom.controller.ts` 5 个端点、`modules/remove/remove.controller.ts` 1 个端点（`@Body() CustomDeleteFilter`，`appId` 来自 body）均未列入。
- 失败路径：`remove.service.customDelete`（[remove.service.ts#L22-L62](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/remove/remove.service.ts#L22-L62)）与 `custom.service`（`WebCustomFilter(appId)`）目前**只靠 `assertAppId` 兜底**得到 400；B 层改为普通 Error 后，这些端点对非法 `appId` 变成 500。
- 要求：A 层清单以 `grep -n 'appId' **/*.controller.ts` 的实测结果为准，并在报告/PR 中逐条列出覆盖端点；未覆盖者不得先行落地 B。

### R8-02 A 层选型与"无前端契约变更"自相矛盾

- 证据：这些端点普遍是 `@Query() q: Record<string, unknown>` / `@Body() body: Record<string, unknown>`（如 [custom.controller.ts#L18-L42](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/custom.controller.ts#L18-L42)）；`remove.controller` 的 `CustomDeleteFilter` 是 **interface**，全局 `ValidationPipe` 对 interface 没有运行时 metatype，**不会校验**，改成 DTO 才能生效。
- 改为 DTO class ⇒ Swagger request schema 变化 ⇒ `npm run apits` 产物变化 ⇒ 前端 `src/api/_gen/api.ts` diff。方案却声称"无前端契约变更"。
- 且 `@Query() q: Record` 的方法体全部依赖解构，改 DTO 要连带改签名与调用，属于远超 R6-13 的重构。
- 建议：A 层用**参数级 helper/pipe**（`@Query("appId", WebMonitorAppIdPipe)`、`@Body("appId", …)`），不改 DTO/接口、不触发 apits；`remove` 这种整 body 参数用 helper 显式校验。

### R8-03 毒丸可达性被高估，问题陈述需降级

- 证据：`appKey` 由服务端生成（[web-installation.service.ts#L77](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/services/web-installation.service.ts#L77) `func.randomString(7).slice(0, 7)`，恒匹配 `APP_ID_PATTERN`）；上报入口 [report.controller.ts#L62-L73](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/report.controller.ts#L62-L73) 用 installation 的 `appKey` **覆盖**`query.appId`，并在入队前以 400 拒绝不存在的 `appId`。
- 推论：非法 `appId` 进入 Redis 只能来自 **库内历史脏行、人工写库或直接写 Redis**；"SDK 上报畸形 appId → 无限自我放大"的链路不成立。
- 因此：R6-13 的真实影响是**健壮性与语义错位（P2）**，不是可用性/数据面 P1；方案中"自我放大""无限增长"的表述应删除或加可达性限定。D 层（ingest 格式校验）是可保留的防御性冗余，但必须标注"现状不可达，仅防库内脏数据"，否则会被当成真实缺口。

### R8-04 C 层丢弃缺少记账，且需改返回形状

- 现状：`flushBuckets` 返回 `Set<string>`，外层仅按 `failedAppIds` 重入队并打 `warn`（[report-task.service.ts#L325-L368](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/services/report-task.service.ts#L325-L368)）。
- 方案只说"计入 dropped 计数"，未定义计数载体、日志字段与对既有注释"loss is not acceptable"（[#L309-L311](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/web/services/report-task.service.ts#L309-L311)）的修订。
- 要求：返回值改为 `{ failed: Set<string>; dropped: Map<string, number> }`（或等价），外层分别打 error（含 label、appId、行数）与 warn；并明确 `sdk-error` 的 `appId=""` 语义（当前失败只记日志、不回写，保持）。

## 6. P2

- **R8-05 测试 seam 未定义**：`web-monitor` 全模块 0 个 `*.test.ts`；`flushBuckets` 为 private 且依赖 Redis/Mongo/ClickHouse/Prisma。直接写集成测试成本高。要求先抽出纯函数 `classifyFlushError(err): "retryable" | "invalid"`（或等价），单测落在该纯函数与新返回结构上，否则"单测"不可执行。
- **R8-06 内部守卫替换点已可枚举**：`assertAppId` 共 9 处调用（mongo 5、clickhouse `ajax.ts:36`、`error.ts:43`）；B 层只需改这 7 个调用点的 import/函数名 + 1 处定义，无隐藏消费者（静态 grep 已覆盖）。
- **R8-07 相邻风险不该"可选"处理**：格式合法但不存在的 `appId` 仍会触发 Mongo 集合 / ClickHouse 建表（`autoCreate`），且读接口只持模块级 `WebMonitorSite` 权限即可按任意 `appId` 读；`remove/customDelete` 同理可删他项目数据。属**独立 finding**（建议另立 R8-07，按 §4 矩阵定级），不并入 R6-13，但也不应被"单列决策"一笔带过。
- **R8-08 重试天花板**：分类后存储故障（CH/Mongo 宕）仍无限重试，方案的"毒丸"措辞必须限定为"非法 appId 毒丸"，持久故障韧性另记。

## 7. 误报剔除（对方案自述的反驳）

1. "上报入口不校验格式导致毒丸" → 反驳：`appKey` 服务端生成且上报前覆盖，格式非法不可达（R8-03）。
2. "site 4 个端点需校验" → 反驳：实测 7 个，且 `getSystemForId` 空值当前是 500（[site.service.ts#L112-L114](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/site/site.service.ts#L112-L114)），不是方案声称的 400。
3. "改动不产生前端契约变更" → 仅在参数级 pipe/helper 方案下成立；DTO 方案不成立（R8-02）。

## 8. 已核验通过的不变量

- registry↔装配 `web-monitor` 零差异；评审结论对 live 代码有效。
- `APP_ID_PATTERN` / `isValidAppId` 已是共享导出，A/B/C 均可复用，无需新造正则。
- 上报路径的 `appId` 只来自 installation，不取自 payload（不可注入）。
- `flushBuckets` 的失败粒度是 per-app，`failedAppIds` 不会跨 app 误伤；`sdk-error` 的空 `appId` 不入 requeue。
- 动态集合/表名唯一入口就是 `assertAppId` 守卫的 7 个工厂调用点（无旁路）。

## 9. 覆盖率清单

- 审了：`shared/utils.ts`、`shared/node-cache.service.ts`（相关行）、site/remove/custom/web 全 controller 的 `appId` 入口、`report.controller`、`report-task.service` 的 drain/flush、`site.service` 的相关方法、mongo/clickhouse 模型工厂、`web-installation.service`、`web-token.resolver`、`project-application.service` 的 `upsertSiteForWebMonitor` 调用。
- 没审：`pvuvip`/`analysis` 等服务的聚合 SQL 正确性、前端组件、Mongo/CH 实际 DDL 行为（未运行）、`organization` 模块去留、权限 `scope` 语义实现细节。

## 10. 修复优先级

1. **B + C（含 R8-04 返回结构与记账、R8-05 seam）** —— 3 文件 + 1 新测试，闭合"异步层语义错位 + 非法值永久重试"。
2. **D** —— 1 处，且注释写明"防库内脏数据"。
3. **A**（独立批次）—— 按 R8-01 清单逐个端点参数级校验，不引入 DTO/apits 变更。
4. **R8-07 / R8-08** —— 另立 finding 与 backlog，不塞进 R6-13。

## 11. 台账指针

本轮为方案评审，无代码 finding 入台账；建议在 `newbie-modules/.trae/documents/findings.md` 的 R6-13 行补充"round8 裁决：B+C+D 先行，A 独立批次；相邻 DDL/跨域读取另立 R8-07"。R8-01..R8-08 作为方案缺陷保留在本报告，不新增代码级 open 项。
