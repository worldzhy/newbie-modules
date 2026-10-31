# Agent instructions

## Module admission criteria

A directory belongs in `packages/modules/` only when all of these hold:

- It carries no host business vocabulary — no consumer entity, status or enum names; configuration and errors stay vendor- or domain-generic.
- Its configuration is declarable through `newbie.module.json` (`config-service` + `env`), so `newbie modules apply` can generate the consumer's config block.
- It is copy-assemblable: the consumer adds the module and injects the service, with no hand-written provider or adapter beyond the ports it documents.
- Anything shaped by one host's domain stays in that host's `src/application/` (e.g. security-evaluation's repository and file ports), not here.

Code hosts are vendor adapters, not host features: `github` and `bitbucket` both live here because each wraps an external API behind a declared config block — how widely one of them is deployed is not an admission test.

## Backlog convention

Unfinished engineering tasks live in the backlog file under .trae/documents (backlog.md). At session end, append leftover tasks there; at session start, check it for pending work. Delete items when done.
