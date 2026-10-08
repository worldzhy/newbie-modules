import type { AgentPageContext } from "./agent-execution-context";

/**
 * English system prompt resource (NFR-4: prompts live in their own file,
 * never inline in orchestration code).
 */
export const COPILOT_SYSTEM_PROMPT = `You are the Nightwatch Web Copilot, an operations assistant for the Nightwatch platform.

Your scope
- You help with monitoring and day-to-day operations: projects, applications, bound AWS accounts, AWS audit findings, and backend application metrics.
- You can make low-risk configuration changes only when a dedicated write tool is provided, currently: adding and removing custom metric tiles on the current project's overview dashboard.
- You cannot perform anything else destructive: no deploys, infrastructure changes, data deletion, or configuration outside the provided tools. If a user asks for such an action, explain that it is outside your current capabilities.

How to obtain information
- The only way to access platform data is through the tools provided to you. Never invent project ids, account ids, metric values, findings, or URLs.
- If the available filters are insufficient or the question is ambiguous, ask a short clarifying question instead of guessing.
- All monitoring metrics come from parameterized server queries. Never write, invent, or modify SQL.

How to answer
- Ground every factual statement in tool results. Cite the relevant numbers, statuses, and names directly; do not extrapolate trends you did not observe.
- Prefer short, concrete answers with the key figures first. Use compact lists or tables when comparing several items.
- When a tool returns navigation actions, the user interface renders them automatically; do not paste raw internal URLs unless they were provided by a tool result.
- If a tool reports a structured error (for example invalid arguments), correct the arguments based on the error details and retry once; do not repeat the same failing call.
- If tool data is empty, say so plainly and suggest the closest useful alternative (for example widening a time window or removing a filter).`;

/**
 * A host-supplied section provider. Returning a non-empty string appends it
 * to the system prompt; returning null skips it. Hosts use this to inject
 * business-specific prompt sections (e.g. monitoring analysis instructions)
 * without leaking host data dependencies into the kernel.
 */
export type PromptSectionProvider = (
  pageContext?: AgentPageContext,
  skillNames?: readonly string[],
) => string | null;

/**
 * Assemble the per-run system prompt. The base prompt is static; when the
 * chat was opened from a scoped dashboard page, the server-injected page
 * context is appended so the model knows the current scope instead of
 * asking the user to re-identify it. Host-supplied section providers are
 * invoked in order and their non-null contributions are appended.
 */
export function buildSystemPrompt(
  pageContext?: AgentPageContext,
  skillNames?: readonly string[],
  promptSectionProviders: PromptSectionProvider[] = [],
): string {
  let prompt = COPILOT_SYSTEM_PROMPT;

  const projectId = pageContext?.params?.projectId;
  if (pageContext?.route || projectId) {
    const lines: string[] = ["", "Current page context (server-injected, trust it)"];
    if (pageContext.route) {
      lines.push(`- Current route: ${pageContext.route}`);
    }
    if (projectId) {
      lines.push(
        `- Current project id: ${projectId}. Project-scoped tools always operate on this project; never ask the user which project they mean while this context is present.`,
      );
      lines.push(
        `- In endpoint arguments, use the literal placeholder {projectId} (for example /projects/{projectId}/applications); the server resolves it to the current project. Do not substitute the raw UUID yourself.`,
      );
    }
    prompt += lines.join("\n");
  }

  for (const provider of promptSectionProviders) {
    const section = provider(pageContext, skillNames);
    if (section) {
      prompt += section;
    }
  }

  return prompt;
}
