# ADR-067: job-scheduler 暴露 run-succeeded 事件，job 失败告警由宿主闭合

状态：已采纳
日期：2026-11-14

## 背景

ADR-065 把告警拆成独立域，并要求每条告警有可闭合的生命周期。当前 `job-scheduler`
模块只声明 `job-scheduler.run-failed`（`packages/modules/job-scheduler/job-scheduler.events.ts`），
调度器在失败行落库后发出该事件；宿主把它翻译成一条 `job.run-failed` 通知。

这留下一个无法闭合的告警族（R41-01）：

1. 每次失败各发一条消息，失败与「这类任务现在是坏的」之间没有映射。
2. 后续成功没有任何事件，宿主无从得知「这个 schedule 已经恢复」，告警列表只会累积。
3. 宿主要么读 `JobRun` 表轮询（把调度器私有 schema 拉进宿主），要么永远不闭合。

## 决策

### 1. 模块新增成功事件

`job-scheduler` 在成功行**落库之后**发出与失败事件对称的事件：

```ts
export const JOB_RUN_SUCCEEDED_EVENT = "job-scheduler.run-succeeded";

export interface JobRunSucceededEvent {
  runId: number;
  scheduleId: number;
  scheduleKey: string;
  handlerKey: string;
  trigger: JobTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}
```

- 与失败事件同一发射位置与同一条纪律：监听器异常只记日志，不回抛、不掩盖已落库的 run。
- 不新增「run-finished + status」合并事件：既有失败订阅方按 key 过滤，改载荷属于破坏性契约变更，
  而两个事件各自语义单一。
- `skipped`（上一轮仍在跑）不发事件：它不是任务结果，也不能作为恢复信号。
- 事件加入 `jobSchedulerEventDeclarations`，由宿主既有的事件声明装配（ADR-028）激活。

### 2. 告警生命周期留在宿主

注册表模块**不感知告警**（ADR-065 §5 的端口解耦）。宿主在 `src/application` 把
`job.run-failed` 声明为 `kind = "alert"` 的通知，并以 `scheduleKey` 为生命周期身份：

| 信号 | 宿主动作 |
| --- | --- |
| `job-scheduler.run-failed` | `alertCenter.raise({ source: "job-scheduler", alertKey: scheduleKey, severity: "high" })` |
| `job-scheduler.run-succeeded` | 扫本来源 firing 行，按 routing label 过滤后 `alertCenter.resolve(...)` |

恢复只关「本 schedule 的失败告警」：扫描条件同时匹配 `notificationKey`、`scheduleKey`，
避免一次成功关掉别的 schedule 的告警，也避免与同来源其他族（未来若增加）串扰。
没有 firing 行时 `resolve` 返回 null 并联日志——成功是常态，不能每个成功 run 都造一条
「迟到恢复」。

## Cross-host check

| 维度 | 框架层（job-scheduler 模块） | 宿主层（nightwatch-backend） |
| --- | --- | --- |
| 接口签名 | 新增 `JobRunSucceededEvent` + `JOB_RUN_SUCCEEDED_EVENT`；既有事件与 API 不变 | 订阅两个事件，调用 `AlertCenterService.raise / resolve` |
| 领域词汇 | 只有 `scheduleKey` / `handlerKey` / `runId` 等调度器通用词 | 固定 `source = "job-scheduler"`、告警键 = `scheduleKey` 属于宿主映射 |
| 数据模型 | 不改 schema；success 行原本就写 `status = "success"` | 无迁移；告警行由 alert-center 自己的表承载 |
| 可移植性 | 任意宿主装 `job-scheduler` 即得到成功事件，不装就仍是纯调度器 | 通知模板、告警来源注册与恢复扫描是宿主业务 |

## 影响

- registry：`packages/modules/job-scheduler/job-scheduler.events.ts`（新增常量、接口、声明）；
  `scheduler/job-scheduler.service.ts`（成功分支发射事件）。无 schema 变更、无迁移。
- 宿主：`job.run-failed` 模板改为 `kind = "alert"` 并补恢复模板；`JobFailureNotificationsService`
  增加成功订阅与有界 firing 扫描；注册 `job-scheduler` 告警来源。
