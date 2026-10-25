import { Injectable } from "@nestjs/common";
import { ToolSpecification } from "@modules/llm/chat-model.port";
import { EvaluationEvidenceItem } from "@modules/evaluation/ports/evaluation.contracts";

import { WorkEvaluationEvidenceService } from "./work-evaluation-evidence.service";
import { WorkEvaluationSessionStore } from "./work-evaluation-session.store";
import { createDrillRedactor, redactDeep } from "./work-evaluation-redaction";

/** Upper bound for one tool result, so a single drill-down cannot blow the window. */
const MAX_TOOL_RESULT_CHARS = 20_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_LISTED_RECORDS = 200;
const MAX_SESSION_MESSAGES = 200;

export interface WorkEvaluationToolContext {
  evaluateeUserId: string;
  periodId: string;
  manifest: EvaluationEvidenceItem[];
}

export interface WorkEvaluationToolCallLog {
  name: string;
  arguments: Record<string, unknown>;
  resultChars: number;
  at: string;
}

/**
 * Per-run state held outside the singleton so concurrent judgments cannot
 * corrupt each other's trace or identity tokens.
 */
export interface WorkEvaluationJudgmentRunState {
  calls: WorkEvaluationToolCallLog[];
  /** Identity tokens of the member under evaluation, supplied once per run. */
  identityTokens: Set<string>;
}

/**
 * Read-only tool set for the evaluation agent (ADR-024).
 *
 * Only declared-layer drill-down is offered: session transcripts (ClickHouse)
 * and declared documents (Postgres). Every read is confined to the run's own
 * manifest — an id the manifest does not list is rejected, so a guessed id of
 * another member's material can never be drilled into.
 *
 * Every call is appended to the run state's `calls` — leave a trail rather than
 * trusting a model's claim about what it examined. Nothing here mutates
 * evidence. The service itself is stateless across runs; mutable state lives
 * in {@link WorkEvaluationJudgmentRunState} created by {@link startRun}.
 */
@Injectable()
export class WorkEvaluationJudgmentTools {
  constructor(
    private readonly evidence: WorkEvaluationEvidenceService,
    private readonly sessions: WorkEvaluationSessionStore,
  ) {}

  /**
   * Create a fresh run state. The caller supplies what could re-identify the
   * subject (identity tokens from the subject metadata plus the display name)
   * so the drill-down redactor masks them and the model keeps judging blind.
   */
  startRun(identityTokens: Set<string>): WorkEvaluationJudgmentRunState {
    return { calls: [], identityTokens };
  }

  specifications(): ToolSpecification[] {
    return [
      {
        type: "function",
        function: {
          name: "list_sessions",
          description: "List collected AI-agent sessions (index: turns, tool calls, models, touched files).",
          parameters: { type: "object", properties: {} },
        },
      },
      {
        type: "function",
        function: {
          name: "fetch_session",
          description:
            "Read a session transcript from a sequence offset. Use for judgment, decomposition, tool choice, failure handling.",
          parameters: {
            type: "object",
            properties: {
              sessionId: { type: "string" },
              fromSeq: { type: "number" },
              limit: { type: "number", description: "Max messages, cap 200" },
            },
            required: ["sessionId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_documents",
          description: "List declared work artifacts (declared layer) captured in the period.",
          parameters: { type: "object", properties: {} },
        },
      },
      {
        type: "function",
        function: {
          name: "read_document",
          description: "Read one declared work artifact's content.",
          parameters: {
            type: "object",
            properties: { documentId: { type: "string" } },
            required: ["documentId"],
          },
        },
      },
    ];
  }

  async execute(
    state: WorkEvaluationJudgmentRunState,
    context: WorkEvaluationToolContext,
    name: string,
    rawArguments: string,
  ): Promise<unknown> {
    let args: Record<string, unknown> = {};
    if (rawArguments.trim()) {
      try {
        args = JSON.parse(rawArguments) as Record<string, unknown>;
      } catch {
        return { error: "Arguments were not valid JSON." };
      }
    }

    // Everything the drill-down returns is scrubbed before the model sees it:
    // secrets never leave, and the subject stays a blind id.
    const redacted = redactDeep(await this.dispatch(context, name, args), createDrillRedactor(state.identityTokens));
    const serialized = JSON.stringify(redacted);
    state.calls.push({
      name,
      arguments: args,
      resultChars: serialized.length,
      at: new Date().toISOString(),
    });
    return serialized.length > MAX_TOOL_RESULT_CHARS
      ? {
          truncated: true,
          note: `Result exceeded ${MAX_TOOL_RESULT_CHARS} characters.`,
          preview: truncateText(serialized, MAX_TOOL_RESULT_CHARS),
        }
      : redacted;
  }

  private async dispatch(
    context: WorkEvaluationToolContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (name) {
      case "list_sessions":
        return this.evidence.listSessions({
          evaluateeUserId: context.evaluateeUserId,
          collectionPeriodId: context.periodId,
          page: 0,
          pageSize: MAX_LISTED_RECORDS,
        });
      case "fetch_session":
        return this.fetchSession(
          context,
          String(args.sessionId ?? ""),
          Number(args.fromSeq ?? 0),
          Number(args.limit ?? 100),
        );
      case "list_documents":
        return this.evidence.listDocuments({
          evaluateeUserId: context.evaluateeUserId,
          page: 0,
          pageSize: MAX_LISTED_RECORDS,
        });
      case "read_document":
        return this.readDocument(context, String(args.documentId ?? ""));
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private async fetchSession(context: WorkEvaluationToolContext, sessionId: string, fromSeq: number, limit: number) {
    // Ownership: only sessions that made it into this evaluatee's manifest are
    // readable, so a session id guessed from elsewhere cannot be drilled into.
    if (!context.manifest.some((entry) => entry.id === `session:${sessionId}`)) {
      return { error: "Session is not part of this evaluation's evidence." };
    }
    const safeLimit = Math.min(Math.max(limit || 100, 1), MAX_SESSION_MESSAGES);
    // One extra row tells the caller whether more remained without a second query.
    const rows = await this.sessions.fetchMessages(sessionId, { fromSeq, limit: safeLimit + 1 });
    const visible = rows.slice(0, safeLimit);
    return {
      sessionId,
      fromSeq,
      returned: visible.length,
      truncated: rows.length > safeLimit,
      messages: visible.map((row) => ({
        seq: row.seq,
        role: row.role,
        toolName: row.tool_name,
        content: truncateText(row.content, MAX_MESSAGE_CHARS),
        contentTruncated: row.content.length > MAX_MESSAGE_CHARS,
      })),
    };
  }

  private async readDocument(context: WorkEvaluationToolContext, documentId: string) {
    // Same ownership rule as sessions: drill-down never leaves the manifest.
    if (!context.manifest.some((entry) => entry.id === `document:${documentId}`)) {
      return { error: "Document is not part of this evaluation's evidence." };
    }
    try {
      const document = await this.evidence.getDocument(documentId);
      return {
        ...document,
        content: truncateText(document.content, MAX_TOOL_RESULT_CHARS),
        contentTruncated: document.content.length > MAX_TOOL_RESULT_CHARS,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Truncate at a safe boundary so a surrogate pair is never split. */
function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const lastCode = text.charCodeAt(max - 1);
  const boundary = lastCode >= 0xd800 && lastCode <= 0xdbff ? max - 1 : max;
  return text.slice(0, boundary);
}
