# Agent instructions

## Module admission criteria

A directory belongs in `packages/modules/` only when all of these hold:

- It carries no host business vocabulary — no consumer entity, status or enum names; configuration and errors stay vendor- or domain-generic.
- Its configuration is declarable through `newbie.module.json` (`config-service` + `env`), so `newbie modules apply` can generate the consumer's config block.
- It is copy-assemblable: the consumer adds the module and injects the service, with no hand-written provider or adapter beyond the ports it documents.
- Anything shaped by one host's domain stays in that host's `src/application/` (e.g. security-evaluation's repository and file ports), not here.

Code hosts are vendor adapters, not host features: `github` and `bitbucket` both live here because each wraps an external API behind a declared config block — how widely one of them is deployed is not an admission test.

## Workflow conventions (见 `user_profile.md` 全文)

- Git 分支：dev 开发，不进 main
- 提交前门禁：`npm run format:check` 必过；禁止裸 `git add -A`
- 本仓是 registry，不发 npm 包；发包在 devbie 统一执行
- 机械 back-port 目标：宿主（如 nightwatch-backend）验证通过后原样复制回本仓，两边 `diff -rq` 为空即完成

## Env facts

可执行操作手册统一在 devbie 仓 `.trae/documents/env-setup.md`。Shell 调用前先读该文件。

## Backlog convention

Unfinished engineering tasks live in the backlog file under .trae/documents (backlog.md). At session end, append leftover tasks there; at session start, check it for pending work. Delete items when done.
