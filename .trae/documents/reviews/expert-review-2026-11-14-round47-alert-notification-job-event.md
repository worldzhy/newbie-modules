# Expert Review — round47：notification-center / alert-center / job-scheduler / event-emitter 关系盘点

评审时间：2026-11-14 14:26–15:10 CST（Asia/Shanghai）
scope：`modules: [notification-center, alert-center, job-scheduler, event-emitter]`（真源 newbie-modules，消费仓 nightwatch-backend）

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 备注 |
| --- | --- | --- | --- | --- |
| newbie-modules | dev | `100b13a` | 1 个脏文件：`.trae/documents/findings.md`（本轮台账追加目标） | 被审模块目录无脏改动 |
| nightwatch-backend | dev | `6f91e0f` | 4 个未跟踪项：round44 / round46 评审报告、`prisma/migrations/20261114060418_web_origin_assets/`、`solidcore-admin-report-2026-11-13.pdf` | 被审源码无脏改动；`prisma/seeds/permission-groups.ts` 已提交 |

装配一致性（executed）：

```
$ for m in alert-center notification-center job-scheduler event-emitter; do
    diff -rq newbie-modules/packages/modules/$m nightwatch-backend/src/modules/$m; done
alert-center: identical
notification-center: identical
job-scheduler: identical
event-emitter: identical
```

## 2. 范围与方法

- 关系盘点对象：四个模块的 `newbie.module.json` requires 图、事件常量与监听方、端口注入（`ALERT_NOTIFICATION_PORT` / `NOTIFICATION_PUSH_PORT` / `NOTIFICATION_VISIBILITY_PORT`）、宿主 producer（url-check / heartbeat / frontend-monitor / backend-monitor / security-evaluation / intel / job-scheduler）、权限 seed。
- 方法：静态深读 + 真实单测 + 两条运行时探针（raise 重入分支、提醒投递失败分支）+ 量化计数 + 独立反驳轮（针对唯一一条 P1 候选）。
- 执行证据（本轮重跑，anchors 同上）：

```
$ docker exec -w /home/worldzhy/src/nightwatch-backend 66b958b39256 node --import tsx --test \
    src/modules/alert-center/alert-center.service.test.ts \
    src/modules/alert-center/alert-center.controller.test.ts \
    src/modules/notification-center/notification-center.service.test.ts \
    src/modules/event-emitter/event-emitter.service.test.ts \
    src/application/alerts/alert-notification.adapter.test.ts \
    src/application/notifications/job-scheduler/job-failure-notifications.service.test.ts
ℹ tests 59 / pass 59 / fail 0
```

- 量化计数（executed）：

```
$ grep -rhoE 'cronExpr = "[^"]+"' src/application | sort | uniq -c
   3 "* * * * *"           1 "*/5 * * * *"        1 "0 * * * *"
   2 "0 */1 * * * *"       1 "0 */2 * * * *"      1 "0 */5 * * * *"
   1 "0 0 0 * * *"         1 "0 0 4 * * *"        1 "0 3 * * *"
   1 "0 9 * * 1"           1 "5 9 * * *"
$ grep -rlE 'extends ScheduledJob' src/application | wc -l
14
```

折算：3×1440 + 2×1440 + 288 + 24 + 720 + 288 + 4 ≈ **8,524 次运行/天**（≈8,524 条 `JobRun`/天、≈8,524 次 `EventEmission` insert、≈8,524 次 job 成功侧的 `listFiringAlerts` 扫描/天）。

- 失败/重跑：无（本轮命令均一次通过）。

## 3. 结论摘要

**0 个 P0，0 个 P1，11 个 P2。** 四个模块的骨架关系是健康的：依赖图无环，alert-center 对 notification-center 只经 port、无编译依赖，事件监听器失败不会反向改写 JobRun 结果，装配产物与真源逐字节一致。缺陷集中在**四层协作的缝**上，按主题分六组：

1. 恢复面靠「全源扫描 + 500 上限」而不是身份直查（R47-01）。
2. 提醒先抢占后投递，投递失败被吞，提醒被消耗（R47-02）。
3. job 运行观测有洞：卡死静默、历史无保留期（R47-03 / R47-04）。
4. 事件审计面全量落 payload 且成员可读（R47-05）。
5. 契约漂移：severity 词表跨域耦合、宿主丢字段、宿主直读模块表（R47-06 / 07 / 08）。
6. 开关与调度治理：系统级推送默认关闭且与项目轨语义相反、提醒调度可被运行期关停、提醒每条生成一条新记录（R47-09 / 10 / 11）。

