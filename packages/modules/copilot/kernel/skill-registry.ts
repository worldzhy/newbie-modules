import { z } from "zod";
import { SKILL_TIMEOUT_MS } from "./agent-config";
import type { AgentExecutionContext } from "./agent-execution-context";
import type { CopilotSkillBlock, SkillAction } from "./agent-events";
import type { CopilotAuditSink, SkillAuditStatus } from "./audit-sink";
import { NOOP_AUDIT_SINK } from "./audit-sink";
import { summarizeBlocks } from "./blocks";
import { summarizeForLog } from "./redaction";
import { GENERAL_PAGE_ROUTE, type SkillCatalogEntry, type SkillDefinition, type SkillResult, type SkillResultKind } from
  "./skill";
import type { ToolSpecification } from "./chat-model.port";

/** Minimal logging seam so the kernel never imports NestJS logging types. */
export interface KernelLogger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
}

const CONSOLE_LOGGER: KernelLogger = {
  error: (message, meta) => console.error(message, meta ?? ""),
  warn: (message, meta) => console.warn(message, meta ?? ""),
  info: (message, meta) => console.log(message, meta ?? ""),
};

/** Structured outcome of a skill invocation, always fed back as a tool result. */
export type SkillEnvelope =
  | { ok: true; result: SkillResult }
  | {
      ok: false;
      error: {
        code: "unknown_skill" | "invalid_arguments" | "skill_failed" | "skill_timeout" | "aborted";
        message: string;
        issues?: Array<{ path: string; message: string }>;
      };
    };

export interface SkillExecution {
  envelope: SkillEnvelope;
  durationMs: number;
  actions: SkillAction[];
  /** Declared result shape from the skill definition when it ran. */
  kind?: SkillResultKind;
  /**
   * UI-only blocks returned by the handler (FR-6). Kept out of the
   * model-facing envelope; the runner forwards them to tool-finished.
   */
  blocks?: CopilotSkillBlock[];
}

export interface RejectedRegistration {
  name: string;
  reason: string;
}

const SKILL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Identity parameters are server-injected via AgentExecutionContext and may
 * never travel through model-produced tool arguments (FR-11, TR-3.2).
 */
const FORBIDDEN_IDENTITY_KEYS = new Set(["userid", "chatid", "conversationid", "requestid"]);

interface RegisteredSkill {
  definition: SkillDefinition;
  jsonSchema: Record<string, unknown>;
}

