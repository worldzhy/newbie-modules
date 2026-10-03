# newbie.notification-center

Platform notification center. Business modules declare notifications in code, the center persists per-notification delivery settings, renders templates into `NotificationRecord` rows, and can optionally push them to Lark/Slack groups via the message-bot module.

## Concepts

- **Notification** (code): a notification declared by subclassing the abstract `Notification` base class (`notification.ts`). The subclass declares `key` / `name` / `titleTemplate` / `defaultSeverity` (plus optional `detailTemplate` / `defaultPushEnabled` / `defaultChannelGroupId`); the base class property-injects `NotificationRegistryService` and registers the declaration on module init, so consumer constructors stay free of platform boilerplate.
- **NotificationSetting** (database): one row per registered notification key, owning the runtime-editable delivery fields (`defaultSeverity`, `pushEnabled`, `channelGroupId`). `NotificationSettingService` reconciles declarations on application bootstrap: missing rows are created, existing rows are never overridden.
- **NotificationSettingChannel** (database): explicit per-notification push channels. When at least one row exists for a key, push delivery goes to these channels directly, bypassing both the notification group and the center default group.
- **NotificationRecord** (database): one platform-wide row per delivered notification event. Per-user read state lives in `NotificationReceipt`, so fan-out needs no writes: a missing receipt simply means "unread" for that user.
- **NotificationCenterSetting** (database): singleton row (fixed id) with center-wide switches: `inAppEnabled`, `pushEnabled` master switch, `minimumSeverity` floor, and the default message-bot channel group.

## Delivery flow

`NotificationCenterService.notify({ notificationKey, context, ... })`:

1. Looks up the declaration in `NotificationRegistryService` and the row in `NotificationSetting`.
2. Resolves severity (explicit override wins over the row default) and drops deliveries below the center `minimumSeverity` floor before any write.
3. Renders the Handlebars-style title/detail templates with `context` and inserts a `NotificationRecord` (idempotent when a `deduplicationKey` is provided).
4. Push routing, when both the notification's and the center's `pushEnabled` are on: explicit `NotificationSettingChannel` rows win, then the notification's `channelGroupId`, then the center default group.

## Endpoints

- `POST /notifications`
- `GET /notifications`, `GET /notifications/unread-count`
- `POST /notifications/:id/read`, `POST /notifications/read-all`
- `GET /notification-settings`, `PUT /notification-settings/:key`
- `GET/PUT /notification-center-setting`, `POST /notification-center-setting/test-push`

## Configuration

No new env vars. Absolute links in push messages reuse the host's existing `APP_FRONTEND_URL`.
