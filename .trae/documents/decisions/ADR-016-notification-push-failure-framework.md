# ADR-016: notification-center 推送失败记录框架化

状态：已采纳
日期：2026-10-23
归属注记：本决策治理 registry 模块 notification-center 的推送失败可见性契约，存放于本仓。nightwatch-backend 侧的 application schema 方案（ADR-025，不成熟方案）已被删除。
编号说明：2026-10-23 — 上文所指的 nightwatch-backend ADR-025（notification-push-failure-visibility，22cd950 新增、e464b50 删除）与当日晚些时候同号新建的 ADR-025-self-observation-via-seed 是两个不同决策；引用旧决策时以文件路径为准，勿按编号回溯。

## 背景

notification-center 作为 registry 模块，其推送端口 `NotificationPushPort.pushSystemText` 仅回传聚合计数 `{succeeded, failed}`，per-recipient 的失败信息全部丢失。此前 nightwatch-backend 的补救方案（ADR-025，application schema 中自建 `NotificationPushFailure` 表）被判定为**框架模块功能不完整**——任何消费 notification-center 的宿主都会遇到推送管道静默断掉的问题，该能力不应由宿主各自补漏。

框架化决策要点：notification-center 必须自己持有推送失败的完整信息，port 契约需携带 per-recipient 结果。

## 候选方案

- **A. 保持 application schema（被推翻）**：每个宿主自建失败表，registry 只回传聚合计数。被否——框架模块的核心能力缺失，强迫每个宿主重复实现同一概念；port 契约信息边界导致 registry 拿不到 recipient 粒度，自愈逻辑无法统一。
- **B. Port 契约升级 + registry 建表 + 宿主回传 per-recipient 结果（选定）**：`pushSystemText` 返回值改为 `Promise<PushDeliveryResult[]>`，registry 层自己落库/自愈；项目推送轨道（宿主自行路由）通过暴露的 `recordFailure` / `resolveFailures` API 回传结果。
- **C. 维持现状，不做失败记录**：被否——平台能力丧失级问题（url-monitor 审查遗留项 #4），静默断管无法被用户发现。

## 决策

选 B，具体形态：

1. **Port 契约升级**：`NotificationPushPort.pushSystemText` 返回值从 `Promise<{succeeded: number; failed: number}>` 改为 `Promise<PushDeliveryResult[]>`，其中 `PushDeliveryResult = { recipientKey: string; success: boolean; error?: string }`。
2. **recipientKey 编码规范**：registry 定义 opaque key 格式 `${platform}:${recipientType}:${recipientId}`（如 `lark:group:oc_xxx`），registry 只存不解释，宿主负责编码/解码。
3. **Registry schema 新增 `NotificationPushFailure`**：字段 `id, notificationRecordId, recipientKey, error, createdAt, resolvedAt`；与 `NotificationRecord` 建立真 FK（`onDelete: Cascade`），去掉 application schema 方案中的 `platform/recipientType/recipientId` 三列，彻底解耦 Lark 概念。
4. **Registry service 层**：`NotificationCenterService.dispatchPush` 遍历结果，失败调 `recordFailure`，成功调 `resolveFailures`（自愈：同一 recipientKey 的历史失败自动标记 resolved）；新增 `listUnresolved` 供 controller 暴露查询端点。
5. **项目推送轨道接入**：宿主 `ProjectNotificationPushService` 推送后调用 registry `recordFailure` / `resolveFailures` 回传 per-recipient 结果。
6. **Controller 端点**：`GET /notification-center/push-failures`，归入 notification-center controller，权限沿用 `List` + `NotificationPushFailure`。
7. **前端**：API 路径改为 `/notification-center/push-failures`；`recipientKey` 解析显示由前端按需拆分（registry 不解释 key）。

决定性理由：**框架模块的功能完整性**——notification-center 是 registry 模块，其推送失败可见性属于框架核心能力，不应由宿主各自补漏；port 契约升级后任何宿主都能获得统一失败记录。

## 跨宿主 / 演进检验

