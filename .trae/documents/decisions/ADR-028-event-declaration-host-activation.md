# ADR-028: Event declarations — host activation, typed contracts, and module-owned event files

Status: Adopted
Date: 2026-10-26

> Replaces D2 of ADR-025 only; ADR-025 D1 (module forRoot wiring) and D3 (frontend page) remain valid.

## Background

ADR-025 D2 specified that emitting modules call `declareEvent` at startup via `EventCatalogService`. This was implemented and shipped for all 7 emitting modules, but the design was challenged after delivery:

- The host may choose not to consume an event at all (e.g. polling instead of reacting to a push event), so wiring the declaration into the emitter's `onModuleInit` removes host choice.
- `declareEvent` hard-codes the event key and payload shape inside the emitter, creating a dual-truth problem: the key lives in the emitter's source, but the host's listener also hard-codes the same key — there is no single artifact that both sides can import.
- `payloadExample` is an `unknown` object in the catalog; a drift between the example and the real emit-site payload is only discoverable at runtime.

The user explicitly invalidated ADR-025 D2 ("ADR 2025, I did not review it carefully. That document does not count."). This ADR restarts the decision from first principles.

## Candidate solutions

1. **Emitter self-declares (ADR-025 D2, retracted)**. Modules inject `EventCatalogService` and call `declareEvent` in `onModuleInit`. Host has no compile-time choice.
2. **Host copies**. Host writes its own `declareEvent` calls, duplicating key / name / description / payloadExample from the emitter. Gives host choice, but duplicates data and still has no compile-time payload guard.
3. **Pure runtime capture**. No declarations at all; `onAny` logs everything and the catalog is just observed keys. Loses the "which events should exist" baseline and human metadata.
4. **Typed contract file + host activation** (chosen). Each module ships a `<module>.events.ts` file containing:
   - the event key as a `const string`,
   - a typed `interface` for the payload,
   - a `defineEvent<Payload>({ key, name, description, payloadExample })` declaration that binds the generic to the interface.
   The host imports whichever declaration arrays it wants and activates them in its own `onModuleInit`.
5. **Implicit reflection scan**. A host-side scanner auto-discovers `*.events.ts` files at build time. Rejected: discovery is implicit, not verifiable by reading a single registration site, and couples the framework to the file system.
6. **Static JSON manifest**. A JSON file replaces `defineEvent`. Rejected: loses compile-time type binding; payload drift risk remains.

## Decision

Choose **4**.

### Why 4 is better than 1–3 and 5–6

- **Host choice without duplication**: the host decides which events are active by importing the module's declaration array (or not). The contract is authored once in the module, not copied.
- **Compile-time payload guard**: `defineEvent<Payload>` makes `payloadExample` type-checked against the interface. The emitter can then use `satisfies Payload` at the `emit` call site, closing the loop between declaration and emission.
- **Explicit and verifiable**: activation is a single `for (const d of declarations) catalog.declareEvent(d)` in host code; no file-system magic.
- **Preserves the emission-history baseline**: declared events still provide the "should exist" catalog; undeclared emissions still surface as `declared=false`.

### Why the job-scheduler analogy does not apply

The `scheduled-jobs` pattern (host centralizes `JobScheduleDeclaration` in `scheduled-jobs.module.ts`) is not analogous because the job *identity* (key, cron, handler mapping) is 100% host-owned — the module knows nothing about any job key. In contrast, the event *identity* (key + payload shape) is defined by the module that emits it; the host only decides whether to subscribe/activate. Moving the declaration into a host-side copy would create dual truth on the key and payload, which is exactly the problem this ADR solves.

## Specification

### Module side (registry)

For every emitting module, create a `<module>.events.ts` at the module root (or, for submodules, next to the emitting service). The file exports:

```typescript
export const SOME_EVENT_KEY = "module-name.event-name";

export interface SomeEventPayload {
  field: string;
}

const SOME_EVENT = defineEvent<SomeEventPayload>({
  key: SOME_EVENT_KEY,
  name: "Human name",
  description: "What triggers it.",
  payloadExample: { field: "example" },
});

export const moduleNameEventDeclarations = [SOME_EVENT];
```

Rules:
- The file is pure data — no `Injectable`, no `EventCatalogService`, no side effects.
- The emitter service imports the key and payload interface from this file, removes its `EventCatalogService` dependency and `onModuleInit` declaration block, and adds `satisfies SomeEventPayload` to the `emit` call.
- No compatibility shim (re-exporting the old constants from the service) is left behind.

### Host side (nightwatch-backend)

Create `src/application/event-declarations/event-declarations.module.ts` + `event-declarations.service.ts`. The service imports the declaration arrays of the modules the host wants:

```typescript
import { urlCheckEventDeclarations } from "@modules/url-check/url-check.events";
import { taskManagementEventDeclarations } from "@modules/task-management/task-management.events";
// ... etc
```

In `onModuleInit`, iterate and call `this.eventCatalog.declareEvent(d)` for each.

`ApplicationModule` imports `EventDeclarationsModule` after `EventEmitterModule` (which is provided by the `event-emitter` module).

### `defineEvent<Payload>`

An identity function in `event-emitter/event-definition.ts`:

```typescript
export function defineEvent<Payload>(
  declaration: EventDeclaration<Payload>,
): EventDeclaration<Payload> {
  return declaration;
}
```

Its only purpose is to bind the generic so that `payloadExample` is compile-checked. Zero runtime cost.

## Cross-host / evolution check

| Dimension | Framework (this module) | Host (implementation) |
|---|---|---|
| Contract authoring | Module ships `<module>.events.ts` with key + payload interface + `defineEvent` | Host reads and selectively imports |
| Activation | `EventCatalogService.declareEvent` API | Host calls it for the subset it wants |
| Type safety | `defineEvent<Payload>` + `satisfies Payload` at emit site | Host listener can import the same interface for its handler signature |
| No-event host | Not applicable | Host simply does not import the module's declaration array; the event still fires and is recorded as `declared=false` |

## Impact

- Easier: host can deactivate an event by removing one import line; payload drift is caught at compile time; event contracts are single-source.
- Harder: one extra file per emitting module; host must maintain the activation list.
- Registry modules changed: `event-emitter`, `url-check`, `task-management`, `aws-audit`, `dependency-scan`, `job-scheduler`, `threat-intelligence`, `web-monitor`.
- Host files changed: `application.module.ts`, new `event-declarations/` directory, listener import updates for events that were previously imported from services.

## Supersedes

- ADR-025 § D2 "消费方契约" (emitter self-declaration via `EventCatalogService` in `onModuleInit`).
