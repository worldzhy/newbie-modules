# newbie.notification-center

Platform notification center. Business modules declare notifications in code, the center persists per-notification delivery settings, renders templates into `NotificationRecord` rows, and pushes system-scope notifications through a host-provided push adapter (injected under the `NOTIFICATION_PUSH_PORT` token). It delivers messages; it does not own alert lifecycles — those live in `alert-center` (ADR-065).

## Concepts

- **Notification** (code): a notification declared by subclassing the abstract `Notification` base class (`notification.ts`). The subclass declares `key` / `name` / `titleTemplate` and optionally `kind` (`alert` or `event`) / `detailTemplate` / `defaultPushEnabled` / `notifyOnRecovery` / `scope` / recovered templates; the base class property-injects `NotificationRegistryService` and registers the declaration on module init, so consumer constructors stay free of platform boilerplate. Severity is not declared here: the producer passes it on every `notify()` (ADR-062).
- **NotificationSetting** (database): one row per registered notification key, owning the runtime-editable delivery field (`isPushEnabled`) plus the declared `scope`. `NotificationSettingService` reconciles declarations on application bootstrap: missing rows are created, the declaration-owned fields (`name`, `titleTemplate`, `detailTemplate`, `scope`) are realigned on every start, and only `isPushEnabled` is left untouched so operator edits survive.
- **NotificationRecord** (database): one platform-wide row per delivered notification event. `status` holds the lifecycle state (`firing` / `resolved`; plain events stay `firing`), and `sourceType` / `sourceRef` say where the delivery came from (`alert` + `Alert.id` for alert-domain messages) without a cross-domain foreign key. Per-user read state lives in `NotificationReceipt`, so fan-out needs no writes.
- **NotificationDeliveryRule** (database): the operator's delivery rules, evaluated by ascending `priority` with first match winning. `condition` matches on `state` / `severityAtLeast` / `notificationKeys` / `projectIds` / `tags`; absent fields do not filter, an empty collection never matches. No rule matching means suppress. Two default rules are seeded when the table is empty on boot — `severityAtLeast: high` → `deliver` and `state: resolved` → `deliver` — so a fresh install keeps announcing high/critical signals and recoveries. The last remaining rule cannot be deleted.
- **NotificationDeliveryAttempt** (database): one audit row per recorded delivery, holding the record, the rule decision with its reason (`rule` / `no-rule-matched`) and, separately, the `runtimeReason` that kept a deliverable notification in-app (`subscription-off` / `recovery-opt-out` / `channel-off` / `no-port`).
- **NotificationCenterSetting** (database): singleton row (fixed id) holding the center-wide `isPushEnabled` master switch. The rule table is the only gate.
- **NotificationPushPort** (host-provided, optional): the push adapter interface (`pushSystemText(text)`). Without an adapter the center still records notifications; only push delivery is skipped.
- **NotificationVisibilityPort** (host-provided, required): the project-membership adapter interface (`visibleProjectIds(userId)`), registered under the `NOTIFICATION_VISIBILITY_PORT` injection token. The controller injects it without `@Optional`: a host that forgets to bind it fails at startup instead of exposing every project's notifications.

## Delivery flow

`NotificationCenterService.notify({ notificationKey, severity, context, ... })`:

1. Looks up the declaration in `NotificationRegistryService`, validates the required severity against the closed vocabulary (ADR-062), and reads the `NotificationSetting` row and center setting.
2. Resolves the lifecycle `state` for this delivery: `alert`-kind notifications use the passed `firing` / `resolved` (default `firing`), `event`-kind ones always record `firing`. The record is always persisted; the rule decision only decides push.
3. Evaluates the rule table **per delivery** (ADR-065 §6): the alert lives in its own domain, so firing and resolved are judged by the same table against the same severity. The seeded table separates them by `state` anyway — the firing rule requires `high+`, the recovery rule has no severity floor — so a closure is announced even for a signal that stayed in-app; losing a recovery is worse than an extra one.
4. Runs the real-time segment only when the decision is `deliver`, first match winning: `subscription-off` → `recovery-opt-out` → `channel-off` → `no-port`. The result carries `decision`, `reason` and `runtimeReason`; each recorded delivery writes a `NotificationDeliveryAttempt`.
5. Renders the Handlebars-style templates with `context` (using the recovered overrides for `resolved` alert messages) and inserts a `NotificationRecord` (idempotent when a `deduplicationKey` is provided).
6. Push: system-scope notifications push through the host-provided `NotificationPushPort` only when the decision delivers and no real-time interception applies. Project-scope notifications are routed by the host, which reads `decision` / `runtimeReason`.

## Endpoints

- `POST /notifications`
- `GET /notifications`, `GET /notifications/unread-count`, `GET /notifications/:id/delivery-attempt`
- `POST /notifications/:id/read`, `POST /notifications/read-all`
- `GET /notification-settings`, `PUT /notification-settings/:key`
- `GET/POST /notification-delivery-rules`, `PUT/DELETE /notification-delivery-rules/:id`, `PUT /notification-delivery-rules/order`, `POST /notification-delivery-rules/simulate`
- `GET/PUT /notification-center-setting`, `POST /notification-center-setting/test-push`

## Configuration

`NOTIFICATION_RECORD_RETENTION_DAYS` (declared by the host manifest, ADR-033; example `90`) bounds the lifetime of `NotificationRecord` and `NotificationDeliveryAttempt` rows. Expired rows are pruned lazily on the notify path, at most once per hour; `NotificationReceipt` and `NotificationPushFailure` cascade with their record. Both ports above are Nest injection tokens bound by the host application: `NOTIFICATION_VISIBILITY_PORT` is mandatory (startup fails without it) and `NOTIFICATION_PUSH_PORT` is optional (only push delivery is skipped). Absolute links in push messages reuse the host's existing `APP_FRONTEND_URL`.

## Upgrading

ADR-065 moved alert lifecycles into `alert-center` and deleted the `NotificationAlert` and `NotificationSilence` tables. A deployment that still carries them can drop both without migrating data: most alert rows were stale `firing` rows left by event producers, and live producers re-raise on their next poll. `NotificationRecord.status` keeps the firing/resolved history on its own. Existing delivery-rule conditions that still read `{"phase": ...}` must be rewritten to `{"state": "firing" | "resolved"}`; unknown condition fields are rejected on write.
