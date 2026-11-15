# Expert Review — round41（2026-11-14）

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 说明 |
| --- | --- | --- | --- | --- |
| newbie-modules | dev | `0b7c416` | clean | 模块真源 |
| nightwatch-backend | dev | `d723247` | clean | 装配面 + 宿主调用方 |
| nightwatch-frontend | dev | `09e74e6` | dirty 9 | 全部落在 3D panorama / docs intro 域，不在 notification 域，本域结论 non-provisional |

- 评审开始：2026-11-14 01:2x（Asia/Shanghai）；结束：2026-11-14 01:4x。
- 并行会话：frontend 的 dirty 路径为 `.trae/documents/specs/*`、`public/docs/intro/*`、`components/panorama/*`、`projects/[projectId]/page.tsx`，与 notification 域无交集。
- git 客户端：GitHub Desktop 发行版（`/Applications/GitHub Desktop.app/.../git`）。

## 2. 范围与方法

- **scope**：`modules: [notification-center]`。
- 模块真源：`newbie-modules/packages/modules/notification-center`（14 文件 / 11 ts）。
- 装配面：`nightwatch-backend` 命中（`newbie-modules.json` 含该 key），`src/modules/notification-center/**` 与 `prisma/models/notification-center.prisma` 纳入。
- 宿主消费点：`src/application/notifications/url-check/url-check-alerts.notifications.service.ts`、`src/application/scheduled-jobs/tasks/heartbeat.detect-offline.job.ts`、`src/application/notifications/project-notification-push.service.ts`、`prisma/seeds/permission-groups.ts`。
- 前端消费点：`notifications/**`、`components/notification-center/use-open-notification.ts`、`lib/safe-path.ts`、`i18n/messages/{zh,en}.json`、`src/api/_gen/api.ts`。
- 契约文档：ADR-062 / ADR-063 / ADR-064、模块 README、迁移目录。
- 方法：装配一致性 diff → 授权/租户不变量 → 数据生命周期 → 契约一致性 → 前端第二向量 → 两个无共享上下文代理做反驳轮（只移交结论 + file:line）。
- 失败/重跑：无代理失败。

机械取证：

```
diff -rq registry/packages/modules/notification-center backend/src/modules/notification-center   → 空
diff -q  registry/.../prisma/schema.prisma backend/prisma/models/notification-center.prisma       → 空
grep -cE '@(Get|Post|Put|Patch|Delete)\(' notification-center.controller.ts                     → 22
grep -c 'test(' notification-center.service.test.ts                                             → 24
node --import tsx --test notification-center.service.test.ts                                    → 24/24 pass
npx tsc --noEmit (nightwatch-backend)                                                           → exit 0
```

## 3. 结论摘要

| 维度 | 评分 | 说明 |
| --- | --- | --- |
| 安全 | 良 | 可见性过滤与项目归属校验齐全；MEMBER 的运维面读写是已确认的信任决策 |
| 架构 | 良 | fingerprint 单列唯一 + 显式 alertKey 落地正确，跨项目隔离成立 |
| 契约 | 中 | HTTP `NotifyDto` 缺 alertKey/status；README 与 ADR 归因有两处漂移 |
| 测试 | 中 | 24 条均过，但静默 service（create/update/cancel）零覆盖，R41-01/02/03 均无测试 |
| 门禁 | 良 | tsc / format / 装配 diff 全绿；迁移无消费仓兼容守卫 |
| 治理 | 良 | ADR-063/064 与台账同步；R39-11/R39-12 仍挂账 |

**无 P0，无 P1。** 反驳轮把初判 P1 的 R41-02 降为 P2（见 §7）。共 8 条 P2。

## 4. P0

无。

## 5. P1

无。

## 6. P2（按主题）

### 6.1 数据生命周期

**R41-01｜`upsertAlert` 先查后建，无唯一冲突兜底**

