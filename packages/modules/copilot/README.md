# newbie.copilot

Copilot capability module: protocol-neutral agent kernel (AgentRunner, skill
registry, conversation store, confirmation manager), ChatModelPort adapter
set (openai-compatible + anthropic via the shared Vercel AI SDK factory),
model-management CRUD service/controller, and audit logger.

## Scope

Included:
- `kernel/` — framework-free agent loop, ports, conversation store, skills
  registry, audit sink, system prompt, redaction, blocks.
- `model/adapters/` — the only directory that imports the `ai` core package.
  Concrete adapters import their provider package
  (@ai-sdk/openai-compatible, @ai-sdk/anthropic) and hand the constructed
  LanguageModel to `createSdkChatModel`.
- `model/active-chat-model.resolver.ts` — reads the active CopilotModel record
  on every run and routes it to the matching adapter.
- `model/management/` — CopilotModel CRUD service + controller + DTO + provider
  constants. PrismaService comes from `@devbie/newbie/prisma`.
- `observability/copilot-audit.logger.ts` — bridges the framework-free kernel
  audit seam to Nest's Logger.
- `prisma/schema.prisma` — CopilotModel table under `@@schema("module/copilot")`.

Excluded (host-owned):
- Web transport (SSE) — uses `req.user.userId` host auth.
- Lark transport — assembles LarkBot webhook → kernel; depends on lark-bot
  module wiring chosen by the host.
- Skill definitions — host business skills + data services.

## Wiring

The host `application/copilot/copilot.module.ts` imports this module and
provides `AgentRunner` + `SkillRegistry` via its own `useFactory`, injecting
`COPILOT_SKILL_DEFINITIONS` (host skill list) and `CopilotAuditLogger`
(exported here). Transports inject `ActiveChatModelResolver`, `AgentRunner`,
`SkillRegistry`, `CONVERSATION_STORE`, `CONFIRMATION_MANAGER` from this module.
