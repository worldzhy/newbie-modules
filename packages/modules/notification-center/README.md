# newbie.notification-center

Platform notification center. Business modules declare notifications in code, the center persists per-notification delivery settings, renders templates into `NotificationRecord` rows, and pushes system-scope notifications through a host-provided push adapter (injected under the `NOTIFICATION_PUSH_PORT` token).

## Concepts

- **Notification** (code): a notification declared by subclassing the abstract `Notification` base class (`notification.ts`). The subclass declares `key` / `name` / `titleTemplate` / `defaultSeverity` (plus optional `detailTemplate` / `defaultPushEnabled` / `scope`); the base class property-injects `NotificationRegistryService` and registers the declaration on module init, so consumer constructors stay free of platform boilerplate.
- **NotificationSetting** (database): one row per registered notification key, owning the runtime-editable delivery fields (`defaultSeverity`, `isPushEnabled`) plus the declared `scope`. `NotificationSettingService` reconciles declarations on application bootstrap: missing rows are created, existing rows are never overridden.
- **NotificationRecord** (database): one platform-wide row per delivered notification event. Per-user read state lives in `NotificationReceipt`, so fan-out needs no writes: a missing receipt simply means "unread" for that user.
- **NotificationAlert** (database): one row per running alert cycle, keyed by `notificationKey` + `fingerprint`, carrying the frozen verdict (`verdictAction` / `verdictRuleId` / `verdictReason`) so a firing event and its recovery always land on the same side of the rules (ADR-062). A firing after a resolved cycle reopens the alert and recomputes the verdict.
- **NotificationDeliveryRule** (database): the operator's delivery rules, evaluated by ascending `priority` with first match winning. `condition` matches on `phase` / `severityAtLeast` / `notificationKeys` / `projectIds` / `tags`; absent fields do not filter, an empty collection never matches. No rule matching means suppress. One default rule (`severityAtLeast: high` → `deliver`) is seeded when the table is empty on boot, and the last remaining rule cannot be deleted, so an empty table only ever exists before that seed.
- **NotificationDeliveryAttempt** (database): one audit row per recorded delivery, holding the alert, the record, and the decision with its reason (`rule` / `no-rule-matched`).
- **NotificationCenterSetting** (database): singleton row (fixed id) holding the center-wide `isPushEnabled` master switch. Delivery is no longer governed by a severity floor — the rule table is the only gate.
- **NotificationPushPort** (host-provided, optional): the push adapter interface (`pushSystemText(text)`). The host implements it with its chat platform and its system-chat bindings, and registers it under the `NOTIFICATION_PUSH_PORT` injection token. Without an adapter the center still records notifications; only push delivery is skipped.
- **NotificationVisibilityPort** (host-provided, required): the project-membership adapter interface (`visibleProjectIds(userId)`), registered under the `NOTIFICATION_VISIBILITY_PORT` injection token. Notification records are platform-wide rows, so the host supplies this port to keep project-scoped reads and deliveries scoped to their members. The controller injects it without `@Optional`: a host that forgets to bind it fails at startup instead of exposing every project's notifications.

## Delivery flow

`NotificationCenterService.notify({ notificationKey, context, ... })`:

1. Looks up the declaration in `NotificationRegistryService` and the row in `NotificationSetting`.
2. Resolves severity (explicit override wins over the row default), opens or reuses the alert instance for this key + fingerprint, and freezes the rule verdict on it (`deliver` / `suppress`, plus why: a matching rule or nothing matched). The record is always persisted; the verdict only decides push. Each recorded delivery writes a `NotificationDeliveryAttempt`, and the result carries the `decision` and `reason` so the project push leg can gate itself (ADR-062).
3. Renders the Handlebars-style title/detail templates with `context` and inserts a `NotificationRecord` (idempotent when a `deduplicationKey` is provided).
4. Push: when the notification's scope is `system` and both its and the center's `isPushEnabled` are on, the rendered text is pushed through the host-provided `NotificationPushPort`. Project-scope notifications are routed to the owning project's bound chats by the host and do not pass through here.

## Endpoints

- `POST /notifications`
- `GET /notifications`, `GET /notifications/unread-count`, `GET /notifications/:id/delivery-attempt`
- `POST /notifications/:id/read`, `POST /notifications/read-all`
- `GET /notification-settings`, `PUT /notification-settings/:key`
- `GET/POST /notification-delivery-rules`, `PUT/DELETE /notification-delivery-rules/:id`, `PUT /notification-delivery-rules/order`, `POST /notification-delivery-rules/simulate`
- `GET/PUT /notification-center-setting`, `POST /notification-center-setting/test-push`

## Configuration

No new env vars. Both ports above are Nest injection tokens bound by the host application: `NOTIFICATION_VISIBILITY_PORT` is mandatory (startup fails without it) and `NOTIFICATION_PUSH_PORT` is optional (only push delivery is skipped). Absolute links in push messages reuse the host's existing `APP_FRONTEND_URL`.
