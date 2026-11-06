# ADR-051: web-monitor 告警冷却与恢复通知

状态：已采纳
日期：2026-11-06

> 归属：本仓（治理 `web-monitor` 模块告警状态机与 `notification-center` 通知模型字段，两者均为 registry 模块）。前置 ADR：ADR-050（错误来源分级，已采纳）。

## 背景

ADR-050 把 console 噪音从告警通道清出去后，剩余的 6 类信号（slow-page / slow-first-paint / slow-resource / slow-ajax / js-error-spike / js-error-first-seen）仍然存在一个正确性问题：

`jobs.service.ts` 的 `emitAlert` 每 60s 评估周期只要阈值被突破就 emit，去重只靠 `deduplicationKey` 里的**分钟桶**（见宿主通知服务 `web-threshold-alerts.notifications.service.ts` L95-L97）。同一个持续存在的错误在下一分钟换桶后会产生**一条新的 `NotificationRecord`**，导致告警频道每分钟重复推送同一问题。这会迅速制造告警疲劳，把 ADR-050 刚刚腾出来的信噪比重新压垮。

与此同时，当一个告警条件消失时，系统目前**不发任何"已恢复"通知**——用户无法区分"还在响"和"已经好了"，只能手动回页面看。

因此需要在"触发告警"和"产生通知"之间插入一个**信号状态机**：对每个 `(appKey, signal[, category][, fingerprint])` 维护 firing / cooling / resolved 状态，冷却期内抑制重复通知，连续 N 个干净窗口后发 resolved 通知。

## 候选方案

### A. 评估器侧状态机（本 ADR 倾向）

在 `web-monitor` 的 `evaluateThresholdAlerts` 里，`emitAlert` 之前先查 Redis 状态；每次评估对每个信号做"突破 / 未突破"判定，驱动状态机：

- 突破且当前非 firing → 发 firing 通知，状态置 firing，记录 `lastFiredAt`
- 突破且当前 firing 且 `now - lastFiredAt < cooldownMs` → **不发通知**（冷却），刷新 `lastFiredAt`
- 突破且当前 firing 且已过冷却期 → 重新发 firing 通知，刷新 `lastFiredAt`（重燃）
- 未突破且当前 firing → `cleanWindows += 1`；达到阈值 N → 发 resolved 通知，清状态
- 未突破且无 firing 状态 → 无操作

状态存 Redis（`web-monitor:alert-state:<appKey>:<signal>[:<category>][:<fingerprint>]`），TTL 设为 `cooldownMs` 的若干倍以避免僵尸 key。

`NotificationRecord` 加两个字段：`status @db.VarChar(10)`（firing / resolved，默认 firing）、`resolvedAt DateTime?`。resolved 通知的 `deduplicationKey` 用 firing key 加 `:resolved` 后缀，保持唯一约束。

### B. 通知中心侧状态机

把状态机放进 `notification-center.service.ts`，靠 `deduplicationKey` 去重 + 一个额外的"最近一次通知时间"表来实现冷却。恢复判定需要通知中心回查 web-monitor 的数据，跨模块耦合。

### C. 什么都不做

维持现状，接受重复告警。

## 决策

选 **A**。

决定性理由：状态机的输入是"本窗口是否突破阈值"，这个判定天然属于 `web-monitor` 评估器（它刚算完 count）。把状态机放在评估器侧，判定和状态更新在同一次同步流程里完成，不需要跨模块回查。通知中心只负责"把事件落成记录"，职责不变（它已经是无状态的 idempotent writer）。

B 把两个模块耦合在一起，且通知中心没有"是否突破"的信息，必须再查一次 ClickHouse。C 直接放弃告警系统的可用性。

### 具体设计

**状态 key 与字段**（Redis JSON）：

```
key:   web-monitor:alert-state:{appKey}:{signal}[:{category}][:{fingerprint}]
value: { status: "firing", firstFiredAt: <iso>, lastFiredAt: <iso>, cleanWindows: 0 }
```

