# Expert review round48 — 本会话改动（round47 修复批次）

评审对象：2026-11-14 本会话全部改动。scope = `plan`（本会话改动批次），按 §0.1 plan scope 处理：把改动拆成可核验主张，逐条判定并按 §7 出报告。

## 1. 锚点

| 仓                          | branch | HEAD      | 工作树                                                                        | 时间（+08:00）      |
| --------------------------- | ------ | --------- | ----------------------------------------------------------------------------- | ------------------- |
| newbie-modules（模块真源）  | dev    | `ec91dc6` | 0 dirty                                                                       | 2026-11-14 16:53 起 |
| nightwatch-backend（消费仓） | dev    | `4942942` | 3 untracked：`reviews/expert-review-...-round44/round46*.md`、`solidcore-admin-report-2026-11-13.pdf`（均非本会话产物） | 同上                |

远端核对（`git ls-remote origin refs/heads/dev`）：两仓远端 branch 头 = 上表 HEAD。

被审提交：registry `94f8d6b` / `b0a068e` / `46624cf` / `ec91dc6`；consumer `f97f92e` / `6e1c419` / `4942942`。
并行会话：无（评审开始前两仓工作树仅含上述 untracked 文档）。

**偏差披露（§10 第 7 条）**：本会话既是修复会话又是评审会话。为补偿，本报告所有关键结论升级为 `executed`（实际执行 build / 全量单测 / lint / `apply --check` / `diff -rq` / 探针），`static` 结论不用于定级。唯一例外是生产 `.env`（不可达），按要求标 `static + 未验证`。

## 2. 范围与方法

主张清单与取证映射：

| #   | 主张（提交信息/台账声明）                                        | 依赖路径 / 取证命令                                                            | 判定                     |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------ |
| C1  | alert-center 按精确 fingerprint 收窄 firing 查询                  | `alert-center.service.ts:354-380`；`alert-center.service.test.ts:381+`         | 成立                     |
| C2  | 投递失败不消耗提醒、不计入 dispatched                             | `alert-center.service.ts:317-330,496-525`；单测                             | 成立                     |
| C3  | job-scheduler 回收卡死 run 并通过既有 run-failed 事件告警         | `job-scheduler.service.ts:101-129,334-358,449-496`；单测                     | 成立（覆盖有缺口，见 R48-01） |
| C4  | JobRun 保留期 90 天、写路径摊还                                   | `job-scheduler.service.ts:501-516`                                            | 成立（索引缺失，见 R48-02；无回归测试，见 R48-04） |
| C5  | notification-center 自持 severity 词表、记录保留期                | `notification-center.constants.ts:1-20`；`notification-center.service.ts:55-64,201-207,542-566` | 成立                     |
| C6  | event-emitter 限制 payload 体积                                   | `event-emitter.service.ts:11-17,154-180`；单测                                 | 成立                     |
| C7  | 三处保留期默认统一 90 天                                          | `.env.example` 三键 = 90；manifest env example = 90                            | 局部成立（生产 env 未改，见 R48-03） |
| C8  | R47-12：回收移出 `onApplicationBootstrap`，首个 tick 执行         | `job-scheduler.service.ts:101-129`；ADR-067:108-117                            | 成立                     |
| C9  | 宿主改为按 key 收窄、severity 前置校验                            | `job-failure-notifications.service.ts:66-72`；`alert-notification.adapter.ts:59-65` | 成立                     |
| C10 | 新增提醒调度看门狗                                                | `alert.watch-reminder-dispatch.job.ts:1-95` + 4 条单测                        | 成立                     |
| C11 | 两仓装配零差异、门禁全绿                                          | 见 §8 命令输出                                                                 | 成立                     |

执行环境：容器 `devbie-work`（`/home/worldzhy/src` 卷），宿主无 node。执行命令与输出摘要：

- `diff -rq` 四模块 registry vs 消费仓 → 无输出（零差异）。
- `NEWBIE_MODULES_PATH=... npx newbie modules apply --check` → `✓ Module copies, sources and generated wiring match newbie-modules.json.`
- `npm run build`（consumer）→ 通过。
- `npm test`（consumer）→ `tests 1386 / pass 1386 / fail 0`（42.7s）。
- `npm run format:check`（consumer 与 registry）→ 均 All matched files use Prettier code style。
- `eslint`（两仓受影响文件）→ 无输出。
- `npx @devbie/newbie-cli@1.20.0 modules lint`（registry CI 同款）→ `0 error(s), 27 warning(s)`（均为既有 allowlist 同类层依赖告警）。
- 临时探针（`tmp-probe-stuck.test.ts`，执行后已删除，工作树恢复锚点）：复现 R48-01。

