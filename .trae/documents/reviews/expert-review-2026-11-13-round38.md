# Expert Review — round 38（plan scope）

**被审方案**：「告警实例（NotificationAlert）+ 投递决策（deliveryDecision）+ 有序规则列表（DeliveryPolicy）」模型
**评审问题**：这套模型能否承载后期 policy 的演进？
**模式**：只读。评审与修复分离，本会话不改代码。

## 1. 锚点

| 仓 | branch | HEAD | dirty | 被审域 dirty |
| --- | --- | --- | --- | --- |
| newbie-modules（模块真源） | dev | `1e47d6a` | 12 | 0 |
| nightwatch-backend（消费方） | dev | `86b0daf` | 17 | 0 |

- 计数命令：`git status --short | wc -l`；被审域过滤 `-- packages/modules/notification-center` / `-- src/application/notifications src/modules/notification-center prisma/models/notification-center.prisma`。
- dirty 全部落在 aws-cloudwatch 与 authorization 域（并行会话在途），通知域为 0 → 本报告结论**非 provisional**。
- 评审时间：2026-11-13（Asia/Shanghai）。
- 证据级别：`static`（读码 + 已有 schema）为主；本评审为设计推演，无 executed 证据，故不设 P0。

## 2. 范围与方法

- scope：`plan`，对象是上一轮对话提出的模型，不是已落地代码。
- 主张拆解：5 条（C1–C5），逐条判定 成立 / 不成立 / 证据不足。
- 依赖路径：`packages/modules/notification-center/{notification-center.service.ts, notification-center.constants.ts, prisma/schema.prisma}`；宿主消费点 `src/application/notifications/project-notification-push.service.ts`。
- 反驳轮：由主会话自扮反方执行，**仅部分独立**（同基础模型、共享上下文），已在 §3 标注。
- 模式扫描命令（零命中即无对应能力）：

```
grep -rniE 'fingerprint|silence|inhibit|grouping|throttle|rateLimit|maintenance' \
  packages/modules/notification-center
→ No matches found
```

## 3. 结论摘要

**不能。** 这套模型能优雅解决"恢复跟随告警"，但把"投递决策"当成不可变事实固化在实例上，正好挡住 policy 演进最主要的一类需求——**运行时上下文决策**（静默期、抑制、开关变更）。

维度评分（5 分制）：

| 维度 | 分 | 说明 |
| --- | --- | --- |
| 生命周期正确性 | 4 | 恢复继承由模型保证，优于 `recoveryOf` 特判 |
| 策略表达力 | 2 | first-match 规则覆盖阈值类，不覆盖静默/抑制/分组/节流 |
| 可演进性 | 2 | 决策固化与运行时重算冲突；Policy 粒度为单例 |
| 可解释性 | 3 | 只有 deliver/suppress，未落命中规则 |
| 落地成本 | 4 | 可渐进，无需一次性切换 |

## 4. 主张判定表

| 主张 | 判定 | 依据 |
| --- | --- | --- |
| C1 决策绑定实例 → recovered 复用同一决策，"同进同退"由模型保证 | **不成立（需修正）** | 方案的 `decide()` 把 `subscription.isPushEnabled` 与 policy 命中合并成一个 `deliveryDecision`；固化后即"创建时刻的订阅状态永久生效"，与已拍板的"恢复判定当前开关优先"直接冲突 |
| C2 severity 降为纯匹配标签，规则增删不改判定链 | **成立** | `SEVERITY_LEVEL` 在现行代码只服务一次数值比较（`notification-center.constants.ts:12-14`、`notification-center.service.ts:216`）；severity 已按标签列存储（`prisma/schema.prisma:47`），替换该比较不影响其余链路 |
| C3 Subscription / Policy / Channel 三层正交 | **部分成立** | 三层职责确实不同，但粒度不对齐：Subscription 是 per-key（`prisma/schema.prisma:17` 主键 `key`），Policy 是单例，Channel 由宿主端口提供 → 见 R38-04 |
| C4 有序规则 + first-match + fallback 能承载后期常见演进 | **不成立** | 缺 grouping / inhibition / silence / throttling 四类；其中 inhibition 与 silence 是运行时上下文决策，与"决策固化在实例"结构性冲突 → 见 R38-05 |
| C5 可渐进落地（先 Alert + 决策继承，Channel 暂不动） | **成立** | `NotificationAlert` 可先只做 upsert 与决策继承；`NotificationSetting`（`schema.prisma:16`）、`NotificationCenterSetting`（`schema.prisma:117`）可原样保留 |

## 5. 发现

### R38-01（P1）决策固化吞掉运行时状态变化