- 其他消费方：不订阅新事件则行为完全不变。
- 前端：无影响，告警列表沿用既有读面。

## 非目标

- 不把告警状态机、提醒节奏搬进 `job-scheduler`。
- 不为 `skipped`、cancelled 或人工重试单独定义事件。
- 不引入「连续 N 次失败才告警」的抑制策略；一次失败即一条生命周期，恢复由成功闭合。
- 不改 `JobRun` 表结构与既有 controller / DTO。

## 被否掉的方案

- **宿主轮询 `JobRun` 表判定恢复**：需要宿主理解调度器私有 schema，且恢复最慢要等一个轮询周期。
- **把两个事件合并成 `run-finished`（带 status）**：破坏既有失败订阅方的契约，收益只是少一个常量。
- **调度器直接 `raise / resolve` 告警**：违反 ADR-065 §5，模块会同时依赖 alert-center 与通知域。
- **每次成功都发 resolve**：没有 firing 行时会产生大量「迟到恢复」日志，且把常态成功当生命周期事件。

## 增补（2026-11-14）：卡死运行检测与 JobRun 保留期

round47 评审（R47-03 / R47-04）发现：handler 永久挂起时，重入守卫只写 `skipped` 行，
`JobRun` 里没有「卡死中的 running」被闭合，失败事件链永不触发；同时 `JobRun` 与
`EventEmission`、`NotificationRecord` 的保留期不一致。本增补只闭合这两点，不改变
§1–§3 的事件契约与生命周期语义。

### 1. 卡死判定

- 阈值：`modules.job-scheduler.stuckRunTimeoutMinutes`（env `JOB_RUN_STUCK_TIMEOUT_MINUTES`），
  按 ADR-033 的纪律由宿主声明，manifest 示例值 30 分钟；不提供代码内回退。
- 每次进入重入守卫（上一轮仍在 `runningScheduleKeys` 中）时，先查该 schedule 的
  `status="running"` 行；`startedAt` 早于 `now - 阈值` 的行用条件更新
  （`where status="running"`）改成 `failed`，`error` 写入超时说明，`durationMs` 按实际
  经过时间计算，并复用既有 `job-scheduler.run-failed` 事件（不新增事件类型）。
  本次触发仍写一行 `skipped`——守卫语义不变，`skipped` 不是任务结果（§1）。
- 模块启动后的首个 `reconcile` tick（30s 内）对 `status="running" AND startedAt < now - 阈值`
  的全表行执行同一收敛：上次进程崩溃留下的 running 行在本次生命周期内被标为 failed
  并告警，避免它们永久悬挂。扫描有界（单次上限 100 行），失败只记日志，下个 tick 重试，
  不阻断启动。不在 `onApplicationBootstrap` 里执行：Nest 按模块注册顺序 await 各模块的
  bootstrap 钩子，而 `@nestjs/event-emitter` 在自己的钩子里才挂载 `@OnEvent` 监听器，
  早于它的模块 emit 会落到零监听器且不报错；首个 tick 同时保证下游（通知设置与投递规则）
  的 bootstrap 声明已完成。
- 「标 failed 后 handler 又返回」视为迟到完成：既有成功分支照常把该行改写为 success
  并发出 `run-succeeded`，由宿主按 ADR-067 §2 闭合告警。超时阶段的 failed 记录保留在
  告警与事件历史里，JobRun 的最终状态以真实完成为准。
- 不改 `JobRun` 表结构、controller、DTO；不新增「卡死」状态或事件。

### 2. JobRun 保留期

- `modules.job-scheduler.retentionDays`（env `JOB_RUN_RETENTION_DAYS`），宿主声明，示例 90 天。
- 懒清理，参照 event-emitter：每次创建运行行时按 `startedAt < now - 保留期` 删除旧行；
  进程内按小时节流，避免每条运行都做一次全表删除。没有额外调度器或依赖。

### 3. 与通知域的边界

宿主侧看门狗（检测提醒调度最近一次成功运行是否过旧）属于宿主业务，不进本模块；
本模块只保证「卡死 / 崩溃残留会被标 failed 并发出既有失败事件」，告警与通知映射仍按
ADR-065 §5 留在宿主。
