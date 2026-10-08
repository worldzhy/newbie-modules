import { z } from "zod";
import type { AgentExecutionContext } from "./agent-execution-context";
import type { CopilotSkillBlock, SkillAction } from "./agent-events";

/**
 * Skill v2 contract for the Copilot kernel.
 *
 * A skill is a code-registered, typed capability with explicit access and
 * confirmation classifications. `confirmation: "never"` skills run directly;
 * `"always"` skills suspend the run behind an in-run approval gate
 * (confirm-required event -> POST /copilot/chat/confirm -> resume) before
 * their handler is invoked (FR-13..FR-15).
 */
export type SkillAccess = "read" | "write";
export type SkillConfirmation = "never" | "always";

/**
 * Sentinel page id marking a skill offered on pages without a route mapping
 * (General context), e.g. the home page. Only genuinely cross-project
 * capabilities should declare it.
 */
export const GENERAL_PAGE_ROUTE = "*";

/** High-level shape hint used for timeline summaries and catalog metadata. */
export type SkillResultKind = "list" | "detail" | "stats";

export interface SkillResultSchemaHint {
  kind: SkillResultKind;
  /** One-line English description of what the structured payload contains. */
  description: string;
}

export interface SkillResult {
  /** Short factual summary the model can use when composing its answer. */
  content?: string;
  /** Full structured payload rendered by the transport as a result card. */
  structured?: unknown;
  /** Navigational actions; skills emit href data only, never UI markup. */
  actions?: SkillAction[];
  /**
   * Optional structured blocks for transport rendering (chart/table/query).
   * Populated only by skills that declare producesBlocks=true; the runner
   * moves them to tool-finished events in Task 3.
   */
  blocks?: CopilotSkillBlock[];
}

export interface SkillDefinition<TInput = unknown> {
  /** Lower snake_case identifier; also the model-facing tool name. */
  name: string;
  /** English description shown to the model and to the catalog UI. */
  description: string;
  /** Zod schema; converted to JSON Schema at registration. */
  inputSchema: z.ZodType<TInput>;
  access: SkillAccess;
  confirmation: SkillConfirmation;
  transports: AgentExecutionContext["transport"][];
  resultHint: SkillResultSchemaHint;
  /**
   * Allow-list of route identifiers where this skill is offered in the
   * catalog. A GENERAL_PAGE_ROUTE entry marks pages without a mapping (e.g.
   * the home page). Absent means the skill is offered on no page.
   */
  pages?: string[];
  /**
   * Opt-in: the skill returns CopilotSkillBlock[] in its result, and the
   * runner forwards them (bounded, redacted) on the tool-finished event
   * (FR-7). Skills without this marker never emit blocks.
   */
  producesBlocks?: boolean;
  handler(context: AgentExecutionContext, input: TInput): Promise<SkillResult> | SkillResult;
}

/** Catalog-facing metadata (FR-20), dynamically derived from registrations. */
export interface SkillCatalogEntry {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  resultHint: SkillResultSchemaHint;
  pages?: string[];
}
