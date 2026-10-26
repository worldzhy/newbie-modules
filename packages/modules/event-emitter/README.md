# event-emitter

General-purpose in-process event bus with an event catalog and emission history. Emitting modules define their event contracts as pure data (`<module>.events.ts`); the host decides which contracts to activate, injects `EventEmitter2` into its own listeners, and the module records every emission so operators can see which events exist, who listens, and what actually fired.

## Working model

1. **Define contracts (module side)**: an emitting module ships a `<module>.events.ts` with the event key constant, a typed payload interface, and a `defineEvent<Payload>({ key, name?, description?, payloadExample? })` declaration. The file is pure data — nothing self-registers, so importing it has no side effects.
2. **Activate declarations (host side)**: the host imports the declaration arrays of the modules it wants (`<module>EventDeclarations`) and calls `EventCatalogService.declareEvent(...)` for each at startup. A host that prefers polling over events simply skips the import. Duplicate keys throw. The catalog lives in memory — declarations are code-owned and never runtime-edited.
3. **Emit events**: emitters inject `EventEmitter2` and `emit(key, payload)` as usual, keeping payloads in sync with their contract interface via `satisfies`. Nothing changes for listeners; `@OnEvent` listeners need no awareness of this module.
4. **Emission recording**: an `onAny` subscriber persists every emission as an `EventEmission` row (event key, JSON-normalized payload, listener count at emission time, timestamp). Undeclared events are recorded too and surface in the catalog query with `declared=false`, so nothing fires invisibly.
5. **Observability**: `GET /event-emitter/events` lists the merged catalog (declared + observed) with listener counts, emission counts, and last emission time; `GET /event-emitter/emissions` returns paginated emission history, filterable by exact event key.

## Assembly conventions

- This module is the sole owner of `EventEmitterModule.forRoot({ wildcard: true })` and re-exports it; do not import a second forRoot in the same application — two `EventEmitter2` instances would exist and listeners attached to one never see emissions on the other.
- Event keys follow `{kebab-module}.{kebab-event}` (e.g. `url-check.down`, `job-scheduler.run-failed`); the wildcard delimiter namespace relies on this convention.
- Payloads are persisted as JSON; emitters should keep payloads JSON-serializable. Unserializable payloads are recorded as a `serializationError` marker object.
- The bus is process-local. Cross-process event delivery is out of scope.
