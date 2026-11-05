# newbie-modules

Registry of backend modules consumed by [`@devbie/newbie-cli`](https://www.npmjs.com/package/@devbie/newbie-cli). A consumer project pulls a module with `npx newbie modules add <key>`, which copies the module directory into `src/modules/<key>` and wires it into the app.

```
packages/modules/<key>/
├── newbie.module.json     # manifest — the module's contract
├── src/                   # NestJS sources, `@modules/<key>` import root
│   ├── <key>.module.ts
│   └── ...
├── prisma/schema.prisma   # optional model fragment
└── cli/index.ts           # optional `newbie <namespace>` command
```

Admission criteria for a directory under `packages/modules/` live in [AGENTS.md](AGENTS.md).

## Manifest structure

`newbie.module.json` is the single source of truth for a module's wiring. The CLI validates it with a **strict whitelist**: an unknown top-level or nested field is a hard error, never silently ignored.

Top-level keys, in canonical order:

| Key          | Domain     | Purpose                                                                                             |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------- |
| `key`        | identity   | Module key; matches the directory name and the `@modules/<key>` alias.                              |
| `layer`      | identity   | `datastore` \| `infrastructure` \| `capability` \| `feature`. Absent for framework-special modules. |
| `wiring`     | functional | NestJS entry point, Prisma fragment, CLI namespace.                                                 |
| `collector`  | metadata   | Participation in the collector protocol and the companion SDK.                                      |
| `requires`   | functional | Registry module deps, env vars, config block, npm packages.                                         |
| `deprecated` | metadata   | End-of-life notice; when present the module is hidden from the picker and refused for new installs. |

### `wiring`

| Field          | Type    | Meaning                                                                                                                                                                                         |
| -------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`         | string  | NestJS module file without extension, e.g. `"account.module"`.                                                                                                                                  |
| `className`    | string  | Exported NestJS module class, e.g. `"AccountModule"`.                                                                                                                                           |
| `prismaSchema` | string? | Project-relative path of the Prisma model fragment. Absent when the module has no models.                                                                                                       |
| `newbieCli`    | string? | CLI namespace. When declared, `newbie modules apply` loads `<modulesDir>/<key>/cli/index.ts` and registers its `register(parent, options)` export, producing `newbie <namespace> <subcommand>`. |

### `requires`

| Field             | Type      | Meaning                                                                                                                                                                               |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules`         | string[]? | Other registry keys this module imports as `@modules/<key>`. Drives topological ordering and installer conflict checks.                                                               |
| `env`             | object?   | Environment variables. A value is either a string sample or `{ type, example, description }` (ADR-033). Samples go to `.env` / `.env.example`; they are never runtime defaults.       |
| `config`          | object?   | Config block injected into the consumer's config service. May reference `process.env.<VAR>`; every referenced variable must also be declared in `env` (bidirectional guard, ADR-033). |
| `dependencies`    | object?   | Runtime npm packages copied into the consumer's `package.json`.                                                                                                                       |
| `devDependencies` | object?   | Dev-only npm packages.                                                                                                                                                                |

### `collector`

| Field     | Type           | Meaning                                                                                                                                                       |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `peerSdk` | string \| null | Package name of the SDK that ships this module's side of the collector protocol. `null` means the receiver exists but its companion SDK is not published yet. |

The module on this side is always the **receiver**; `peerSdk` names the counterpart SDK. A module that does not take part in the collector protocol **omits `collector` entirely** — there is no `role` field, because receiver is the only implicit role.

### Example

```json
{
  "key": "health",
  "layer": "capability",
  "wiring": {
    "file": "health.module",
    "className": "HealthModule",
    "prismaSchema": "prisma/schema.prisma"
  },
  "collector": {
    "peerSdk": "@devbie/health-sdk"
  },
  "requires": {
    "modules": ["audit", "security"],
    "env": {
      "HEALTH_PROBE_TIMEOUT_MS": { "type": "number", "example": 3000 }
    }
  }
}
```

### Invariants

- Keys appear in the canonical order shown above; the JSON is what the registry ships, so keep it prettier-clean (`npm run format`).
- Empty child objects and arrays are omitted. `"dependencies": {}` is not written.
- `config` and `env` stay consistent: a `process.env.X` reference without a matching `env` declaration fails the CLI guard.
- Install, update and assembly all read the same manifest — no second declaration file.

## Commands

```sh
npx newbie modules              # interactive picker
npx newbie modules add <key>    # install a module into the consumer project
npx newbie modules update <key> # refresh one installed module from the registry
```