## 3. 结论摘要

P0：无。P1：无。P2：4 条（1 条为已执行探针证实的行为缺口，2 条静态健壮性/覆盖，1 条部署前置）。

维度评分：

| 维度 | 评分 | 依据                                                                 |
| ---- | ---- | -------------------------------------------------------------------- |
| 安全 | A-   | 无新增攻击面；severity 前置校验与 payload 上限都是收敛方向           |
| 架构 | B    | 模块归属正确（看门狗在宿主、词表自持、requires 去掉 evaluation）；卡死回收的覆盖语义与 ADR 表述不一致（R48-01） |
| 契约 | B+   | manifest env 声明齐全、`apply --check` 绿、ADR/README 同步；生产 env 前置未闭环（R48-03） |
| 测试 | B    | 全量 1386 绿；新增 5 组行为测试；JobRun 保留期与迟到完成路径无回归测试（R48-04） |
| 门禁 | A    | build / 单测 / 两仓 format / registry lint / modules lint 全绿        |
| 治理 | A-   | 台账、ADR、findings 均同步；R47-05 保留读权限有明确决策记录           |

## 4. P0

无。

## 5. P1

无。

## 6. P2

### R48-01 重启时低于阈值的孤儿 `running` 行在本生命周期内悬挂（已执行探针证实）

