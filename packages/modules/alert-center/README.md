# newbie.alert-center

Alert identity, state machine, reminder rhythm and per-source pause (ADR-065). Alerts are produced by their own producers and never by notification delivery: a producer calls `raise()` when something breaks and `resolve()` when it recovers, and this module calls the notification domain through a host-bound port.

## Concepts

- **Alert** (database): one lifecycle per `fingerprint` = `scopeId + source + alertKey`, hashed when longer than the column width. `state` is `firing | resolved`; `severity`, `labels` and `data` belong to the current lifecycle. No delivery verdict is stored here — delivery policy belongs to the notification domain.
- **AlertSource** (database): operator overrides only. Sources are registered in code with a key, a display name and a default rhythm; this table stores a `repeatMinutes` override and a `notificationPausedUntil` window for sources that were actually changed, and the row is removed when neither is set.
- **AlertSourceRegistryService** (code): the source registry. `raise()` and `resolve()` reject unregistered keys, so a typo surfaces at the call site instead of creating a ghost source.
- **AlertNotificationPort** (host-provided, optional): turns one lifecycle event into a notification. The host maps `(source, state)` to a notification key and calls `NotificationCenterService.notify()`. Without an adapter alerts are still recorded; only external delivery is skipped.

## State machine

| current  | event        | effect                                                          | external delivery         |
| -------- | ------------ | --------------------------------------------------------------- | ------------------------- |
| none     | raise        | create, `firing`, `firstSeenAt=now`, rhythm computed            | firing, `reminderCount=0` |
| firing   | raise        | `occurrences+1`, `lastSeenAt` moves, rhythm untouched           | no                        |
| firing   | reminder due | claim, `lastNotificationAt=now`, `nextNotificationAt += rhythm` | firing, `reminderCount+1` |
| resolved | raise        | reopen: `firing`, counters reset, rhythm recomputed             | firing, `reminderCount=0` |
| firing   | resolve      | `resolved`, `resolvedAt=now`, `nextNotificationAt=null`         | resolved                  |
| resolved | resolve      | no-op                                                           | no                        |
| none     | resolve      | returns `null` and logs a late recovery                         | no                        |

Concurrency: the `fingerprint` unique index is the only arbitration point. A losing `raise()` re-reads the winner row and advances it instead of failing the caller.

## Reminder rhythm replaces silences

| operator intent                 | expression                               |
| ------------------------------- | ---------------------------------------- |
| remind me every 5 minutes       | `repeatIntervalMinutes = 5`              |
| remind me tomorrow              | move `nextNotificationAt` to `now + 24h` |
| stop reminding after I claim it | clear `nextNotificationAt`               |

Opening or reopening computes `nextNotificationAt = max(notificationPausedUntil ?? now, now) + rhythm`. A paused source still records raises and resolves; only external delivery stops, and the first reminder after the pause is a single late one rather than a burst of the missed ones.

`dispatchDueReminders({ now?, limit? })` is an idempotent scan: it claims each due row with a conditional update before calling the port, so concurrent scans never message the same reminder twice. **The module ships no scheduler** — the host calls this from its own job runner. A host that never calls it gets no reminders.

## Endpoints

- `POST /alerts`, `POST /alerts/resolve`
- `GET /alerts`, `GET /alerts/:id`
- `GET /alert-sources`, `PUT /alert-sources/:key`

## Wiring

```ts
@Module({
  providers: [
    {
      provide: ALERT_NOTIFICATION_PORT,
      useClass: AlertNotificationAdapter,
    },
  ],
})
export class AppModule {}
```

## Configuration

No env vars. The notification adapter is bound by the host under the `ALERT_NOTIFICATION_PORT` token; reminder frequency is per source (code default, row override) and per lifecycle (`raise({ repeatIntervalMinutes })`).