- 位置：方案 `NotificationAlert.deliveryDecision`（设计层，无代码行）。
- 冲突对象：现行实现每次 `notify()` 都实时读取 per-key 设置与中心设置，无进程内缓存（`notification-center.service.ts:196-221`）。
- 后果：用户关闭推送后，已存在实例的恢复消息仍按旧决策发出；反之打开推送也要等下一个实例。与"当前开关优先"的既有拍板矛盾。
- 修复方向：`deliveryDecision` 只固化 **policy 维度**（命中的规则 id + `then`）；订阅与通道每次投递实时求值。

### R38-02（P1）实例生命周期未定义

- 位置：方案 `@@unique([notificationKey, fingerprint])`。
- 问题：同一 key 反复 `firing → resolved → firing` 时，复用同一行则每次 firing 覆盖 `resolvedAt`、历史丢失；新建行则唯一约束冲突。
- 修复方向：区分"实例行"（长期存在、记录 `lastSeenAt`）与"状态迁移记录"（继续用 `NotificationRecord`），并显式定义唯一约束的回收条件。

### R38-03（P2）规则 JSON 无 schema 版本

- 位置：方案 `NotificationDeliveryPolicy.rules Json`。
- 问题：新增 `when` 字段或改变 first-match 语义时，历史 JSON 无法识别与迁移。
- 修复方向：`rules` 存 `{ version, rules }`，读路径带版本迁移函数。

### R38-04（P2）Policy 粒度与订阅粒度不对齐

- 位置：方案 Policy 单例 vs `NotificationSetting.key` 主键（`prisma/schema.prisma:17`）。
- 问题：演进到"某项目/某类通知用不同策略"时，单例无法表达，需要 route 树或 policy 作用域字段，属于结构性重做。
- 修复方向：Policy 表预留 `scope` + `scopeId`（可为空 = 全局），规则按"最具体作用域优先"求值。

### R38-05（P2）静默与抑制未被模型覆盖

- 位置：模型整体；模式扫描四类词零命中。
- 问题：`silence`（维护窗口）与 `inhibition`（A 在 firing 则 B 不推）要求**投递时重算**，固化模型只能"覆盖"不能"重算"。
- 修复方向：把决策拆成 `policyVerdict`（可固化）与 `runtimeVerdict`（每次求值，含 silence/inhibit/开关）；最终投递 = 两者与。

### R38-06（P2）抑制原因不可解释

- 位置：方案 `deliveryDecision: "deliver" | "suppress"`。
- 问题：只说结果不说原因，与现状"五道 if 串行、出错无法定位"同病。
- 修复方向：决策值改为 `{ action, ruleId?, reason }`；被抑制时也落一条 attempt 记录。

## 6. 已核验通过的不变量

1. 现行投递判定全部实时读库，无进程内缓存 → "当前开关优先"在现有代码形态下可实现（`notification-center.service.ts:196-221`）。
2. severity 是标签列而非枚举约束（`prisma/schema.prisma:47`），降级为匹配条件无迁移阻力。
3. 现有 `deduplicationKey`（`prisma/schema.prisma:55`）与方案 `fingerprint` 职责重叠，**不需要新造概念**：fingerprint 可先映射到该列，避免两套去重并存。
4. 中心设置单例（`CENTER_SETTING_SINGLETON_ID`，`notification-center.constants.ts:16`）使 Policy 单例化在当下不引入额外复杂度。

## 7. 覆盖率清单

- 审了：`notification-center` 的 schema、constants、`notify()` 门禁段；宿主 `project-notification-push.service.ts` 的 `pushSuppressed` 消费点。
- 未审（明确排除）：前端 settings 交互、宿主其余 notification 声明、aws-cloudwatch 在途改动、`dispatchPush` 的失败重试路径。

## 8. 修正后的最小终态

保留方案的三层正交与 Alert 实例，但把"一个决策"拆成两段：

```
最终投递 = policyVerdict（可固化：命中规则 + action）
         × runtimeVerdict（每次求值：订阅开关、通道可用、silence、inhibition）
```

- 固化只发生在 `policyVerdict`，恢复事件读同一个 `policyVerdict` → "同进同退"仍然成立。
- 开关、静默、抑制永远实时读 → 不违反"当前开关优先"。
- 这样后续加 silence / inhibit / per-project policy 都只动 `runtimeVerdict` 与 policy 作用域，不需要推翻实例模型。

## 9. 台账指针

本轮为 plan scope，不产生代码 findings 台账条目；如需落地，先写 ADR-062 并在其中固化 §8 的两段式决策。
