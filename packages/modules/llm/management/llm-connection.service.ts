import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { CreateLlmConnectionDto, LlmConnectionResponseDto, UpdateLlmConnectionDto } from "./llm-connection.dto";
import { decryptApiKey, encryptApiKey, fingerprintApiKey, isEncryptedApiKey } from "./llm-api-key";

/**
 * Decrypted connection shape handed to consumers. `apiKey` is always plaintext
 * here; encrypted rows are unwrapped at the service boundary.
 */
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

/** Raw Prisma row: `apiKey` may still be ciphertext, plus the credential digest. */
type LlmConnectionRow = LlmConnectionRecord & {
  apiKeyFingerprint: string | null;
  scopes: Array<{ scope: string }>;
};

type LlmConnectionBareRow = LlmConnectionRecord & {
  apiKeyFingerprint: string | null;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Encryption secret for stored API keys. A dedicated LLM_API_KEY_SECRET is
   * preferred; the fallback reuses the refresh-token secret every deployment
   * already sets, so encrypting keys needs no new deployment step. Rotation
   * makes existing ciphertext unreadable — admins re-enter the affected keys.
   */
  private requireApiKeySecret(): string {
    const secret = this.configService.get<string>("modules.llm.apiKeySecret");
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException(
        "LLM API key encryption is not configured: set LLM_API_KEY_SECRET (at least 32 characters).",
      );
    }
    return secret;
  }

  /** Unwraps an encrypted `apiKey`; legacy plaintext rows pass through. */
  private decryptRow<T extends { apiKey: string }>(row: T): T {
    if (!isEncryptedApiKey(row.apiKey)) {
      return row;
    }
    return { ...row, apiKey: decryptApiKey(row.apiKey, this.requireApiKeySecret()) };
  }

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
    })) as LlmConnectionRow[];
    return records.map((record) => this.toResponse(this.decryptRow(record)));
  }

  async create(dto: CreateLlmConnectionDto): Promise<LlmConnectionResponseDto> {
    const baseUrl = normalizeBaseUrl(dto.baseUrl ?? "");
    const apiKeyFingerprint = fingerprintApiKey(dto.apiKey);
    await this.requireEndpointAvailable(baseUrl, dto.apiKey, apiKeyFingerprint);

    let record: LlmConnectionRow;
    try {
      record = (await this.prisma.llmConnection.create({
        data: {
          name: dto.name,
          provider: dto.provider ?? "openai-compatible",
          model: dto.model,
          baseUrl,
          apiKey: encryptApiKey(this.requireApiKeySecret(), dto.apiKey),
          apiKeyFingerprint,
        },
        include: { scopes: true },
      })) as LlmConnectionRow;
    } catch (error) {
      rethrowUniqueAsConflict(error);
    }
    this.logger.log(`LLM connection created: ${record.id} (${record.provider}/${record.model})`);
    return this.toResponse(this.decryptRow(record));
  }

  async update(id: string, dto: UpdateLlmConnectionDto): Promise<LlmConnectionResponseDto> {
    const existing = await this.requireConnection(id);

    // The masked placeholder from a GET response must never overwrite the
    // stored secret. Match against the exact mask derived from the stored key
    // rather than a substring heuristic: a genuine key that happens to contain
    // "****" is then still accepted instead of being silently discarded.
    const changes: { name?: string; provider?: string; model?: string; baseUrl?: string; apiKey?: string } = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.provider !== undefined) changes.provider = dto.provider;
    if (dto.model !== undefined) changes.model = dto.model;
    if (dto.baseUrl !== undefined) changes.baseUrl = normalizeBaseUrl(dto.baseUrl);
    if (dto.apiKey !== undefined && dto.apiKey !== maskApiKey(existing.apiKey)) {
      changes.apiKey = dto.apiKey;
    }

    // Changing the baseUrl while keeping the stored key can collide with
    // another row just as much as changing the key itself.
    const effectiveBaseUrl = changes.baseUrl ?? existing.baseUrl;
    const effectiveApiKey = changes.apiKey ?? existing.apiKey;
    const effectiveFingerprint =
      changes.apiKey !== undefined
        ? fingerprintApiKey(changes.apiKey)
        : (existing.apiKeyFingerprint ?? fingerprintApiKey(existing.apiKey));
    await this.requireEndpointAvailable(effectiveBaseUrl, effectiveApiKey, effectiveFingerprint, id);

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
    if (changes.apiKey !== undefined) {
      data.apiKey = encryptApiKey(this.requireApiKeySecret(), changes.apiKey);
      data.apiKeyFingerprint = effectiveFingerprint;
    }
    if (endpointChanged) {
      data.lastCallAt = null;
      data.lastCallSuccess = null;
      data.lastFailureCategory = null;
      data.lastFailureMessage = null;
    }

    let record: LlmConnectionRow;
    try {
      record = (await this.prisma.llmConnection.update({
        where: { id },
        data,
        include: { scopes: true },
      })) as LlmConnectionRow;
    } catch (error) {
      rethrowUniqueAsConflict(error);
    }
    this.logger.log(`LLM connection updated: ${id}`);
    return this.toResponse(this.decryptRow(record));
  }

  async remove(id: string): Promise<LlmConnectionResponseDto> {
    // Fail before the delete if the stored key cannot be unwrapped, so a
    // misconfigured secret never removes a row it then cannot report on.
    await this.requireConnection(id);
    const record = (await this.prisma.llmConnection.delete({
      where: { id },
      include: { scopes: true },
    })) as LlmConnectionRow;
    this.logger.log(
      `LLM connection deleted: ${id} (was bound by scopes: ${record.scopes.map((s) => s.scope).join(", ") || "none"})`,
    );
    return this.toResponse(this.decryptRow(record));
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
    const connection = (await this.prisma.llmConnection.findUnique({
      where: { id: assignment.connectionId },
    })) as LlmConnectionBareRow | null;
    return connection === null ? null : this.decryptRow(connection);
  }

  /** Every connection; drives the periodic status probe. */
  async listAll(): Promise<LlmConnectionRecord[]> {
    const rows = (await this.prisma.llmConnection.findMany()) as LlmConnectionBareRow[];
    return rows.map((row) => this.decryptRow(row));
  }

  /**
   * Resolves the API key a connection test should use. The edit form echoes
   * the masked value while the stored key is unchanged; such an echo resolves
   * to the stored key of the referenced connection instead of the placeholder
   * itself. The comparison is exact against the mask derived from the stored
   * key, so a real key containing "****" is never mistaken for an echo.
   */
  async resolveTestApiKey(id: string | undefined, submittedApiKey: string): Promise<string> {
    if (!id) {
      if (submittedApiKey.includes("****")) {
        throw new BadRequestException(
          "A masked API key can only be tested against an existing connection (id required).",
        );
      }
      return submittedApiKey;
    }
    const connection = await this.requireConnection(id);
    return submittedApiKey === maskApiKey(connection.apiKey) ? connection.apiKey : submittedApiKey;
  }

  private async requireConnection(id: string): Promise<LlmConnectionBareRow> {
    const record = (await this.prisma.llmConnection.findUnique({
      where: { id },
    })) as LlmConnectionBareRow | null;
    if (!record) {
      throw new NotFoundException("LLM connection not found.");
    }
    return this.decryptRow(record);
  }

  /**
   * Pre-write guard for the (baseUrl, apiKey) unique invariant: gives clients
   * a deterministic 409 instead of a raw database error. The stored key is
   * ciphertext (random IV), so the invariant compares the plaintext
   * fingerprint; `apiKey` additionally matches legacy plaintext rows. The
   * unique index stays the source of truth for concurrent writes, handled
   * via P2002.
   */
  private async requireEndpointAvailable(
    baseUrl: string,
    apiKey: string,
    apiKeyFingerprint: string,
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.llmConnection.findFirst({
      where: {
        baseUrl,
        OR: [{ apiKeyFingerprint }, { apiKey }],
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
