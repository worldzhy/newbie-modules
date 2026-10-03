# newbie.notification-center

平台通知中心。订阅扫描模块的 `*.scan-completed` 事件，把安全扫描结果转成**去噪后的摘要通知**，并可选通过 message-bot 模块推送到 Lark/Slack 群。

## v1 范围

- 告警源：`aws-audit`、`dependency-scan` 的 scan-completed 事件（EventEmitter2，wildcard）。
- 每次成功扫描最多一条通知（`(sourceModule, scanId)` 唯一幂等）；仅统计 `firstSeenAt` 落在本次扫描窗口的 open finding，重复出现的 finding 不再打扰；无新增（或低于最低严重度阈值）则静默。
- 突增检测：本次新增 high+ 数量 ≥ max（`spikeThreshold`，近 `spikeBaselineDays` 天日均 × 2）且严格高于日均时，通知升级为 `security-spike`。
- 站内信：全局一条 `Notification` + 惰性 `NotificationReceipt`（按用户记录已读），无扇出写入。
- 推送：可选伴侣模块 message-bot（Lark/Slack）。服务以 `@Optional()` 注入；未装配/未配置 group 时站内信不受影响。

## 端点

- `GET /notifications`、`GET /notifications/unread-count`
- `POST /notifications/:id/read`、`POST /notifications/read-all`
- `GET/PUT /notification-settings`、`POST /notification-settings/test-push`

## 配置

无新增 env。推送消息中的绝对链接复用宿主既有的 `APP_FRONTEND_URL`。