- **换任意宿主装配 notification-center**：port 契约只要求宿主返回 per-recipient opaque key 和 success/failure，不泄漏 Lark 概念。Slack/企业微信宿主编码自己的 `slack:channel:Cxxx` 或 `wechat:group:wxid_xxx` 即可。
- **recipientKey 的不可解释性**：registry 层不解析 key 内部结构，所有比较都是字符串等值比较，宿主编码格式变更不影响框架逻辑。
- **项目推送轨道**：任何宿主的自行路由逻辑都可以通过 registry 暴露的 `recordFailure` / `resolveFailures` 将结果写回统一失败表。
- **与现有契约兼容**：`TestPushResultDto` 保持 `{succeeded, failed}` 聚合计数不变；新增 `results: PushDeliveryResult[]` 作为诊断扩展，是向后兼容的 additive change（旧前端只消费聚合计数不受影响）。

## Extension: testPush returns per-recipient results

After scheme B landed we noticed the `testPush` endpoint was delivering
diagnosis value only up to aggregate counts `{succeeded: 2, failed: 1}`.
Its sole purpose is diagnosing push pipeline health, but which chat failed
and what error it returned required opening another page with the red-badge
banner. That breaks the principle that a diagnostic tool should close the
loop on itself.

延伸决策：`TestPushResultDto` 在保留聚合计数的同时，附加 `results: PushDeliveryResult[]` 字段，由前端在 toast 中直接列出失败收件人的 label + error message。

技术细节：
- Swagger spec 内联 object schema（不用 `$ref: getSchemaPath(PushDeliveryResultDto)`），因为后者在 Controller 路由上不被直接引用时会产生 dangling `$ref`，导致 OpenAPI client generator（apits）无法解析。
- `PushDeliveryResultDto` 类保留（class-transformer runtime type 用），OpenAPI 展示形态与 runtime shape 解耦。
- 前端 toast 从 `recipientKey`（`${platform}:${type}:${id}`）解析 label，不要求 registry 知道 Lark 概念。

## Edge-case hardening: whole-track failures

Both delivery tracks must never produce an orphan `NotificationRecord`
with zero failure visibility after `notify()` has persisted the row.

**System track (registry dispatchPush)** wraps `pushPort.pushSystemText()`
in try/catch. When the adapter crashes wholesale (DB down enumerating
bindings, Lark client broken, etc.), a failure row is recorded with
`recipientKey = "__adapter__"` — a sentinel value outside the
`${platform}:${type}:${id}` convention. The frontend banner renders this
as "Push adapter (all system chats)" via a hard-coded branch.

**Project track (host ProjectNotificationPushService)** wraps the whole
post-`notify()` body (setting lookup → binding lookup → record read →
Lark sends) in try/catch. Whole-track exceptions record a row with
`recipientKey = "__project_push__"`, rendered as "Project push track".
Per-recipient failures inside the `Promise.all` are handled individually
(one bad binding never suppresses others).

**testPush** wraps `pushPort.pushSystemText()` in try/catch and returns
a synthetic `PushDeliveryResult` with `recipientKey = "__adapter__"`
instead of throwing 500. The synthetic row is **not** persisted to
`NotificationPushFailure` — testPush is a diagnostic tool and its
ephemeral results must not pollute the real failure table.

**dispatchPush** per-recipient DB writes use `Promise.all` (not serial
`for...of await`): each row belongs to a different recipientKey with no
write conflict, so parallelism is safe and avoids N+1 roundtrips.

## 影响

**更容易**：

- 所有消费 notification-center 的宿主自动获得推送失败可见性，无需自建表。
- 自愈逻辑统一在 registry 层，宿主编码格式变更不影响框架行为。

**更难 / 后续工作**：

- **Breaking change**：port 契约返回值类型变更，所有现有宿主 adapter 必须升级（当前仅 nightwatch-backend 一个消费方）。
- **数据迁移**：nightwatch-backend 已有的 `application."NotificationPushFailure"` 数据在新方案下不保留（不成熟方案、无生产数据），migration 直接删除旧表、新建 registry 表。
- **前端适配**：API 路径从 `/notification-push-failures` 改为 `/notification-center/push-failures`，`recipientKey` 展示需要前端自行拆分 platform/type/id。