维度评分：架构 6/10（跨层直读、恢复面反模式）｜契约 5/10（死字段、词表漂移、注释与实现相反）｜可靠性 6/10（提醒可丢、卡死无告警）｜可观测 7/10（EventEmission 很完整，但保留期和敏感面失衡）｜治理 6/10（核心调度无保护）｜测试 8/10（59 测全绿，但缺跨层失败路径）。

## 4. P0

无。

## 5. P1

无。

初判 P1 候选 1 条（`raise()` 重入分支未写 `lastSeenAt`，前端展示疑似不前进），反驳轮被推翻：`Alert.lastSeenAt DateTime @updatedAt`（`alert-center/prisma/schema.prisma:45`），Prisma 在每次 update 自动写该列。详见 §7。

## 6. P2（按主题）

### 主题 A — 恢复面：全源扫描 + 上限，而非按身份直查

#### R47-01 `resolve` 必须在告警存在时才能定位，producer 被迫全源扫描；超过 500 条后最新告警永不恢复

- 证据链：
  1. [alert-center.service.ts:236-243](file:///Users/worldzhy/src/newbie-modules/packages/modules/alert-center/alert-center.service.ts#L236-L243)：`resolve()` 用 `fingerprint = scopeId:source:alertKey` 直查；未命中只 `logger.warn` 并返回 null。`scopeId` 对 system 级告警是 `undefined`，producer 事后无从得知某条 firing 行的 scope。
  2. [alert-center.service.ts:332-345](file:///Users/worldzhy/src/newbie-modules/packages/modules/alert-center/alert-center.service.ts#L332-L345)：`listFiringAlerts` 只接受 `source`，`orderBy createdAt asc`、`take` 上限 [500](file:///Users/worldzhy/src/newbie-modules/packages/modules/alert-center/alert-center.service.ts#L30)。上限语义是「最早 500 条」，不是「本次要恢复的那条」。
  3. [job-failure-notifications.service.ts:63-78](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/job-scheduler/job-failure-notifications.service.ts#L63-L78)：每次成功运行都扫全源，再按 `labels.notificationKey` / `labels.scheduleKey` 在内存里过滤。
- 后果：
  - 性能：≈8,524 次成功/天 → 每天 8,524 次、每次最多 500 行的扫描；单次成本小，但这是「每个成功事件做一次全量对账」的反模式，且随 source 的 firing 数线性增长。
  - 正确性（latent）：某 source 的 firing 行超过 500 时，`createdAt asc` 只返回最老的 500 条，最新的告警永远不在返回集里 → 永不 `resolve` → 提醒按 `repeatIntervalMinutes` 无限重复，直到人工处理。`job-scheduler` 源受 schedule 数限制（当前 14），但 `security-evaluation` 源按「评估 × 项目」增长（[security-evaluation-notifications.service.ts:191](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/security-evaluation/security-evaluation-notifications.service.ts#L191) 同一反模式），超过 500 是可达的。
  - 事实冗余：job 源是专用 source（[alert-source.constants.ts:17](file:///Users/worldzhy/src/nightwatch-backend/src/application/alerts/alert-source.constants.ts#L17)），且 `alertKey === event.scheduleKey` 已知，扫描本可省略。
- 暴露面：live（性能）/ latent（上限）。可达性：自动路径，无需角色。
- 修复方向：给 `resolve` 增加「按 `(source, alertKey)` 定位、scope 可选」的分支；或给 `listFiringAlerts` 增加 `alertKey` 过滤。producer 在已知 key 时不应先全扫。

### 主题 B — 提醒交付：先抢占、后投递、失败被吞

#### R47-02 投递失败时提醒已被 claim 消耗，`dispatched` 仍计数

- 证据链：
  1. [alert-center.service.ts:297-307](file:///Users/worldzhy/src/newbie-modules/packages/modules/alert-center/alert-center.service.ts#L297-L307)：条件 `updateMany` 先写 `lastNotificationAt=now`、`nextNotificationAt=now+interval`、`reminderCount+1`。
  2. [alert-center.service.ts:308-317](file:///Users/worldzhy/src/newbie-modules/packages/modules/alert-center/alert-center.service.ts#L308-L317)：随后 `deliver(...)`，并 `dispatched += 1`。
  3. [alert-center.service.ts:471-487](file:///Users/worldzhy/src/newbie-modules/packages/modules/alert-center/alert-center.service.ts#L471-L487)：`deliver` 内部 `try/catch`，adapter 抛错只 `logger.error`，不向上抛。
- 后果：一次提醒在投递失败（chat 限流、模板缺失、severity 非法等）时被静默消耗：`reminderCount` 已加、下一次提醒推迟一个周期、`dispatchDueReminders()` 返回的 `dispatched` 却把失败算作成功。宿主 [alert.dispatch-reminders.job.ts](file:///Users/worldzhy/src/nightwatch-backend/src/application/scheduled-jobs/tasks/alert.dispatch-reminders.job.ts) 只在 `dispatched > 0` 时打日志，失败完全不可见。
- 执行证据：本轮探针让 port 的 `notify` 抛错，观察到返回 `{ dispatched: 1 }`，且该行 `nextNotificationAt` 已前移、`reminderCount` 已 +1。
- 暴露面：live。可达性：任意投递失败。
- 修复方向：把 claim 与投递做成可回滚语义（失败时回写 `nextNotificationAt` 为 now，或至少计数用「成功数」单独返回）；`deliver` 返回 boolean，循环只对成功计数。

### 主题 C — job 运行观测：卡死静默、历史无界

#### R47-03 重入守卫的 `skipped` 不产生事件/告警，handler 卡死时静默

- 证据：[job-scheduler.service.ts:281-294](file:///Users/worldzhy/src/newbie-modules/packages/modules/job-scheduler/scheduler/job-scheduler.service.ts#L281-L294) 只写一条 `status="skipped"` 的 JobRun 并 return；该路径不 emit 任何事件，`job-scheduler.events.ts` 也只有 `JOB_RUN_FAILED_EVENT` / `JOB_RUN_SUCCEEDED_EVENT`。全仓无 stale `running` 行的 reconcile（`grep` 仅见 `jobRun.create/update`，无按 `startedAt` 超时的修复）。
- 后果：某 handler 永久挂起（await 不返回）后，`runningScheduleKeys` 永不释放，之后每次触发都写一行 skipped；`JobRun` 里只有「skipped」而没有「卡死中的 running」，告警链（失败事件）永远不触发。运维只能靠翻 job-scheduler 页面的 skipped 计数发现。
- 暴露面：live。可达性：handler 挂起 / 进程级半死。
- 修复方向：连续 skipped 或 `running` 超时超过阈值时 emit 一个失败/卡死事件；或由 job-scheduler 自身在 reconcile 时把超时 running 标 failed。

#### R47-04 `JobRun` 无保留期，与 `EventEmission` 的 30 天清理不一致

- 证据：[job-scheduler/prisma/schema.prisma](file:///Users/worldzhy/src/newbie-modules/packages/modules/job-scheduler/prisma/schema.prisma) 的 `JobRun` 无任何清理字段/任务；在 `src/modules` + `src/application` 内 `grep 'deleteMany'` 命中的只有 [event-emitter.service.ts:132](file:///Users/worldzhy/src/newbie-modules/packages/modules/event-emitter/event-emitter.service.ts#L132)（`eventEmission`）。`notificationRecord` / `notificationDeliveryAttempt` 同样没有任何 `deleteMany`。
- 后果：按 §2 的 8,524 次/天，`JobRun` ≈ 311 万行/年且持续增长；`NotificationRecord`（含 R47-11 的每条提醒一条）同样只增不减。event-emitter 设了 `EVENT_EMISSION_RETENTION_DAYS=30`（[newbie.module.json:17-21](file:///Users/worldzhy/src/newbie-modules/packages/modules/event-emitter/newbie.module.json#L17-L21)）而另外两表无保留策略，同一条「运行 → 事件 → 通知」链上的三个审计表寿命不同。
- 暴露面：live。可达性：随运行时间线性。
- 修复方向：为 `JobRun` / `NotificationRecord` / 投递尝试表补保留期（可复用 event-emitter 的摊还清理模式），并在 README 写明默认值。

### 主题 D — 事件审计面：全量 payload 与成员可读

#### R47-05 `EventEmission` 全量保存 payload、无脱敏/大小上限，且 MEMBER 可读

- 证据：
  1. [event-emitter.service.ts:125-145](file:///Users/worldzhy/src/newbie-modules/packages/modules/event-emitter/event-emitter.service.ts#L125-L145)：`onAny` 每次 emit 都落 `payload`（`toJsonPayload` 只做 JSON 往返，无字段裁剪、无长度上限）。
  2. [event-emitter.controller.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/event-emitter/event-emitter.controller.ts)：`GET events` / `GET emissions` 只要求 `PermissionAction.List`，但 Group 缺省授予全部动词（[permission-groups.ts:229-236](file:///Users/worldzhy/src/nightwatch-backend/prisma/seeds/permission-groups.ts#L229-L236)），MEMBER 被绑定到除 `All/IAM/JDY/Overview` 以外的全部组（[permission-groups.ts:457-459](file:///Users/worldzhy/src/nightwatch-backend/prisma/seeds/permission-groups.ts#L457-L459)）。
- 后果：job 失败的 `error` 文本（含堆栈片段、可能含连接串/路径）、url-check 的目标 URL、evaluation 的上下文等，会对任意 MEMBER 可见并保留 30 天（默认示例）。payload 体积无界还会放大 DB 与列表接口。
- 暴露面：live（读面）。可达性：任意 MEMBER。
- 修复方向：明确 EventEmission 的读权限组最小集（或加 `excludeResources`）；录入侧做 payload 上限与敏感字段策略（至少截断长字符串），README 写明保留期与敏感性。

### 主题 E — 契约漂移：词表、死字段、边界穿透

#### R47-06 notification severity 词表跨域依赖 evaluation，宿主无校验 cast，漂移即静默丢通知

- 证据链：
  1. [notification-center.constants.ts:1-8](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.constants.ts#L1-L8)：`NotificationSeverity` 由 `@modules/evaluation/ports/evaluation.contracts` 派生，`SEVERITIES` 由 `EVALUATION_SEVERITIES` map 得来。notification-center 的 manifest 因此 `requires` evaluation。
  2. [alert-center.constants.ts:9](file:///Users/worldzhy/src/newbie-modules/packages/modules/alert-center/alert-center.constants.ts#L9)：alert 域另立同构 union `ALERT_SEVERITIES`，两套词表各自演化。
  3. [alert-notification.adapter.ts:60](file:///Users/worldzhy/src/nightwatch-backend/src/application/alerts/alert-notification.adapter.ts#L60)：`severity: event.severity as NotificationSeverity`——无运行时校验的 cast。
  4. [notification-center.service.ts:211-213](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.service.ts#L211-L213)：非法 severity 抛 `BadRequestException`；[alert-center.service.ts:485-487](file:///Users/worldzhy/src/newbie-modules/packages/modules/alert-center/alert-center.service.ts#L485-L487) 将其吞成一条 error 日志。
- 后果：任意一侧新增/改名 severity（例如 evaluation 去掉 `info` 或新增 `unknown`），编译期不会报错（cast），运行期在 alert→notification 的路径上整条通知丢失，且只在日志里留痕。
- 暴露面：artifact（漂移前不可达）。可达性：词表演化时。
- 修复方向：在 adapter 边界做 `isNotificationSeverity()` 运行时校验并显式映射（未知 → `info` 或拒绝并上报），或让 notification-center 自持一份稳定词表、evaluation 依赖它而不是反向。

#### R47-07 `job.run-failed` 的 `severity` / `deduplicationKey` 是死契约，注释与 ADR-067 语义相反

- 证据：
  1. [job-run-failed.notification.ts:48-50](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/job-scheduler/job-run-failed.notification.ts#L48-L50)：`buildPayload` 返回 `severity: "high"` 与 `deduplicationKey: job:run-failed:${runId}`，注释称「One failed run is one alert, even if the event is redelivered」。
  2. [job-failure-notifications.service.ts:42-55](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/job-scheduler/job-failure-notifications.service.ts#L42-L55)：只取 `payload.context`，`severity` 硬编码 `"high"`，`deduplicationKey` 从未传入。
  3. ADR-067 语义（同文件 :15-23 注释）：一个 schedule 一条生命周期，失败 raise/推进、成功 resolve——与「一次失败运行一条告警」相反。
- 后果：读代码的人会以为失败运行有幂等去重；实际去重发生在 alert 生命周期层。若将来有人把 `deduplicationKey` 接上，语义会与 ADR-067 直接冲突。
- 暴露面：source（认知/维护）。可达性：维护期。
- 修复方向：删掉两个死字段（或接上并改正注释），`severity` 改由调用方显式传入而非在 service 里硬编码。

#### R47-08 宿主直读 job-scheduler 模块表取 schedule name

- 证据：[job-failure-notifications.service.ts:38-41](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/job-scheduler/job-failure-notifications.service.ts#L38-L41)：`this.prisma.jobSchedule.findUnique(...)`；同文件 :20-23 注释承认「The friendly schedule display name is resolved here (send-side attribution rule)」。
- 后果：与 R44-11 同类边界问题——模块表结构变更会直接打到宿主 application 层。当前是有意选择（事件不带 name），但该选择把模块内部表变成了宿主契约。
- 暴露面：source。可达性：模块 schema 演化时。
- 修复方向：让 `JobRunFailedEvent` 携带 `scheduleName`（scheduler 已有该字段），或由 job-scheduler 暴露只读查询端口；二选一写进 ADR-067。

### 主题 F — 开关与调度治理

#### R47-09 系统级推送默认关闭且与项目轨语义相反，新装环境 job 失败不进任何 chat

- 证据链：
  1. [notification-center.constants.ts:17](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.constants.ts#L17)：`DEFAULT_PUSH_ENABLED = false`；[notification-center.service.ts:481-494](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.service.ts#L481-L494) 首次投递时以该默认值创建单例，`grep notificationCenterSetting` 在 seeds 中零命中。
  2. [notification-center.service.ts:367-369](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.service.ts#L367-L369)：`!centerPushEnabled → "channel-off"` 对**所有 scope** 生效，系统级推送因此被总开关拦住。
  3. [project-notification-push.service.ts:26-33](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/project-notification-push.service.ts#L26-L33)：项目轨「The center push master switch does NOT gate this track; binding a chat is the explicit subscription」。
  4. [job-run-failed.notification.ts:24,32](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/job-scheduler/job-run-failed.notification.ts#L24-L32)：`scope = "system"`、`defaultPushEnabled = true`。
- 后果：新装部署上，项目级告警只要绑了 chat 就能推；系统级 job 失败告警默认 `channel-off`，唯一痕迹是 `NotificationRecord.runtimeReason`。声明里的 `defaultPushEnabled=true` 给人一种「默认会推」的错觉。
- 暴露面：live（新装/未改动环境）。可达性：无需角色，首次部署即成立。
- 修复方向：区分「系统推送总开关」的默认值（或首次创建时若已配置系统 chat 绑定则置 true）；在 README/ADR-065 明确两轨语义；UI 上对 `channel-off` 的告警给出显式提示。

#### R47-10 提醒依赖一条运行期可改的普通 schedule，无保护、无看门狗

- 证据：[alert.dispatch-reminders.job.ts](file:///Users/worldzhy/src/nightwatch-backend/src/application/scheduled-jobs/tasks/alert.dispatch-reminders.job.ts) 是普通 `ScheduledJob`（`key="alert.dispatch-reminders"`、`cronExpr="* * * * *"`）；job-scheduler schema 明确「the database row wins at runtime so operators can pause a schedule, change its cron expression」；job-scheduler controller 暴露 Update，MEMBER 组对该 namespace 有全部动词（§R47-05 同一 seed 事实）。
- 后果：任一具备 Job Scheduler Update 的用户把该行 `isEnabled=false` 或改成低频 cron，所有 alert 提醒静默停止/延迟，且没有任何健康信号（只有 `/alert-center` 的 `nextNotificationAt` 越堆越早）。
- 暴露面：live。可达性：MEMBER 改调度。
- 修复方向：把核心提醒调度标为不可通过运营面禁用（core schedule），或加一条「提醒调度最近一次成功运行时间」的看门狗告警。

#### R47-11 每条提醒生成一条新 in-app 记录，与「一次生命周期一条」注释矛盾

- 证据：[alert-notification.adapter.ts:63-68](file:///Users/worldzhy/src/nightwatch-backend/src/application/alerts/alert-notification.adapter.ts#L63-L68)：注释「One record per lifecycle transition」但 key 含 `${event.reminderCount}`，每次提醒都是新 key → notification-center 每次新建 `NotificationRecord`。
- 后果：`repeatIntervalMinutes` 默认 60（[alert-center/prisma/schema.prisma:33](file:///Users/worldzhy/src/newbie-modules/packages/modules/alert-center/prisma/schema.prisma#L33)），一条长期 firing 的告警每天新增 24 条未读 in-app 记录，收件箱被同一条故障刷屏；与 R47-04 叠加放大表体积。
- 暴露面：live。可达性：任意长时间 firing。
- 修复方向：提醒不落新记录（只推送），或在 `NotificationRecord` 上做「同生命周期 upsert + 未读合并」；注释与实现必须一致。

## 7. 误报剔除

| 候选 | 初判 | 推翻依据 | 结论 |
| --- | --- | --- | --- |
| `raise()` 重入分支不更新 `lastSeenAt`，`/alert-center` 的「最后出现」不前进 | P1（executed 探针显示 update data 仅 `scopeId/labels/data/occurrences`） | [alert-center/prisma/schema.prisma:45](file:///Users/worldzhy/src/newbie-modules/packages/modules/alert-center/prisma/schema.prisma#L45)：`lastSeenAt DateTime @updatedAt`。Prisma 对每次 `update` 自动写该列，与 data 是否显式包含无关 | 撤销，不登记 |
| `evaluation.run-failed` 事件无监听方 | 潜在 P2 | `grep` 显示 `security-evaluation-notifications.service.ts` 用 `this.events.on(...)` 订阅 | 撤销，不登记 |

## 8. 已核验通过的不变量

- 依赖图无环：`job-scheduler → event-emitter`、`alert-center / notification-center / event-emitter → security`、`notification-center → evaluation`，无反向边；alert-center 对 notification-center **无编译依赖**（只经 `ALERT_NOTIFICATION_PORT`）。
- 事件监听器隔离：`JOB_RUN_SUCCEEDED_EVENT` 在 JobRun 落库后 emit，listener 抛错被 [job-scheduler.service.ts:332-336](file:///Users/worldzhy/src/newbie-modules/packages/modules/job-scheduler/scheduler/job-scheduler.service.ts#L332-L336) 捕获，不会把成功改写成失败（有测试）。
- 提醒并发安全：`updateMany` 条件抢占（`state=firing` + `nextNotificationAt <= now`）保证两个扫描不重复投递同一条提醒（单测覆盖）。
- 暂停语义：暂停只拦外部投递，不拦记录与 resolve（`isNotificationPaused` + `dispatchDueReminders` 的暂停源预过滤）。
- alert 身份唯一性：`fingerprint @unique` 由数据库仲裁并发首报（P2002 兜底）。
- 生命周期维度去重：adapter 的 `deduplicationKey` 含 `lifecycleStartedAt`，R44-01 的 reopen 吞通知已修复。
- `listFiringAlerts` 投影有界：只返回 `id/scopeId/labels`，`take` 硬上限 500（R44-11 已修）。
- 装配一致性：四模块 `diff -rq` 零差异；单测 59/59 通过（§2）。

## 9. 覆盖率清单

| 类别 | 覆盖对象 |
| --- | --- |
| 模块源码 | `alert-center.{service,controller,dto,constants,module}`、`alert-source-registry.service`、`README`、schema；`notification-center.{service,constants}`（含 `notify` / `resolveRuntime` / `getOrCreateCenterSetting`）；`job-scheduler/scheduler/job-scheduler.service`、events、schema；`event-emitter.{service,controller}`、manifest、schema |
| 宿主接线 | `alerts/alert-notification.adapter`、`alerts/alert-source.{constants,registrar}`、`notifications/project-notification-push.service`、`notifications/notification-push.module`、`notifications/lark-notification-push.adapter`、`notifications/job-scheduler/{job-failure-notifications.service,job-run-failed.notification}`、`scheduled-jobs/tasks/alert.dispatch-reminders.job` |
| 横向 | `newbie-modules.json`（四 key 装配 + sourceCommit）、`prisma/seeds/permission-groups.ts`、14 个 `*.job.ts` 的 cron 分布、`event-declarations` |
| 未覆盖（说明） | 真实 Lark 发送（仅读 adapter 与测试替身）、生产库数据分布（仅按代码路径推算量级）、前端 `/alert-center` 与 `/notifications` 渲染细节（R44 已覆盖，本轮不重复） |

## 10. 修复优先级（均为 P2，按行为影响排序）

1. R47-02（提醒可能在失败时丢失，且计数误导）→ R47-01（恢复面反模式，latent 永不恢复）。
2. R47-09（新装环境系统级告警不进 chat，与声明语义相反）。
3. R47-11（提醒刷屏）/ R47-05（审计面成员可读）。
4. R47-03（卡死静默）/ R47-04（三表保留期不一致）。
5. R47-06 / 07 / 08（契约与边界债）/ R47-10（核心调度治理）。

## 11. 台账指针

- 模块侧：`newbie-modules/.trae/documents/findings.md` → `round47` 小节（R47-01..06）。
- 宿主侧：`nightwatch-backend/.trae/documents/findings.md` → `round47` 小节（R47-07..11）。
- 本轮为只读评审，未修改任何代码；修复另起会话。
