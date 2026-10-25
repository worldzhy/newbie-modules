# event-emitter

General-purpose in-process event bus with an event catalog and emission history. Business modules declare the events they emit and inject `EventEmitter2` to fire them; the module records every emission so operators can see which events exist, who listens, and what actually fired.

## Working model

1. **Declare events**: emitting modules inject `EventCatalogService` and call `declareEvent({ key, name?, description?, payloadExample? })` at startup (e.g. in `onModuleInit`). Duplicate keys throw. The catalog lives in memory — declarations are code-owned and never runtime-edited.
2. **Emit events**: inject `EventEmitter2` and `emit(key, payload)` as usual. Nothing else changes for emitters or listeners; `@OnEvent` listeners need no awareness of this module.
3. **Emission recording**: an `onAny` subscriber persists every emission as an `EventEmission` row (event key, JSON-normalized payload, listener count at emission time, timestamp). Undeclared events are recorded too and surface in the catalog query with `declared=false`, so nothing fires invisibly.
4. **Observability**: `GET /event-emitter/events` lists the merged catalog (declared + observed) with listener counts, emission counts, and last emission time; `GET /event-emitter/emissions` returns paginated emission history, filterable by exact event key.

## Assembly conventions

- This module is the sole owner of `EventEmitterModule.forRoot({ wildcard: true })` and re-exports it; do not import a second forRoot in the same application — two `EventEmitter2` instances would exist and listeners attached to one never see emissions on the other.
- Event keys follow `{kebab-module}.{kebab-event}` (e.g. `url-check.down`, `job-scheduler.run-failed`); the wildcard delimiter namespace relies on this convention.
- Payloads are persisted as JSON; emitters should keep payloads JSON-serializable. Unserializable payloads are recorded as a `serializationError` marker object.
- The bus is process-local. Cross-process event delivery is out of scope.