/**
 * Code-based skill registry. Validates every declaration at registration
 * time (FR-15). Both confirmation modes are admitted: `never` skills run
 * directly, `always` skills are gated by the AgentRunner's in-run
 * confirmation manager (suspend -> confirm-required event -> resume) before
 * their handler is ever invoked.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly rejected: RejectedRegistration[] = [];
  private readonly logger: KernelLogger;
  private readonly auditSink: CopilotAuditSink;

  constructor(
    definitions: SkillDefinition[] = [],
    logger: KernelLogger = CONSOLE_LOGGER,
    auditSink: CopilotAuditSink = NOOP_AUDIT_SINK,
  ) {
    this.logger = logger;
    this.auditSink = auditSink;
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition: SkillDefinition): boolean {
    const name = definition?.name;

    if (typeof name !== "string" || !SKILL_NAME_PATTERN.test(name)) {
      return this.reject(name ?? "<unnamed>", `Invalid skill name; expected ${SKILL_NAME_PATTERN}`);
    }
    if (this.skills.has(name)) {
      return this.reject(name, "Duplicate skill name");
    }
    if (!definition.description?.trim()) {
      return this.reject(name, "Skill description is required");
    }
    if (!definition.transports?.length) {
      return this.reject(name, "Skill must declare at least one transport");
    }
    let jsonSchema: Record<string, unknown>;
    try {
      jsonSchema = z.toJSONSchema(definition.inputSchema) as Record<string, unknown>;
    } catch (error) {
      return this.reject(name, `Input schema is not convertible to JSON Schema: ${String(error)}`);
    }

    const forbiddenKey = findForbiddenIdentityKey(jsonSchema);
    if (forbiddenKey) {
      return this.reject(
        name,
        `Input schema must not declare identity field "${forbiddenKey}"; identity is server-injected`,
      );
    }

    this.skills.set(name, { definition, jsonSchema });
    this.logger.info?.(`Copilot skill registered: ${name}`);
    return true;
  }

  getRejectedRegistrations(): readonly RejectedRegistration[] {
    return this.rejected;
  }

  list(): SkillCatalogEntry[] {
    return [...this.skills.values()].map(({ definition, jsonSchema }) => ({
      name: definition.name,
      description: definition.description,
      parameters: jsonSchema,
      resultHint: definition.resultHint,
      ...(definition.pages ? { pages: definition.pages } : {}),
    }));
  }

  /** All entries declared for a transport, ignoring page scoping. */
  listAllFor(transport: AgentExecutionContext["transport"]): SkillCatalogEntry[] {
    return this.list().filter((entry) => {
      const registered = this.skills.get(entry.name);
      return registered ? registered.definition.transports.includes(transport) : false;
    });
  }

  listFor(transport: AgentExecutionContext["transport"], route?: string): SkillCatalogEntry[] {
    // Fail-closed: a skill is offered only when its pages list names the
    // current route. A request without route is a General page, so only
    // skills declaring the General sentinel are offered.
    const pageId = route ?? GENERAL_PAGE_ROUTE;
    return this.list().filter((entry) => {
      const registered = this.skills.get(entry.name);
      if (!registered || !registered.definition.transports.includes(transport)) return false;
      return registered.definition.pages?.includes(pageId) ?? false;
    });
  }

  toolSpecificationsFor(transport: AgentExecutionContext["transport"]): ToolSpecification[] {
    return this.list()
      .filter((entry) => this.skills.get(entry.name)?.definition.transports.includes(transport))
      .map((entry) => ({
        type: "function",
        function: {
          name: entry.name,
          description: entry.description,
          parameters: entry.parameters,
        },
      }));
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  /** True when the skill's handler must wait for an in-run user approval. */
  requiresConfirmation(name: string): boolean {
    return this.skills.get(name)?.definition.confirmation === "always";
  }

  /** Declared result shape, used to summarize envelopes the runner synthesizes. */
  resultKind(name: string): SkillResultKind | undefined {
    return this.skills.get(name)?.definition.resultHint.kind;
  }

  /** Opt-in marker: only declared skills get their blocks forwarded to events (FR-7). */
  producesBlocks(name: string): boolean {
    return this.skills.get(name)?.definition.producesBlocks === true;
  }

  /**
   * Runs every pre-handler check (existence, abort, JSON, schema). Validation
   * failures are audited once and returned as a finished execution, identical
   * to execute(); success exposes the validated data for the runner to gate
   * on a confirmation before invoking the handler (FR-14, AC-6, FR-29).
   */
  prepare(
    context: AgentExecutionContext,
    name: string,
    rawJson: string,
    startedAt: number = Date.now(),
  ): { ready: true; data: unknown; startedAt: number } | { ready: false; execution: SkillExecution } {
    if (!this.skills.get(name)) {
      return {
        ready: false,
        execution: this.auditAndFinish(context, name, rawJson, startedAt, {
          ok: false,
          error: {
            code: "unknown_skill",
            message: `Unknown skill "${name}". Call one of the provided skills; do not invent skill names.`,
          },
        }),
      };
    }

    if (context.signal.aborted) {
      return {
        ready: false,
        execution: this.auditAndFinish(context, name, rawJson, startedAt, {
          ok: false,
          error: { code: "aborted", message: "The run was cancelled before the skill executed." },
        }),
      };
    }

    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(rawJson);
    } catch {
      return {
        ready: false,
        execution: this.auditAndFinish(context, name, rawJson, startedAt, {
          ok: false,
          error: {
            code: "invalid_arguments",
            message: "The skill arguments must be a JSON object; fix them and retry.",
            issues: [{ path: "", message: "Arguments are not valid JSON." }],
          },
        }),
      };
    }

    const registered = this.skills.get(name)!;
    const parsed = registered.definition.inputSchema.safeParse(parsedArguments);
    if (!parsed.success) {
      return {
        ready: false,
        execution: this.auditAndFinish(context, name, parsedArguments, startedAt, {
          ok: false,
          error: {
            code: "invalid_arguments",
            message: "The skill arguments did not match the declared schema; fix them and retry.",
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        }),
      };
    }

    return { ready: true, data: parsed.data, startedAt };
  }

  /**
   * Invokes the handler for arguments that already passed prepare(). The
   * runner calls this directly, either immediately (confirmation=never) or
   * after a confirmed approval (confirmation=always). Every invocation is
   * emitted to the audit sink exactly once (FR-29).
   */
  async executePrepared(
    context: AgentExecutionContext,
    name: string,
    data: unknown,
    startedAt: number,
  ): Promise<SkillExecution> {
    const registered = this.skills.get(name);
    if (!registered) {
      return this.auditAndFinish(context, name, data, startedAt, {
        ok: false,
        error: { code: "unknown_skill", message: `Unknown skill "${name}".` },
      });
    }

    if (context.signal.aborted) {
      return this.auditAndFinish(context, name, data, startedAt, {
        ok: false,
        error: { code: "aborted", message: "The run was cancelled before the skill executed." },
      });
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort("skill-timeout"), SKILL_TIMEOUT_MS);
    const onAbort = () => timeoutController.abort(context.signal.reason);
    context.signal.addEventListener("abort", onAbort, { once: true });

    try {
      const result = await Promise.race([
        Promise.resolve(registered.definition.handler(context, data)),
        new Promise<never>((_, reject) =>
          timeoutController.signal.addEventListener("abort", () => {
            if (timeoutController.signal.reason === "skill-timeout") {
              reject(new SkillTimeoutError());
            } else {
              reject(new SkillAbortedError());
            }
          }),
        ),
      ]);
      // Blocks are a UI-only projection of the same data the model already
      // receives via structured; they ride on SkillExecution (forwarded to
      // tool-finished events by the runner) and never re-enter the model loop.
      const normalized: SkillResult = {
        ...(result.content !== undefined ? { content: result.content } : {}),
        ...(result.structured !== undefined ? { structured: result.structured } : {}),
        ...(result.actions?.length ? { actions: result.actions } : {}),
      };
      return this.auditAndFinish(
        context,
        name,
        data,
        startedAt,
        { ok: true, result: normalized },
        normalized.actions ?? [],
        registered.definition.resultHint.kind,
        result.blocks?.length ? result.blocks : undefined,
      );
    } catch (error) {
      if (error instanceof SkillTimeoutError) {
        return this.auditAndFinish(context, name, data, startedAt, {
          ok: false,
          error: {
            code: "skill_timeout",
            message: `The skill timed out after ${SKILL_TIMEOUT_MS / 1000}s. Narrow the request and retry.`,
          },
        });
      }
      if (error instanceof SkillAbortedError || context.signal.aborted) {
        return this.auditAndFinish(context, name, data, startedAt, {
          ok: false,
          error: { code: "aborted", message: "The run was cancelled." },
        });
      }
      this.logger.error(`Copilot skill "${name}" failed`, {
        requestId: context.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.auditAndFinish(context, name, data, startedAt, {
        ok: false,
        error: {
          code: "skill_failed",
          message: `The skill failed while executing: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Convenience path used by tests and non-gated callers: validate then run.
   * The handler is never invoked when arguments fail validation; the
   * structured envelope lets the model self-correct in its next turn (AC-6).
   */
  async execute(context: AgentExecutionContext, name: string, rawJson: string): Promise<SkillExecution> {
    const prepared = this.prepare(context, name, rawJson);
    if (!prepared.ready) return prepared.execution;
    return this.executePrepared(context, name, prepared.data, prepared.startedAt);
  }

  private auditAndFinish(
    context: AgentExecutionContext,
    name: string,
    rawArguments: unknown,
    startedAt: number,
    envelope: SkillEnvelope,
    actions: SkillAction[] = [],
    kind?: SkillResultKind,
    blocks?: CopilotSkillBlock[],
  ): SkillExecution {
    const execution = this.finish(startedAt, envelope, actions, kind, blocks);
    this.auditSink.record({
      category: "copilot.skill_call",
      requestId: context.requestId,
      conversationId: context.conversationId,
      userId: context.userId,
      skillName: name,
      argumentSummary: summarizeForLog(rawArguments),
      status: this.statusFromEnvelope(envelope),
      durationMs: execution.durationMs,
      // FR-7: audit records only the block summary, never the payloads.
      ...(blocks?.length ? { blocksSummary: summarizeBlocks(blocks) } : {}),
    });
    return execution;
  }

  private statusFromEnvelope(envelope: SkillEnvelope): SkillAuditStatus {
    return envelope.ok ? "success" : envelope.error.code;
  }

  private finish(
    startedAt: number,
    envelope: SkillEnvelope,
    actions: SkillAction[] = [],
    kind?: SkillResultKind,
    blocks?: CopilotSkillBlock[],
  ): SkillExecution {
    return {
      envelope,
      durationMs: Date.now() - startedAt,
      actions,
      ...(kind ? { kind } : {}),
      ...(blocks ? { blocks } : {}),
    };
  }

  private reject(name: string, reason: string): false {
    this.rejected.push({ name, reason });
    this.logger.error(`Copilot skill rejected at registration: ${name}`, { reason });
    return false;
  }
}

class SkillTimeoutError extends Error {}
class SkillAbortedError extends Error {}

function findForbiddenIdentityKey(schema: unknown): string | null {
  if (!schema || typeof schema !== "object") return null;
  const node = schema as Record<string, unknown>;

  if (node.type === "object" && node.properties && typeof node.properties === "object") {
    for (const [key, child] of Object.entries(node.properties as Record<string, unknown>)) {
      if (FORBIDDEN_IDENTITY_KEYS.has(key.toLowerCase())) return key;
      const nested = findForbiddenIdentityKey(child);
      if (nested) return nested;
    }
  }

  const children: unknown[] = [];
  if (node.items) {
    children.push(node.items);
  }
  for (const combinator of ["anyOf", "allOf", "oneOf"]) {
    if (Array.isArray(node[combinator])) children.push(...(node[combinator] as unknown[]));
  }
  for (const child of children) {
    const found = findForbiddenIdentityKey(child);
    if (found) return found;
  }
  return null;
}