- slow-* 信号：fingerprint 为空；slow-resource 带 category（js/css/img）作为 key 一部分
- js-error-spike：无 fingerprint（聚合信号）
- js-error-first-seen：fingerprint 为错误指纹

**首现信号的特殊性**：`js-error-first-seen` 是边沿检测器（新指纹只在首次出现时告警，基线查询阻止后续重复告警），因此只走 `shouldFire`（冷却期内不重发），**不发 resolved 通知**——"新错误"信号没有可恢复的电平。状态 key 在指纹不再出现后由 TTL 自然过期。

**默认参数**（后续由"阈值配置化"ADR 移出常量）：

| 参数 | 默认值 | 含义 |
|---|---|---|
| `ALERT_COOLDOWN_MS` | 3,600,000（1h） | firing 后冷却期，期内不重发 |
| `ALERT_RESOLVED_WINDOWS` | 2 | 连续多少个干净窗口判定恢复 |

**恢复判定时机**：在每个信号 `runSignal` 的 evaluate 回调末尾，若本次 count 未达阈值且存在 firing 状态，则 `cleanWindows++`；达到 `ALERT_RESOLVED_WINDOWS` 时 emit resolved 事件并 `DEL` 状态 key。若中途再次突破，`cleanWindows` 清零并重燃。

**事件扩展**：`WebThresholdAlertEvent` 加 `phase: "firing" | "resolved"`（默认 firing），resolved 时 `count = 0`、`topItems = []`。宿主通知服务据此把 `status` / `resolvedAt` 写入 `NotificationRecord`，并把 `deduplicationKey` 后缀改为 `:resolved`。

**`NotificationRecord` schema 变更**（`prisma/schema.prisma`，`module/notification-center` schema）：

```prisma
status      String    @db.VarChar(10) @default("firing")
resolvedAt  DateTime?
```

加 `@@index([status])` 以便前端按状态过滤。迁移走 `prisma migrate dev`（无前向迁移脚本约定，见 ADR-014）；字段可空 / 有默认值，不破坏旧数据。

**前端**（nightwatch-frontend）：通知中心列表把同一 `(appKey, signal, fingerprint)` 的 firing 与 resolved 配对展示，resolved 行样式降级；不改 web-monitor 错误列表页面。

## 跨宿主 / 演进检验

- 状态机完全在 registry `web-monitor` 模块内，宿主只消费事件，换宿主不影响。
- Redis 状态 key 不含宿主概念（appKey 是 SDK 约定，不是宿主实体）。
- `NotificationRecord` 加字段是向后兼容的（默认值 + 可空），旧宿主不读 `status` 也能正常工作。
- resolved 事件复用现有 `WEB_THRESHOLD_ALERT_EVENT` 通道，宿主通知服务只需判断 `phase`，不引入新事件类型。

## 影响

- 告警通知量预计下降一个数量级（持续告警只在 firing 与 resolved 各一次）。
- `NotificationRecord` 行数增长放缓。
- 后续"阈值配置化"ADR 可把 `ALERT_COOLDOWN_MS` / `ALERT_RESOLVED_WINDOWS` 与现有阈值常量一起暴露为站点级配置，一次设计配置面。
- 前端通知中心需要做 firing/resolved 配对展示（小改动）。
- 不改 ClickHouse schema、不改 SDK、不改 `api`/`type` 口径（与 ADR-050 正交）。

## Checklist

- [ ] registry：`jobs.service.ts` 接入 Redis 状态机（firing / cooling / resolved 转换）
- [ ] registry：`threshold-alert.event.ts` 加 `phase` 字段
- [ ] registry：`notification-center` schema 加 `status` / `resolvedAt` + 索引 + 迁移
- [ ] registry：契约测试覆盖状态机转换（冷却抑制、重燃、恢复判定、中途突破清零）
- [ ] 宿主：`web-threshold-alerts.notifications.service.ts` 处理 `phase=resolved`、写 `status`/`resolvedAt`
- [ ] 宿主：前端通知中心 firing/resolved 配对展示
- [ ] E2E：持续错误只发 1 条 firing；恢复后发 1 条 resolved；冷却期内不重复
