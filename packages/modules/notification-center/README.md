# newbie.notification-center

Platform notification center. Subscribes to `*.scan-completed` events from scanning modules, turns security scan results into **denoised summary notifications**, and can optionally push them to Lark/Slack groups via the message-bot module.

## v1 scope

- Alert sources: scan-completed events (EventEmitter2, wildcard) from `aws-audit` and `dependency-scan`.
- At most one notification per successful scan (idempotent on the unique `(sourceModule, scanId)`); only open findings whose `firstSeenAt` falls inside the current scan window are counted, so recurring findings do not renotify; when there are no new findings (or they are below the minimum severity threshold) it stays silent.
- Spike detection: when the number of new high+ findings this run is >= max(`spikeThreshold`, the daily average over the last `spikeBaselineDays` days x 2) and strictly above the average, the notification is upgraded to `security-spike`.
- In-app messages: one global `Notification` plus lazy `NotificationReceipt` rows (read state per user); no fan-out writes.
- Push: optional companion module message-bot (Lark/Slack). The service is injected with `@Optional()`; in-app notifications are unaffected when it is not installed or no group is configured.

## Endpoints

- `GET /notifications`, `GET /notifications/unread-count`
- `POST /notifications/:id/read`, `POST /notifications/read-all`
- `GET/PUT /notification-settings`, `POST /notification-settings/test-push`

## Configuration

No new env vars. Absolute links in push messages reuse the host's existing `APP_FRONTEND_URL`.
