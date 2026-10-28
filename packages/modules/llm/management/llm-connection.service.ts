import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { CreateLlmConnectionDto, LlmConnectionResponseDto, UpdateLlmConnectionDto } from "./llm-connection.dto";

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
const PG_UNIQUE_VIOLATION = "P2002";
const DUPLICATE_ENDPOINT_MESSAGE = "A connection with this API key already exists for the given endpoint.";

/**
 * LLM connection configuration (ADR-006). One row = one upstream credential
 * (provider + baseUrl + apiKey) plus the model it currently serves. The
 * credential tuple is a uniqueness invariant, not the row identity: the id is
 * stable, so scopes keep their binding while the key or model is edited.
 */
@Injectable()
export class LlmConnectionService {
  private readonly logger = new Logger(LlmConnectionService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    const baseUrl = normalizeBaseUrl(dto.baseUrl ?? "");
    await this.requireEndpointAvailable(baseUrl, dto.apiKey);

    let record: LlmConnectionRecord & { scopes: Array<{ scope: string }> };
    try {
      record = (await this.prisma.llmConnection.create({
        data: {
          name: dto.name,
          provider: dto.provider ?? "openai-compatible",
          model: dto.model,
          baseUrl,
          apiKey: dto.apiKey,
        },
        include: { scopes: true },
      })) as LlmConnectionRecord & { scopes: Array<{ scope: string }> };
    } catch (error) {
      rethrowUniqueAsConflict(error);
    }
    this.logger.log(`LLM connection created: ${record.id} (${record.provider}/${record.model})`);
    return this.toResponse(record);
  }

  async update(id: string, dto: UpdateLlmConnectionDto): Promise<LlmConnectionResponseDto> {
    const existing = await this.requireConnection(id);

    // The masked placeholder from a GET response must never overwrite the
    // stored secret. Clients keep the key unchanged by echoing it back.
    const changes: { name?: string; provider?: string; model?: string; baseUrl?: string; apiKey?: string } = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.provider !== undefined) changes.provider = dto.provider;
    if (dto.model !== undefined) changes.model = dto.model;
    if (dto.baseUrl !== undefined) changes.baseUrl = normalizeBaseUrl(dto.baseUrl);
    if (dto.apiKey !== undefined && !dto.apiKey.includes("****")) {
      changes.apiKey = dto.apiKey;
    }

    // Changing the baseUrl while keeping the stored key can collide with
    // another row just as much as changing the key itself.
    const effectiveBaseUrl = changes.baseUrl ?? existing.baseUrl;
    const effectiveApiKey = changes.apiKey ?? existing.apiKey;
    await this.requireEndpointAvailable(effectiveBaseUrl, effectiveApiKey, id);

    // The health snapshot describes the endpoint that produced it. Once any
    // endpoint-defining field changes, the snapshot belongs to a configuration
    // that no longer exists, so reset it to "never called" instead of letting
    // the status dot attribute the old outcome to the new endpoint. A rename
    // alone keeps the snapshot.
    const endpointChanged =
      (changes.provider !== undefined && changes.provider !== existing.provider) ||
      (changes.model !== undefined && changes.model !== existing.model) ||
      (changes.baseUrl !== undefined && changes.baseUrl !== existing.baseUrl) ||
      (changes.apiKey !== undefined && changes.apiKey !== existing.apiKey);

    const data: Prisma.LlmConnectionUpdateInput = { ...changes };
    if (endpointChanged) {
      data.lastCallAt = null;
      data.lastCallSuccess = null;
      data.lastFailureCategory = null;
      data.lastFailureMessage = null;
    }

    let record: LlmConnectionRecord & { scopes: Array<{ scope: string }> };
    try {
      record = (await this.prisma.llmConnection.update({
        where: { id },
        data,
        include: { scopes: true },
      })) as LlmConnectionRecord & { scopes: Array<{ scope: string }> };
    } catch (error) {
      rethrowUniqueAsConflict(error);
    }
    this.logger.log(`LLM connection updated: ${id}`);
    return this.toResponse(record);
  }

  async remove(id: string): Promise<LlmConnectionResponseDto> {
    const record = (await this.prisma.llmConnection.delete({
      where: { id },
      include: { scopes: true },
    })) as LlmConnectionRecord & { scopes: Array<{ scope: string }> };
    this.logger.log(
      `LLM connection deleted: ${id} (was bound by scopes: ${record.scopes.map((s) => s.scope).join(", ") || "none"})`,
    );
    return this.toResponse(record);
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

  /**
   * Resolves the API key a connection test should use. The edit form echoes
   * the masked value while the stored key is unchanged; such an echo resolves
   * to the stored key of the referenced connection instead of the placeholder
   * itself.
   */
  async resolveTestApiKey(id: string | undefined, submittedApiKey: string): Promise<string> {
    if (!submittedApiKey.includes("****")) {
      return submittedApiKey;
    }
    if (!id) {
      throw new BadRequestException(
        "A masked API key can only be tested against an existing connection (id required).",
      );
    }
    return (await this.requireConnection(id)).apiKey;
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

  /**
   * Pre-write guard for the (baseUrl, apiKey) unique invariant: gives clients
   * a deterministic 409 instead of a raw database error. The unique index
   * stays the source of truth for concurrent writes, handled via P2002.
   */
  private async requireEndpointAvailable(baseUrl: string, apiKey: string, excludeId?: string): Promise<void> {
    const duplicate = await this.prisma.llmConnection.findFirst({
      where: {
        baseUrl,
        apiKey,
        ...(excludeId !== undefined ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(DUPLICATE_ENDPOINT_MESSAGE);
    }
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

/**
 * Race-window fallback when two concurrent writes pass the pre-check: the
 * database unique index rejects one of them as Prisma P2002.
 */
function rethrowUniqueAsConflict(error: unknown): never {
  if ((error as { code?: string } | null)?.code === PG_UNIQUE_VIOLATION) {
    throw new ConflictException(DUPLICATE_ENDPOINT_MESSAGE);
  }
  throw error;
}
