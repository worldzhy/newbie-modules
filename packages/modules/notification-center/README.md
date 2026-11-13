# newbie.notification-center

Platform notification center. Business modules declare notifications in code, the center persists per-notification delivery settings, renders templates into `NotificationRecord` rows, and pushes system-scope notifications through a host-provided push adapter (injected under the `NOTIFICATION_PUSH_PORT` token).

## Concepts

- **Notification** (code): a notification declared by subclassing the abstract `Notification` base class (`notification.ts`). The subclass declares `key` / `name` / `titleTemplate` / `defaultSeverity` (plus optional `detailTemplate` / `defaultPushEnabled` / `notifyOnRecovery` / `scope`); the base class property-injects `NotificationRegistryService` and registers the declaration on module init, so consumer constructors stay free of platform boilerplate.
- **NotificationSetting** (database): one row per registered notification key, owning the runtime-editable delivery fields (`defaultSeverity`, `isPushEnabled`) plus the declared `scope`. `NotificationSettingService` reconciles declarations on application bootstrap: missing rows are created, existing rows are never overridden.
- **NotificationRecord** (database): one platform-wide row per delivered notification event. Per-user read state lives in `NotificationReceipt`, so fan-out needs no writes: a missing receipt simply means "unread" for that user.
- **NotificationAlert** (database): one row per running alert cycle, keyed by `fingerprint` alone — the project id plus the caller's `alertKey`, else its `deduplicationKey`, else the `notificationKey`, and hashed when long, so one project's frozen verdict never decides another project's event (ADR-064) — carrying the frozen verdict (`verdictAction` / `verdictRuleId` / `verdictReason`) so a firing event and its recovery always land on the same side of the rules (ADR-062). A firing after a resolved cycle reopens the alert and recomputes the verdict.
- **NotificationDeliveryRule** (database): the operator's delivery rules, evaluated by ascending `priority` with first match winning. `condition` matches on `phase` / `severityAtLeast` / `notificationKeys` / `projectIds` / `tags`; absent fields do not filter, an empty collection never matches. No rule matching means suppress. Two default rules are seeded when the table is empty on boot — `severityAtLeast: high` → `deliver` and `phase: recovered` → `deliver` — so a fresh install keeps announcing high/critical signals and recoveries. The last remaining rule cannot be deleted, so an empty table only ever exists before that seed.
- **NotificationDeliveryAttempt** (database): one audit row per recorded delivery, holding the alert, the record, the rule decision with its reason (`rule` / `no-rule-matched`) and, separately, the `runtimeReason` that kept a deliverable notification in-app (`silenced` / `subscription-off` / `recovery-opt-out` / `channel-off` / `no-port`, plus `silenceId` when silenced).
- **NotificationSilence** (database): a maintenance window, active while `startsAt <= now < endsAt`. Its `condition` reuses the delivery-rule matchers, so an empty object silences everything and an empty collection never matches. A silence only intercepts push; the record still lands in the bell (ADR-063). Windows cannot be deleted at all — delivery attempts keep pointing at the window that intercepted them, so end one early instead (the schema enforces this with a `Restrict` relation).
- **NotificationCenterSetting** (database): singleton row (fixed id) holding the center-wide `isPushEnabled` master switch. Delivery is no longer governed by a severity floor — the rule table is the only gate.
- **NotificationPushPort** (host-provided, optional): the push adapter interface (`pushSystemText(text)`). The host implements it with its chat platform and its system-chat bindings, and registers it under the `NOTIFICATION_PUSH_PORT` injection token. Without an adapter the center still records notifications; only push delivery is skipped.
- **NotificationVisibilityPort** (host-provided, required): the project-membership adapter interface (`visibleProjectIds(userId)`), registered under the `NOTIFICATION_VISIBILITY_PORT` injection token. Notification records are platform-wide rows, so the host supplies this port to keep project-scoped reads and deliveries scoped to their members. The controller injects it without `@Optional`: a host that forgets to bind it fails at startup instead of exposing every project's notifications.

## Delivery flow

`NotificationCenterService.notify({ notificationKey, context, ... })`:

1. Looks up the declaration in `NotificationRegistryService` and the row in `NotificationSetting`. The HTTP endpoint carries the same optional `alertKey` / `status` / `recoveredAt` fields, so a lifecycle can be paired over the API as well.
2. Resolves severity (explicit override wins over the row default), opens or reuses the alert instance for this key + fingerprint, and freezes the rule verdict on it (`deliver` / `suppress`, plus why: a matching rule or nothing matched). The record is always persisted; the verdict only decides push (ADR-062).
3. Runs the real-time segment when the verdict is `deliver` (ADR-063), first match winning: `subscription-off` → `recovery-opt-out` → `channel-off` → `silenced` → `no-port`. The result carries both `decision` and `runtimeReason`, so both push legs can gate themselves; each recorded delivery writes a `NotificationDeliveryAttempt`.
4. Renders the Handlebars-style title/detail templates with `context` and inserts a `NotificationRecord` (idempotent when a `deduplicationKey` is provided).
5. Push: system-scope notifications push through the host-provided `NotificationPushPort` only when the verdict delivers and no real-time interception applies. Project-scope notifications are routed to the owning project's bound chats by the host; that leg honours `silenced` and `recovery-opt-out` but not the center-channel reasons, because binding a chat is its subscription.

## Endpoints

- `POST /notifications`
- `GET /notifications`, `GET /notifications/unread-count`, `GET /notifications/:id/delivery-attempt`
- `POST /notifications/:id/read`, `POST /notifications/read-all`
- `GET /notification-settings`, `PUT /notification-settings/:key`
- `GET/POST /notification-delivery-rules`, `PUT/DELETE /notification-delivery-rules/:id`, `PUT /notification-delivery-rules/order`, `POST /notification-delivery-rules/simulate`
- `GET/POST/PUT /notification-silences`, `POST /notification-silences/:id/cancel`
- `GET/PUT /notification-center-setting`, `POST /notification-center-setting/test-push`

## Configuration

No new env vars. Both ports above are Nest injection tokens bound by the host application: `NOTIFICATION_VISIBILITY_PORT` is mandatory (startup fails without it) and `NOTIFICATION_PUSH_PORT` is optional (only push delivery is skipped). Absolute links in push messages reuse the host's existing `APP_FRONTEND_URL`.

## Upgrading

The ADR-064 migration replaces the composite alert index with a unique index on `NotificationAlert.fingerprint`. A deployment that already recorded alerts must clear `NotificationAlert` before applying it — duplicate fingerprints make `CREATE UNIQUE INDEX` fail. `NotificationRecord.alertId` is declared `ON DELETE SET NULL`, so clearing alerts only unlinks the historical records. Edit the migration itself only when nobody has applied it: Prisma rejects a modified migration whose checksum is already recorded.
