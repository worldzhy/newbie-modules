import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  ActivateLlmModelResponseDto,
  CreateLlmModelDto,
  LlmModelResponseDto,
  TestLlmModelResponseDto,
  UpdateLlmModelDto,
} from "./llm-model.dto";
import { ANTHROPIC_PROVIDER, ANTHROPIC_API_VERSION, DEFAULT_ANTHROPIC_BASE_URL } from "./llm-providers";

export type LlmModelRecord = {
  id: string;
  scope: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  lastCallAt: Date | null;
  lastCallSuccess: boolean | null;
  lastFailureCategory: string | null;
  lastFailureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * One model-call outcome for the provider-level health fold. Emitted by the
 * ChatModelResolver decorator for every consumer, so health coverage is
 * uniform across scopes (ADR-005).
 */
export interface ModelCallOutcome {
  /** Persistence id of the model record the call ran against. */
  modelRecordId: string;
  success: boolean;
  /** Normalized failure category; present on failure only. */
  errorCategory?: string;
  /** Upstream failure message; present on failure only. */
  errorMessage?: string;
}

const PING_TIMEOUT_MS = 10_000;
const FAILURE_MESSAGE_MAX_LENGTH = 500;

/**
 * Unified LLM model configuration. Records describe a wire protocol plus
 * credentials scoped to one consumer; the active record for a scope is turned
 * into a ChatModelPort by ChatModelResolver on every call.
 */
@Injectable()
export class LlmModelService {
  private readonly logger = new Logger(LlmModelService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Provider-level health fold (fire-and-forget, ADR-005): folds the latest
   * model-call outcome into the record's current-state snapshot. A success
   * clears the failure fields; a failure records category + capped upstream
   * message. Never throws into the call path: a deleted record or transient
   * DB error only skips the update.
   */
  recordModelCallOutcome(outcome: ModelCallOutcome): void {
    this.prisma.llmModel
      .update({
        where: { id: outcome.modelRecordId },
        data: outcome.success
          ? {
              lastCallAt: new Date(),
              lastCallSuccess: true,
              lastFailureCategory: null,
              lastFailureMessage: null,
            }
          : {
              lastCallAt: new Date(),
              lastCallSuccess: false,
              lastFailureCategory: outcome.errorCategory ?? "upstream",
              lastFailureMessage: outcome.errorMessage
                ? outcome.errorMessage.slice(0, FAILURE_MESSAGE_MAX_LENGTH)
                : null,
            },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to record LLM model health for ${outcome.modelRecordId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  async list(): Promise<LlmModelResponseDto[]> {
    const records = (await this.prisma.llmModel.findMany({
      orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
    })) as LlmModelRecord[];
    return records.map((record) => this.toResponse(record));
  }

  async create(dto: CreateLlmModelDto): Promise<LlmModelResponseDto> {
    const record = (await this.prisma.llmModel.create({
      data: {
        scope: dto.scope,
        name: dto.name,
        provider: dto.provider ?? "openai-compatible",
        model: dto.model,
        // Anthropic records may omit baseUrl; the column is NOT NULL, so an
        // empty string means "use the adapter's default official endpoint".
        baseUrl: normalizeBaseUrl(dto.baseUrl ?? ""),
        apiKey: dto.apiKey,
        isActive: false,
      },
    })) as LlmModelRecord;
    this.logger.log(`LLM model created: ${record.id} (scope=${record.scope}, ${record.provider}/${record.model})`);
    return this.toResponse(record);
  }

  async update(id: string, dto: UpdateLlmModelDto): Promise<LlmModelResponseDto> {
    await this.requireRecord(id);

    // The masked placeholder from a GET response must never overwrite the
    // stored secret. Clients keep the key unchanged by echoing it back.
    const data: Record<string, string> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.model !== undefined) data.model = dto.model;
    if (dto.baseUrl !== undefined) data.baseUrl = normalizeBaseUrl(dto.baseUrl);
    if (dto.apiKey !== undefined && !dto.apiKey.includes("****")) {
      data.apiKey = dto.apiKey;
    }

    const record = (await this.prisma.llmModel.update({
      where: { id },
      data,
    })) as LlmModelRecord;
    this.logger.log(`LLM model updated: ${id}`);
    return this.toResponse(record);
  }

  async remove(id: string): Promise<LlmModelResponseDto> {
    const record = await this.requireRecord(id);
    if (record.isActive) {
      throw new ConflictException(
        `The active LLM model for scope "${record.scope}" cannot be deleted; activate another model first.`,
      );
    }
    await this.prisma.llmModel.delete({ where: { id } });
    this.logger.log(`LLM model deleted: ${id}`);
    return this.toResponse(record);
  }

  async activate(id: string): Promise<ActivateLlmModelResponseDto> {
    const record = await this.requireRecord(id);

    // Clear the active flag within the record's own scope first, then set the
    // target. The per-scope partial unique index is the structural backstop.
    await this.prisma.$transaction([
      this.prisma.llmModel.updateMany({
        where: { scope: record.scope, isActive: true },
        data: { isActive: false },
      }),
      this.prisma.llmModel.update({ where: { id }, data: { isActive: true } }),
    ]);
    this.logger.log(`LLM active model for scope "${record.scope}" switched to: ${id}`);
    return { success: true, activeModelId: id };
  }

  async test(id: string): Promise<TestLlmModelResponseDto> {
    const record = await this.requireRecord(id);
    const result = await this.ping(record);
    if (!result.success) {
      this.logger.warn(`LLM model connectivity test failed for ${record.id}: ${result.message}`);
    }
    return result;
  }

  /**
   * Used by ChatModelResolver on every call, so switching the active model in
   * the admin UI takes effect for the next request without a restart.
   */
  async getActive(scope: string): Promise<LlmModelRecord | null> {
    return (await this.prisma.llmModel.findFirst({
      where: { scope, isActive: true },
    })) as LlmModelRecord | null;
  }

  /** Every active record across all scopes; drives the periodic status probe. */
  async listActive(): Promise<LlmModelRecord[]> {
    return (await this.prisma.llmModel.findMany({
      where: { isActive: true },
    })) as LlmModelRecord[];
  }

  private async requireRecord(id: string): Promise<LlmModelRecord> {
    const record = (await this.prisma.llmModel.findUnique({
      where: { id },
    })) as LlmModelRecord | null;
    if (!record) {
      throw new NotFoundException("LLM model not found.");
    }
    return record;
  }

  private async ping(record: LlmModelRecord): Promise<TestLlmModelResponseDto> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    try {
      const response = await fetch(this.pingEndpoint(record), {
        method: "POST",
        headers: this.pingHeaders(record),
        body: JSON.stringify(this.pingBody(record)),
        signal: controller.signal,
      });
      return await evaluatePingResponse(response);
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error && error.name === "AbortError"
            ? `Connection timed out after ${PING_TIMEOUT_MS / 1000}s.`
            : `Network error: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private pingEndpoint(record: LlmModelRecord): string {
    if (record.provider === ANTHROPIC_PROVIDER) {
      const baseUrl = normalizeBaseUrl(record.baseUrl) || DEFAULT_ANTHROPIC_BASE_URL;
      return `${baseUrl}/v1/messages`;
    }
    return `${record.baseUrl}/chat/completions`;
  }

  private pingHeaders(record: LlmModelRecord): Record<string, string> {
    if (record.provider === ANTHROPIC_PROVIDER) {
      return {
        "Content-Type": "application/json",
        "x-api-key": record.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      };
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${record.apiKey}`,
    };
  }

  private pingBody(record: LlmModelRecord): unknown {
    if (record.provider === ANTHROPIC_PROVIDER) {
      return {
        model: record.model,
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      };
    }
    return {
      model: record.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    };
  }

  private toResponse(record: LlmModelRecord): LlmModelResponseDto {
    return {
      id: record.id,
      scope: record.scope,
      name: record.name,
      provider: record.provider,
      model: record.model,
      baseUrl: record.baseUrl,
      apiKey: maskApiKey(record.apiKey),
      isActive: record.isActive,
      lastCallAt: record.lastCallAt,
      lastCallSuccess: record.lastCallSuccess,
      lastFailureCategory: record.lastFailureCategory,
      lastFailureMessage: record.lastFailureMessage,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) {
    return "****";
  }
  return `${apiKey.slice(0, 3)}****${apiKey.slice(-4)}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

/**
 * Maps a ping response to a user-facing result. The status-code policy is
 * shared across protocols; both OpenAI-style and Anthropic error envelopes
 * expose their message under `error.message`, which safeReadErrorDetail reads.
 */
async function evaluatePingResponse(response: Response): Promise<TestLlmModelResponseDto> {
  if (response.ok) {
    return { success: true, message: "Connection successful." };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      success: false,
      message: "Authentication failed: the API key was rejected (401/403).",
    };
  }
  if (response.status === 429) {
    return {
      success: false,
      message: "Rate limited by the upstream provider (429); try again later.",
    };
  }
  const detail = await safeReadErrorDetail(response);
  return {
    success: false,
    message: `Upstream returned HTTP ${response.status}${detail ? `: ${detail}` : ""}.`,
  };
}

async function safeReadErrorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body) {
      const upstreamError = (body as { error?: unknown }).error;
      if (typeof upstreamError === "string") return upstreamError;
      if (upstreamError && typeof upstreamError === "object") {
        const message = (upstreamError as { message?: unknown }).message;
        if (typeof message === "string") return message;
      }
    }
    return "";
  } catch {
    return "";
  }
}
