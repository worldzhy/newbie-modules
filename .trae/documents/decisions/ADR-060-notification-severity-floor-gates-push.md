# ADR-060: notification-center 的 severity floor 只约束推送，不约束落库

状态：已采纳
日期：2026-11-13

## 背景

`notification-center` 同时提供两层语义：站内通知记录（bell）与聊天推送。中心设置里有一个 `minimumSeverity` 下限，README 与实现的描述互相矛盾：

- README 声称站内记录是 base layer、永远写入，floor 只影响推送；
- `NotificationCenterService.notify()` 的实际行为是在写库前直接丢弃低于 floor 的投递，并把结果标记为 `dropped`。

这个矛盾在宿主（nightwatch）上产生了可观测缺陷：声明为 `medium` 的 `web.slow-*` 通知在默认 floor=high 下既不落库也不推送，尽管其声明注释写着 "Medium severity: visible in the in-app bell, not pushed"；`web.js-error-digest` 默认开启推送却因同一下限完全不可达；`heartbeat.offline`（critical）能落库而其 `heartbeat.recovered`（medium）不能，形成无法闭环的告警记录。

## 候选方案

- A. 保持"写前丢弃"，修改 README 与各通知注释以对齐现状。改动最小，但等于承认 floor 是数据保留策略：恢复记录与低级别信号永久不可见，firing/recovered 配对在站内被破坏，声明注释持续说谎。
- B. 总是写入 `NotificationRecord`，`minimumSeverity` 只决定是否推送；`NotifyResult.dropped` 改为 `pushSuppressed`，宿主项目推送通道据此跳过推送。
- C. 仅让 `status=recovered` 的投递豁免 floor。可以修复配对，但为生命周期引入特例分支，且 `web.slow-*`、digest 等低级别 firing 仍然不可见，语义依旧分裂。

## 决策

采用 B。

决定性理由：floor 是"噪声旋钮"，回答"什么值得打扰人"，而不是"什么值得记录"。站内记录是事实层（审计、配对、回溯都依赖它），推送是打扰层。把两者绑在一起会让 floor 同时承担数据保留职责，任何调高 floor 的动作都会静默丢失历史与告警闭环；拆开后每个旋钮只表达一件事，且与 README 已声明的模型一致。

## 跨宿主 / 演进检验（registry 模块设计必填）

- 不引入任何宿主或厂商概念：变更只涉及模块内部的落库/推送分界，`NotificationPushPort` 契约不变。
- 行为变化对所有消费方一致：低于 floor 的通知从"不存在"变为"站内可见、不推送"。宿主若此前依赖 `dropped` 判断跳过后续动作，需改读 `pushSuppressed`。
- `NotifyResult` 是模块公开契约（HTTP DTO 同源），字段改名属破坏性变更；当前唯一消费方为 nightwatch，同步升级即可，无需兼容层。

## 影响

- 模块：`notify()` 移除写前丢弃；`dispatchPush` 增加 `pushSuppressed` 短路；`NotifyResult.dropped` → `pushSuppressed`；DTO、README、Prisma 模型注释同步。
- 宿主：`ProjectNotificationPushService` 改读 `pushSuppressed`；`heartbeat.recovered` 回退为 `medium`（不再需要为提高可见性而抬高级别）；`web.slow-*`、`web.js-error-digest` 恢复站内可见，但仍不推送（digest 的推送需另行决定是否提高级别）。
- 后续工作：`web.js-error-digest` 若要求默认推送，应显式提高其默认级别或降低中心 floor，属独立决策。
