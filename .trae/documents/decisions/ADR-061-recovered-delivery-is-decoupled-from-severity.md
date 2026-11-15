# ADR-061: 恢复通知的投递与 severity 完全解耦，且与 firing 同进同退

状态：已被 ADR-062 取代
日期：2026-11-13

## 背景

ADR-051 引入 firing / recovered 两个生命周期阶段后，`notification-center` 只有一支 `severity`，恢复记录也只能借用它。ADR-060 把 floor 限定为"推送噪声旋钮"后，恢复记录虽然不再被丢弃，但**是否推送**依旧由 severity 决定，于是宿主上出现了三套互相矛盾的口径：

- `url-check.recovered` 声明 `high`，调用处还显式传 `severity: "high"`——唯一作用是穿过默认 floor=high，让恢复消息进飞书；这不是设计，是绕过。
- `heartbeat.recovered` 在 ADR-060 后回退为 `medium`，于是 `heartbeat.offline`（critical，推送）与它的恢复（不推送）在飞书里永远无法闭环。
- 与 firing 共用 key 的 `web.js-error-spike` / `web.slow-*` 恢复记录继承 firing 级别，语义上把"恢复"当成了一个告警级别。

站内 UI 侧同样把 recovered 按 severity 着色（红/橙圆点、severity 徽章），直到本次一并改为绿色恢复语义。产品口径明确：**"恢复"既不是 high 也不是 medium，它根本不是告警级别**。

## 候选方案

- A. 保持现状，各类型自行挑一个能穿过 floor 的 severity。最小改动，但等于把 floor 当成"想让恢复消息可见就调高级别"的暗门，ADR-060 的结论被反向利用；且 firing 与 recovered 的推送命运依旧各自为政。
- B. 恢复记录统一 `low`，并让恢复的 floor 判定复用其 firing 告警的级别（专用 recovered 声明用 `recoveryOf` 指回 firing key）；是否推送只由该 key 的 `isPushEnabled` 决定，专用 recovered 声明的开关与其 firing 声明保持一致。
- C. 删除 floor。彻底解耦，但同时抹掉 ADR-060 刚确立的"噪声旋钮"，把低级别 firing 也推进聊天通道。

## 决策

采用 B。

两条不变式：

1. **floor 始终在"告警级别"上判定，恢复自身不提供级别**。恢复记录声明 `low` 作为占位；专用 recovered 声明通过 `recoveryOf` 指向其 firing key，floor 用该 firing 声明的 severity 判定。共用 key 的 recovered 记录天然携带 firing 级别，无需额外声明。
2. **firing 与 recovered 同进同退**。同一告警的 firing 与 recovered 要么都推送、要么都只落站内；专用 recovered 声明的 `defaultPushEnabled` 必须镜像其 firing 声明，floor 判定则通过 `recoveryOf` 天然对齐。

由此，"恢复"在产品上既不是 high 也不是 medium：恢复记录的 severity 固定为 `low`，仅作为"无告警级别"的占位，展示层（绿点、绿色 recovered 徽章）完全忽略它，推送判定只有两个输入：`recoveryOf` 指向的告警级别、以及该 key 的推送开关。

## 跨宿主 / 演进检验（registry 模块设计必填）

- 不引入任何宿主或厂商概念：变更只涉及模块内部的推送判定分支与一个通用声明字段 `recoveryOf`（"本声明关闭哪个 firing key"），`NotificationPushPort`、`NotifyInput`、`NotifyResult` 契约不变。
- 对所有消费方一致：任何低于 floor 的 firing 仍只落站内；其恢复同样只落站内，不会出现"告警没推、恢复却推"的错位。
- 唯一行为变化是"开启了推送的告警，其恢复现在也会推送"——这正是闭环要求；关闭某 key 推送则两者一起静默，语义单一。

## 影响

- registry `notification-center`：`notify()` 的 floor 判定改为"recovered 且有 `recoveryOf` 时取 firing 声明的 severity"，其余取投递自身 severity；`NotificationDeclaration` 新增可选 `recoveryOf`，`Notification` 基类透传；`defaultSeverity` / `defaultPushEnabled` 注释与 README 明确上述两条不变式。
- 宿主（nightwatch）：
  - `url-check.recovered`、`heartbeat.recovered` 的 `defaultSeverity` 改为 `low`；`heartbeat.recovered` 的 `defaultPushEnabled` 由 `false` 改为 `true`，与 `heartbeat.offline` 对齐。
  - `url-check-alerts.notifications.service.ts` 删除恢复分支的显式 `severity: "high"`，测试断言改为"不传覆盖"。
  - 站内展示：recovered 记录统一绿色圆点 + 绿色 recovered 徽章，不再渲染 severity。
- 已存在的 `NotificationSetting` 行不会被 bootstrap 覆盖（运行时编辑优先），因此 `heartbeat.recovered` 的推送开关需要在设置页手动打开一次才会生效；声明默认值只影响新装环境。