- 证据：[notification-center.service.ts:424-437](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.service.ts#L424-L437)：`findUnique({ where: { fingerprint } })` 为 null 后直接 `create`，未捕获 `P2002`。
- 可达：同一 fingerprint 的首次并发投递（如 webhook 重试与 job 同时触发）。影响：其中一路 500；下次运行可重试，不丢已持久化记录。暴露面：live。
- 与 R39-10（center setting 首次并发）同类，修复方式相同：捕获唯一冲突后重查。
- 定级：P2（健壮性/可用性）。

**R41-02｜`cancel()` 对未开始窗口写出 `endsAt < startsAt`**

- 证据：[notification-silence.service.ts:91-102](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-silence.service.ts#L91-L102) 仅当 `endsAt <= now` 早退，否则写 `endsAt = now`，不重跑 `assertWindow`（[:137](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-silence.service.ts#L137)）。
- 可达：MEMBER/ADMIN 在设置页创建 `startsAt` 在未来的窗口（`CreateSilenceDto` 无未来校验）后点「立即结束」。
- 影响（反驳轮修正后）：该行违反应用层窗口不变量；在 `startsAt` 到来前列表显示 `scheduled` 并仍渲染「结束」按钮；再次 cancel 直接早退但仍弹成功提示（空转）。**不会**产生错误静默（`findActiveId` 永不命中），`startsAt` 一到前端自动转 `ended`，且可经 `PUT` 传 `startsAt` 或新 `endsAt` 修复——因此不是 P1。
- 暴露面：live（前端）+ artifact（registry）。
- 修复方向：`startsAt > now` 时把 `startsAt` 一并压到 `now`，或拒绝 cancel 未开始窗口、只允许改窗口。
- 定级：P2。

**R41-03｜`update()` 可改写已被投递记录引用的静默窗口**

- 证据：[notification-silence.service.ts:67-85](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-silence.service.ts#L67-L85) 无条件写 `condition/startsAt/endsAt/comment`；`NotificationDeliveryAttempt` 无窗口快照（[schema.prisma:199-225](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/prisma/schema.prisma#L199-L225)），只存 `silenceId`。
- 可达：持 `Update:NotificationSilence` 的 MEMBER/ADMIN（seed 将 Notifications 组全原子授予 MEMBER）。
- 影响：`Restrict` 只保证引用不可删除，不保证被引用窗口不可重写；改 `condition`/窗口会改变历史 attempt 所指向窗口的语义，绕过 [ADR-063:90](file:///Users/worldzhy/src/newbie-modules/.trae/documents/decisions/ADR-063-notification-silence-is-a-runtime-mechanism.md) 的「已产生投递记录的窗口只能提前结束」。
- 修复方向：窗口存在 attempt 时只允许前移 `endsAt`（或只允许 `cancel`），拒绝改 `condition`/`startsAt`。
- 定级：P2（运维权限、审计完整性）。

### 6.2 契约与文档

**R41-04｜HTTP `NotifyDto` 未暴露 `alertKey`（及 `status`/`recoveredAt`）**

- 证据：[notification-center.dto.ts:75-105](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.dto.ts#L75-L105) 无这些字段；service 侧 [NotifyInput:118-157](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.service.ts#L118-L157) 已有；`whitelist: true` 会静默剥离多传字段。
- 影响：`POST /notifications` 的调用方无法使用 ADR-064 配对键，也无法产生 recovered 事件。当前宿主全部走进程内 service 调用并已正确传 `alertKey`，无 HTTP 消费者，属契约悬空而非线上偏差。
- 修复方向：要么在 DTO 暴露 `alertKey`（并补 `status`/`recoveredAt`），要么在 ADR/README 明确「HTTP 投递不支持告警生命周期」。
- 定级：P2。

**R41-05｜README 的 fingerprint 构造漏 `alertKey`**

- 证据：[README.md:10](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/README.md#L10) 仍写「project id + deduplication key，回退 notification key」；实际 [buildAlertFingerprint:89](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.service.ts#L89) 与 schema 注释均为 `alertKey ?? deduplicationKey ?? notificationKey`。
- 影响：文档漂移，本轮重构引入。定级：P2（文档一致性）。

**R41-06｜ADR-064 背景把复合唯一键归因给 ADR-062**

- 证据：`grep -n fingerprint ADR-062*` 无输出；ADR-062 只有 [:86](file:///Users/worldzhy/src/newbie-modules/.trae/documents/decisions/ADR-062-notification-delivery-rules-decouple-severity-from-push.md) 的「由数据模型保证」，从未写 `@@unique([notificationKey, fingerprint])`。复合键实际来自 schema。
- 影响：归因不准，不影响决策。定级：P2（文档精度）。

**R41-07｜`NotifyDto` 缺少长度上界**

- 证据：[notification-center.dto.ts:75-105](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.dto.ts#L75-L105)：`link` / `deduplicationKey` / `notificationKey` 仅 `@IsString`；DB 为 VarChar(512/255)，越界触发 Prisma `P2000`，宿主无 Prisma 异常过滤器 → 500 而非 400。
- 定级：P2（输入健壮性）。

### 6.3 迁移与门禁

**R41-08｜fingerprint 唯一索引迁移无去重前置步骤**

- 证据：`prisma/migrations/20261114003000_alert_fingerprint_unique_silence_restrict/migration.sql` 直接 `DROP INDEX` 旧复合键 + `CREATE UNIQUE INDEX ... ("fingerprint")`，注释声明旧 Alert 数据可直接丢弃但未实际清理。
- 影响：本宿主迁移已成功（即迁移时无重复 fingerprint）；其它消费仓若已有重复值，`CREATE UNIQUE INDEX` 失败、迁移中止。
- 修复方向：迁移内先清空/去重 Alert（按 FK 依赖顺序），或在 README/runbook 写明「升级前需清空 Alert」。
- 定级：P2（ops，非本宿主）。

### 6.4 跨轮 carry-over

- **R39-11（open）**：Alert 无 TTL / 清理任务，长期累积。本轮确认仍无清理路径。
- **R39-12（open）**：模拟器 `runtimeReason` 只判静默，忽略 `channel-off` / `subscription-off` / `no-port`，与实际 `resolveRuntime` 求值不一致。
- R40-03 / R40-04：withdrawn（用户 2026-11-14 确认信任 MEMBER，拆组方案作废）。

## 7. 误报剔除（反驳轮裁决）

初判 **P1：R41-02「未来窗口 cancel 后永久卡死、完全不可编辑」** —— 反驳轮部分推翻，主会话读码采纳：

- 「不可编辑」不成立：`update()` 只校验组装后的窗口（[notification-silence.service.ts:72-74](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-silence.service.ts#L72-L74)），传 `startsAt` 或新 `endsAt` 即可通过。
- 「永久卡死」不成立：`startsAt` 一到，前端 `statusOf` 转 `ended`，按钮消失。
- 「会产生错误静默」不成立：`findActiveId` 的 `startsAt <= now < endsAt` 永不命中。
- 保留：不变量被破坏、scheduled 显示、重复 cancel 空转却提示成功。

裁决：降为 **P2**，修复方向从「恢复 DELETE」改为「cancel 未开始窗口时同步压平 startsAt 或拒绝」。

另：`use-open-notification` / `isSafeNotificationLink` 的跳转安全用第二向量（`//`、`/\`、`javascript:`、非 http(s)）复核，未击穿，不立 finding。

## 8. 已核验通过的不变量

1. **装配一致**：registry ↔ backend 模块目录 `diff -rq` 空；prisma model 空。
2. **跨项目配对隔离**：fingerprint 前缀含 `projectId`（系统域为 `-`），不同项目不会共享 Alert；同项目内由调用方显式 `alertKey` 区分。
3. **宿主配对正确**：url-check down/recovered（[url-check-alerts.notifications.service.ts:58,97](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/url-check/url-check-alerts.notifications.service.ts)）与 heartbeat offline/recovered（[heartbeat.detect-offline.job.ts:112,213](file:///Users/worldzhy/src/nightwatch-backend/src/application/scheduled-jobs/tasks/heartbeat.detect-offline.job.ts)）两侧 `alertKey` 完全一致；`alertKey` 经 `ProjectNotificationPushService` 原样透传。
4. **删除链彻底移除**：controller 无 DELETE silence、service 无 `remove`、前端无调用、i18n 无残留键、`src/api` 无 `deleteNotificationSilencesId`（grep 0）。
5. **Restrict 生效**：`NotificationDeliveryAttempt.silenceId` 外键 `ON DELETE RESTRICT`（schema + migration），被引用窗口无法删除。
6. **读面隔离**：`list` / `unread-count` / `markRead` / `delivery-attempt` 均带 `projectId IS NULL OR projectId IN visibleProjectIds`；`markRead` 用 `findFirst` + 可见性，越权 id 无回执写入、无存在性 oracle。
7. **写面归属**：`notify` 携带 `projectId` 时校验 `visibleProjectIds`，越权返回 403。
8. **并发兜底**：dedup 唯一冲突后重查、行被删改抛 409（R39-09）；center setting 首次并发 P2002 后重查（R39-10）。
9. **链接安全**：前端 `isSafeExternalUrl` 仅 `http:`/`https:`，`isSafeInternalPath` 拒绝 `//`、`/\`；后端 `isSafeNotificationLink` 同口径。
10. **文档端点清单一致**：README 列出的端点与 controller 22 个装饰器一致（命令计数）。
11. **测试与类型**：24/24 通过；backend `tsc --noEmit` exit 0。

## 9. 覆盖率清单

**审了**：registry 全部 14 文件（controller / service / silence / delivery-rule / registry / dto / schema / README / tests / manifest / module），backend 装配面与 `prisma/models`，host url-check、heartbeat、project-notification-push、permission-groups，frontend silence-card、use-open-notification、safe-path、i18n、api 残留，ADR-062/063/064、迁移、findings 台账。

**没审**：前端其它 app 页面与 panorama 域；ClickHouse 与其它模块；push adapter / mail / chat 具体实现；job-scheduler；模板渲染细节；运行中的数据库实际数据（未查库）；CI workflow 定义（module scope 外）。

## 10. 修复优先级

1. R41-03（审计完整性，改动集中在 silence service）
2. R41-02（窗口不变量 + 空转提示）
3. R41-01（并发兜底，与 R39-10 同法）
4. R41-05 / R41-06（文档漂移，一次提交）
5. R41-04（契约决策：暴露字段或声明限制）
6. R41-07 / R41-08（输入上界、迁移守卫）
7. R39-11 / R39-12（既有挂账）

## 11. 台账指针

- registry：`newbie-modules/.trae/documents/findings.md` → round41 段（R41-01..R41-08）。
- 跨轮：R39-11、R39-12 保持 open；R40-03/04 withdrawn。
