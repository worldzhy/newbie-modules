# newbie.copilot

Copilot capability module: protocol-neutral agent kernel (AgentRunner, skill
registry, conversation store, confirmation manager) and audit logger. The
unified LLM model provider (ChatModelPort, adapters, scoped model registry,
health) lives in the `llm` module (ADR-005); copilot is one of its consumers
under the hardcoded scope `"copilot"`.

## Scope

Included:
- `kernel/` — framework-free agent loop, conversation store, skills registry,
  audit sink, system prompt, redaction, blocks. Model access goes through the
  `ChatModelPort` interface imported from `@modules/llm/chat-model.port`.
- `observability/copilot-audit.logger.ts` — bridges the framework-free kernel
  audit seam to Nest's Logger.

Excluded (host-owned):
- Web transport (SSE) — uses `req.user.userId` host auth.
- Lark transport — assembles LarkBot webhook → kernel; depends on lark-bot
  module wiring chosen by the host.
- Skill definitions — host business skills + data services.

## Wiring

The host `application/copilot/copilot.module.ts` imports this module and
provides `AgentRunner` + `SkillRegistry` via its own `useFactory`, injecting
`COPILOT_SKILL_DEFINITIONS` (host skill list) and `CopilotAuditLogger`
(exported here). Transports inject `ChatModelResolver` (from the `llm`
module), `AgentRunner`, `SkillRegistry`, `CONVERSATION_STORE`,
`CONFIRMATION_MANAGER` (from this module).
