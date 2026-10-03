# newbie.message-bot

多平台**群机器人 Webhook 渠道名录与投递记录**。把 Lark/Slack 群的 incoming-webhook 机器人登记为可复用渠道，按项目分组管理，并记录每次消息投递的结果。

## 边界

- 本模块管的是"往哪个群、用哪个 webhook、发过什么"：`MessageBotChannel`（渠道端点）、`MessageBotChannelGroup`（挂在 Project 下的分组树）、`MessageBotRecord`（投递审计）。
- 发送机制本身只是一次 webhook HTTP POST（Lark/Slack 各一个 service），不含平台 SDK 鉴权、事件流或交互式卡片。
- **不是**飞书应用机器人：tenant_access_token、WebSocket 事件订阅、卡片回调、群历史等能力属于独立的 `lark-bot` 模块（foundation）。两者是不同集成模式，命名相近但互不依赖。
- 平台级无状态适配器（`lark-bot`、`slack`）位于 foundation；本模块位于 capability，是建在适配器之上的渠道管理产品，供应用层及 `notification-center` 等模块使用。

## 端点

- `GET/POST/PATCH/DELETE /lark-channels`、`POST /lark-messages`
- `GET/POST/PATCH/DELETE /slack-channels`、`POST /slack-messages`
- `GET/POST/PATCH/DELETE /message-bot-groups`