- 仓：newbie-modules（`job-scheduler`）
- 证据：[job-scheduler.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/job-scheduler/scheduler/job-scheduler.service.ts#L101-L129) 的回收是**一次性**的（`startupRecoveryDone` 守卫），且只处理 `startedAt < now - 阈值` 的行；而 [job-scheduler.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/job-scheduler/scheduler/job-scheduler.service.ts#L334-L358) 中 `failStuckRuns(schedule.id)` 只在**同进程**重入守卫命中时调用，重启后 `runningScheduleKeys` 为空，后续触发不会进入该分支。
- 复现（executed，容器内 `node --import tsx --test`，探针已删除）：
  1. 造一行 `running`、`startedAt = now-5min`；调用 `recoverStuckRunsOnce()` → 仍是 `running`（低于阈值）。
  2. 将该行 `startedAt` 改为 `now-45min`（模拟时间流逝）；`triggerSchedule("demo")` → 孤儿仍 `running`，且无 failed 事件。
  3. 再次调用 `recoverStuckRunsOnce()` → 守卫已置位，直接 return；孤儿仍 `running`。
- 影响：部署/重启发生在长任务执行中（最常见的重启场景）时，该 run 在**本次进程生命周期内**不计失败、不发告警；恢复途径只有下一次进程重启（届时它已超阈值，会被扫到），否则 90 天后被 [pruneExpiredRuns](file:///Users/worldzhy/src/newbie-modules/packages/modules/job-scheduler/scheduler/job-scheduler.service.ts#L501-L516) 静默删除。**不是永久不可见，但会跨越整个部署周期**。
- 文档口径偏差：ADR-067:108-110 称"上次进程崩溃留下的 running 行在本次生命周期内被标为 failed"，README 第 7 条称 "once at boot for rows a previous process left behind"——两者都只对"首个 tick 时已超阈值"的行成立；ADR 末句"避免它们永久悬挂"仍成立（下一次重启会兜住）。
- 可达性：任意进程重启（自动路径）；暴露面：live；严重度依据：真实行为缺口但需重启时机与阈值窗口重叠，非越权/数据破坏 → P2。
- 修复方向：把 `failStuckRuns()` 放到每个 reconcile tick（有界 100 行、条件更新幂等，成本可控），或保留一次性守卫但为首个 tick 时低于阈值的孤儿安排"越过阈值时刻"的二次扫描。

### R48-02 `JobRun` 保留期清理缺 `startedAt` 索引

- 仓：newbie-modules（`job-scheduler`）
- 证据：[job-scheduler.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/job-scheduler/scheduler/job-scheduler.service.ts#L501-L516) 的 `deleteMany({ where: { startedAt: { lt: cutoff } } })`；[schema.prisma](file:///Users/worldzhy/src/newbie-modules/packages/modules/job-scheduler/prisma/schema.prisma#L48) 只有 `@@index([scheduleId, startedAt])`，非前导列的 range 条件无法做索引范围扫描。
- 影响：按 R47-04 台账记录的 ≈8,524 行/天（本轮未复算）与 90 天保留期推算峰值约 76 万行；每小时一次全表（或全索引）扫描。量化影响未探针（`static`），按 §4 只能定 P2。
- 修复方向：补 `@@index([startedAt])`（属 schema 变更，需迁移与消费仓同步，不能在本评审会话内做）。

### R48-03 三个必填 env 的生产侧前置未闭环，且"统一 90 天"表述对既有部署不成立

- 仓：nightwatch-backend（ops）/ newbie-modules（文档口径）
- 证据：`JobSchedulerService` 与 `NotificationCenterService` 构造函数对 [STUCK_RUN_TIMEOUT_KEY / RETENTION_DAYS_KEY](file:///Users/worldzhy/src/newbie-modules/packages/modules/job-scheduler/scheduler/job-scheduler.service.ts#L91-L98) 与 [notification retentionDays](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.service.ts#L201-L207) 使用 `getOrThrow`，无内建 fallback；本地 `.env` 已有三键（executed: grep 命中 132/157/158/181 行），生产 `.env` 不可达、未验证。
- 后果：若生产未补 `JOB_RUN_STUCK_TIMEOUT_MINUTES` / `JOB_RUN_RETENTION_DAYS` / `NOTIFICATION_RECORD_RETENTION_DAYS`，下次部署即启动失败（constructor 抛错）。另外既有部署的 `EVENT_EMISSION_RETENTION_DAYS` 仍是 30，提交信息「Retention defaults are 90 days across … event emissions」只对示例/新装成立。
- 修复方向：部署清单把三个变量列为发布前置；对既有部署显式改 30→90 或修正提交/台账措辞。
- 暴露面：活部署前；可达性：运维操作；P2。

### R48-04 本轮修复缺回归测试指针（JobRun 保留期、迟到完成路径）

- 仓：newbie-modules
- 证据：[job-scheduler.service.test.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/job-scheduler/scheduler/job-scheduler.service.test.ts#L109-L141) 共 3 条测试（`grep -c '^test('` = 3：卡死阈值内/外、重入守卫），无 `pruneExpiredRuns` 用例；ADR-067:115-117 记录的"标 failed 后 handler 又返回 → 改写 success 并闭合告警"也无用例。findings 台账 R47-04 状态列只有 `fixed`，无回归指针（§6 要求每条带回归测试指针）。
- 影响：保留期与迟到完成的语义后续可被无声改坏。本轮其余条目中 R47-01/02/05/10/11 均有对应用例；R47-06 只有合法 severity 的正向用例，非法词表降级分支无用例（`alert-notification.adapter.test.ts` 无 unknown/invalid 断言）。
- 修复方向：补 `pruneExpiredRuns`、迟到完成、非法 severity 降级三条用例并回填台账指针。

## 7. 误报剔除

- 「卡死 run 被标 failed 后 handler 又返回会被改写成 success，掩盖事故」→ 不成立：ADR-067:115-117 已明确把该路径定义为"迟到完成"，成功分支照常改写并 `run-succeeded` 闭合告警；属有意契约，不计缺陷。
- 「`listFiringAlerts` 省略 `scopeId` 导致 fingerprint 不匹配，宿主 job 成功侧永远 resolve 不掉」→ 不成立：raise 侧 [job-failure-notifications.service.ts:43-47](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/job-scheduler/job-failure-notifications.service.ts#L43-L47) 未传 scopeId，fingerprint 为 `-:job-scheduler:<key>`；查询侧同样省略 → 一致；resolve 侧用 `alert.scopeId`（null 时不传）→ 一致。单测断言了 `fingerprint.in` 取值。
- 「notification-center 去掉 `evaluation` requires 会让某处 import 断裂」→ 不成立：`grep -rn "@modules/evaluation" packages/modules/notification-center/` 无命中；`modules lint` 0 error。

## 8. 已核验通过的不变量（供下一轮判断覆盖是否退化）

1. **装配一致性**：四模块 `diff -rq` 零差异；`apply --check` 绿（`ec91dc6` / `4942942` 锚点下）。
2. **提醒回滚不复活已 resolved 生命周期**：dispatch 扫描 `state: "firing"`，回滚只改 `nextNotificationAt/reminderCount`，resolved 行不会被重新扫描（`alert-center.service.ts:271-292,317-330`）。
3. **回滚并发安全**：`updateMany` 带 `reminderCount = old+1` 守卫，与并发的 raise 不互相覆盖。
4. **缺 adapter 语义**：`deliver` 返回 true（消费提醒），避免无 adapter 时无限重试；adapter 抛错返回 false 并回滚 —— 两条路径都有注释与用例。
5. **severity 词表**：notification 自持 `info/low/medium/high/critical`（rank 0..4），与 evaluation `SEVERITY_RANK` 数值一致 → 阈值语义不变；宿主 adapter 先 `isNotificationSeverity` 再使用，漂移时降级为"仅告警"而非静默丢失（`alert-notification.adapter.ts:59-65`）。
6. **告警身份链路**：raise / resolve / listFiringAlerts 三处共用 `buildAlertFingerprint`（`scopeId ?? "-"`），长 key 走 hash 分支一致（`alert-center.constants.ts:48-55`）。
7. **保留期删除的级联面**：`NotificationReceipt` / `NotificationPushFailure` 为 `onDelete: Cascade`；`NotificationDeliveryAttempt` 无外键、显式删除（`notification-center/prisma/schema.prisma:89-117`）。
8. **启动回收不产生未处理拒绝**：`recoverStuckRunsOnce` 内部 try/catch；`void` 调用安全，失败时守卫保持 false → 下个 tick 重试。
9. **R47-12 根因消除**：回收不再在 bootstrap 钩子中 emit；首个 tick 晚于 `EventSubscribersLoader` 的 `@OnEvent` 挂载与下游声明。本会话未重跑运行时重启冒烟（原始 executed 证据在 findings 台账中，时间线 08:35:37–08:37:00）。
10. **事件 payload 上限**：超长字符串先截断，超预算整体降级为 `{truncated, preview}`，不可序列化降级为 marker；三条分支均有用例。
11. **门禁**：consumer `build` / `test 1386` / `format:check` / eslint；registry `format:check` / eslint / `modules lint` 全绿。
12. **推送落地**：两仓远端 `refs/heads/dev` = 本地 HEAD。

## 9. 覆盖率清单

- 审了：`job-scheduler`、`alert-center`、`notification-center`、`event-emitter` 四模块的全部本轮 diff；宿主 `alert-notification.adapter.ts`、`job-failure-notifications.service.ts`、`job-run-failed.notification.ts`、`alert.watch-reminder-dispatch.job.ts` + 测试、`alert.dispatch-reminders.job.ts`、`scheduled-jobs.module.ts`、`modules.config.ts`、`newbie-modules.json`、`.env.example`/`.env` 三键、两仓 findings、ADR-067、两份 README、四模块 manifest。
- 未审（明确排除）：`src/application` 其余模块、security-evaluation 本会话外的在途改动（`3aca5cc`/`608cc94` 属并行会话，按锚点原样推送、未审）、迁移目录、`node_modules`/生成物、前端仓、`nightwatch-world`。
- 未执行：生产环境 `.env` 读取、生产重启后的运行时冒烟（不可达）；`JobRun` 全表扫描的实测耗时（仅静态推断）。

## 10. 修复优先级

1. R48-03（发布前置，缺失即启动失败）—— 部署前必须闭环。
2. R48-01（行为缺口，重启场景可复现；修复成本低：把 sweep 放到每 tick）。
3. R48-04（回归测试 + 台账指针，防止后续退化）。
4. R48-02（schema 索引，随下一次迁移一并处理）。

## 11. 台账指针

- newbie-modules `.trae/documents/findings.md`：R48-01 / R48-02 / R48-04。
- nightwatch-backend `.trae/documents/findings.md`：R48-03。
- 上一轮报告：`expert-review-2026-11-14-round47-alert-notification-job-event.md`（时点快照，未改写）。
