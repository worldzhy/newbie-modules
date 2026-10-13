import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { ChatModelResolver } from "../chat-model.resolver";
import { ModelCallError } from "../chat-model.port";
import {
  CreateLlmConnectionDto,
  LlmConnectionResponseDto,
  TestLlmConnectionResponseDto,
  UpdateLlmConnectionDto,
} from "./llm-connection.dto";

export type LlmConnectionRecord = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  lastCallAt: Date | null;
  lastCallSuccess: boolean | null;
  lastFailureCategory: string | null;
  lastFailureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * One model-call outcome for the provider-level health fold (ADR-006). Emitted
 * by the ChatModelResolver decorator for every consumer, so health coverage is
 * uniform across all scopes sharing a connection.
 */
export interface ModelCallOutcome {
  /** Persistence id of the LlmConnection the call ran against. */
  connectionId: string;
  success: boolean;
  /** Normalized failure category; present on failure only. */
  errorCategory?: string;
  /** Upstream failure message; present on failure only. */
  errorMessage?: string;
}

const FAILURE_MESSAGE_MAX_LENGTH = 500;
const TEST_TIMEOUT_MS = 15_000;

/**
 * LLM connection configuration (ADR-006). One row = one callable AI endpoint
 * (provider + model + baseUrl + apiKey + health snapshot). Multiple consumer
 * scopes can bind to the same connection via LlmScopeAssignment.
 */
@Injectable()
export class LlmConnectionService {
  private readonly logger = new Logger(LlmConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ChatModelResolver,
  ) {}

  /**
   * Provider-level health fold (fire-and-forget): folds the latest model-call
   * outcome into the connection's current-state snapshot. A success clears the
   * failure fields; a failure records category + capped upstream message. Never
   * throws into the call path: a deleted connection or transient DB error only
   * skips the update.
   */
  recordModelCallOutcome(outcome: ModelCallOutcome): void {
    this.prisma.llmConnection
      .update({
        where: { id: outcome.connectionId },
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
          `Failed to record LLM connection health for ${outcome.connectionId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  async list(): Promise<LlmConnectionResponseDto[]> {
    const records = (await this.prisma.llmConnection.findMany({
      include: { scopes: true },
      orderBy: [{ createdAt: "asc" }],
    })) as Array<LlmConnectionRecord & { scopes: Array<{ scope: string }> }>;
    return records.map((record) => this.toResponse(record));
  }

  async create(dto: CreateLlmConnectionDto): Promise<LlmConnectionResponseDto> {
    const record = (await this.prisma.llmConnection.create({
      data: {
        name: dto.name,
        provider: dto.provider ?? "openai-compatible",
        model: dto.model,
        baseUrl: normalizeBaseUrl(dto.baseUrl ?? ""),
        apiKey: dto.apiKey,
      },
      include: { scopes: true },
    })) as LlmConnectionRecord & { scopes: Array<{ scope: string }> };
    this.logger.log(`LLM connection created: ${record.id} (${record.provider}/${record.model})`);
    return this.toResponse(record);
  }

  async update(id: string, dto: UpdateLlmConnectionDto): Promise<LlmConnectionResponseDto> {
    await this.requireConnection(id);

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

    const record = (await this.prisma.llmConnection.update({
      where: { id },
      data,
      include: { scopes: true },
    })) as LlmConnectionRecord & { scopes: Array<{ scope: string }> };
    this.logger.log(`LLM connection updated: ${id}`);
    return this.toResponse(record);
  }

  async remove(id: string): Promise<LlmConnectionResponseDto> {
    const record = (await this.prisma.llmConnection.delete({
      where: { id },
      include: { scopes: true },
    })) as LlmConnectionRecord & { scopes: Array<{ scope: string }> };
    this.logger.log(`LLM connection deleted: ${id} (was bound by scopes: ${record.scopes.map((s) => s.scope).join(", ") || "none"})`);
    return this.toResponse(record);
  }

  /**
   * Connectivity test through the same adapter path as consumer calls. The
   * health decorator records the outcome, so a failed test updates the health
   * snapshot immediately.
   */
  async test(id: string): Promise<TestLlmConnectionResponseDto> {
    const connection = await this.requireConnection(id);

    // Build a port for this specific connection (bypasses scope resolution),
    // then run a minimal chat completion through it.
    const port = await this.resolver.resolveById(id);
    try {
      await port.complete({
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 1,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      return { success: true, message: "Connection successful." };
    } catch (error) {
      if (error instanceof ModelCallError) {
        return { success: false, message: testFailureMessage(error) };
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`LLM connection test failed for ${connection.id}: ${message}`);
      return { success: false, message };
    }
  }

  /**
   * Resolve which connection a consumer scope is bound to. Used by ChatModelResolver
   * on every call, so binding changes take effect for the next request without a restart.
   */
  async findByScope(scope: string): Promise<LlmConnectionRecord | null> {
    const assignment = await this.prisma.llmScopeAssignment.findUnique({
      where: { scope },
    });
    if (!assignment) return null;
    return (await this.prisma.llmConnection.findUnique({
      where: { id: assignment.connectionId },
    })) as LlmConnectionRecord | null;
  }

  /** Every connection; drives the periodic status probe. */
  async listAll(): Promise<LlmConnectionRecord[]> {
    return (await this.prisma.llmConnection.findMany()) as LlmConnectionRecord[];
  }

  private async requireConnection(id: string): Promise<LlmConnectionRecord> {
    const record = (await this.prisma.llmConnection.findUnique({
      where: { id },
    })) as LlmConnectionRecord | null;
    if (!record) {
      throw new NotFoundException("LLM connection not found.");
    }
    return record;
  }

  private toResponse(record: LlmConnectionRecord & { scopes: Array<{ scope: string }> }): LlmConnectionResponseDto {
    return {
      id: record.id,
      name: record.name,
      provider: record.provider,
      model: record.model,
      baseUrl: record.baseUrl,
      apiKey: maskApiKey(record.apiKey),
      scopes: record.scopes.map((s) => s.scope),
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

/** Maps a ModelCallError from the test call to a user-facing message. */
function testFailureMessage(error: ModelCallError): string {
  switch (error.category) {
    case "timeout":
      return `Connection timed out after ${TEST_TIMEOUT_MS / 1000}s.`;
    case "auth":
      return "Authentication failed: the API key was rejected (401/403).";
    case "rate-limit":
      return "Rate limited by the upstream provider (429); try again later.";
    case "payment":
      return `Payment/quota issue: ${error.message}`;
    case "bad-request":
      return `The upstream provider rejected the request: ${error.message}`;
    default:
      return error.message || "The upstream model API returned an error.";
  }
}
