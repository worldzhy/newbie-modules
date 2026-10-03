# newbie.message-bot

Multi-platform **group-bot webhook channel directory with delivery records**. Registers Lark/Slack group incoming-webhook bots as reusable channels, organizes them by project, and records the result of every delivery.

## Boundary

- This module owns "which group, which webhook, what was sent": `MessageBotChannel` (channel endpoints), `MessageBotChannelGroup` (project-scoped group tree), `MessageBotRecord` (delivery audit).
- The send mechanism itself is a single webhook HTTP POST (one service per Lark/Slack); it does not include platform SDK auth, event streams, or interactive cards.
- This is **not** the Feishu app bot: tenant access tokens, WebSocket event subscription, card callbacks, and chat history live in the separate `lark-bot` module (foundation). The two are different integration modes with similar names and do not depend on each other.
- Stateless platform adapters (`lark-bot`, `slack`) live in the foundation layer; this module is a capability-layer channel-management product built on top of them, consumed by the application layer and modules such as `notification-center`.

## Endpoints

- `GET/POST/PATCH/DELETE /lark-channels`, `POST /lark-messages`
- `GET/POST/PATCH/DELETE /slack-channels`, `POST /slack-messages`
- `GET/POST/PATCH/DELETE /message-bot-groups`
