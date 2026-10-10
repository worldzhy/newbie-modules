# newbie.notification-center

Platform notification center. Business modules declare notifications in code, the center persists per-notification delivery settings, renders templates into `NotificationRecord` rows, and pushes system-scope notifications through a host-provided push adapter (injected under the `NOTIFICATION_PUSH_PORT` token).

## Concepts

- **Notification** (code): a notification declared by subclassing the abstract `Notification` base class (`notification.ts`). The subclass declares `key` / `name` / `titleTemplate` / `defaultSeverity` (plus optional `detailTemplate` / `defaultPushEnabled` / `scope`); the base class property-injects `NotificationRegistryService` and registers the declaration on module init, so consumer constructors stay free of platform boilerplate.
- **NotificationSetting** (database): one row per registered notification key, owning the runtime-editable delivery fields (`defaultSeverity`, `pushEnabled`) plus the declared `scope`. `NotificationSettingService` reconciles declarations on application bootstrap: missing rows are created, existing rows are never overridden.
- **NotificationRecord** (database): one platform-wide row per delivered notification event. Per-user read state lives in `NotificationReceipt`, so fan-out needs no writes: a missing receipt simply means "unread" for that user.
- **NotificationCenterSetting** (database): singleton row (fixed id) with center-wide switches: the `pushEnabled` master switch and the `minimumSeverity` floor. In-app recording is the base layer and is always on; every notification below the severity floor is persisted regardless of push delivery.
- **NotificationPushPort** (host-provided): the push adapter interface (`pushSystemText(text)`). The host implements it with its chat platform and its system-chat bindings, and registers it under the `NOTIFICATION_PUSH_PORT` injection token. Without an adapter the center still records notifications; only push delivery is skipped.

## Delivery flow

`NotificationCenterService.notify({ notificationKey, context, ... })`:

1. Looks up the declaration in `NotificationRegistryService` and the row in `NotificationSetting`.
2. Resolves severity (explicit override wins over the row default) and drops deliveries below the center `minimumSeverity` floor before any write.
3. Renders the Handlebars-style title/detail templates with `context` and inserts a `NotificationRecord` (idempotent when a `deduplicationKey` is provided).
4. Push: when the notification's scope is `system` and both its and the center's `pushEnabled` are on, the rendered text is pushed through the host-provided `NotificationPushPort`. Project-scope notifications are routed to the owning project's bound chats by the host and do not pass through here.

## Endpoints

- `POST /notifications`
- `GET /notifications`, `GET /notifications/unread-count`
- `POST /notifications/:id/read`, `POST /notifications/read-all`
- `GET /notification-settings`, `PUT /notification-settings/:key`
- `GET/PUT /notification-center-setting`, `POST /notification-center-setting/test-push`

## Configuration

No new env vars. Absolute links in push messages reuse the host's existing `APP_FRONTEND_URL`.
