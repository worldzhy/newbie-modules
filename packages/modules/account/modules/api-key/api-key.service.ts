import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiKey, Prisma } from "@generated/prisma/client";
import { API_KEY_NOT_FOUND, UNAUTHORIZED_RESOURCE } from "@devbie/newbie/exceptions/errors.constants";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { generateRandomString } from "@devbie/newbie/utilities/random.util";
import { generateHash } from "@devbie/newbie/utilities/common.util";
import { Expose, expose } from "../../helpers/expose";
import { AuditLogService, AuditEvent } from "@modules/audit/audit-log.service";
import { LRUCache } from "lru-cache";

/** An API key belongs to either a user (personal key) or an organization. */
type ApiKeyOwner = { userId: string } | { organizationId: string };

type ApiKeyListQuery = {
  skip?: number;
  take?: number;
  cursor?: Prisma.ApiKeyWhereUniqueInput;
  where?: Prisma.ApiKeyWhereInput;
  orderBy?: Prisma.ApiKeyOrderByWithAggregationInput;
};

type ApiKeyLogsQuery = {
  take?: number;
  cursor?: { id?: number };
  where?: { after?: string };
};

@Injectable()
export class ApiKeyService {
  private lru: LRUCache<string, ApiKey>;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private auditLogService: AuditLogService,
  ) {
    // The configured size is the maximum number of cached entries.
    this.lru = new LRUCache<string, ApiKey>({
      max: this.configService.getOrThrow<number>("modules.account.cache.apiKeyLruSize"),
    });
  }

  async createApiKey(params: {
    userId: string;
    organizationId?: string;
    ipAddress?: string;
    userAgent?: string;
    data: Omit<Omit<Prisma.ApiKeyCreateInput, "key" | "secret">, "user" | "organization">;
  }): Promise<Expose<ApiKey> & { secret: string }> {
    const key = await generateRandomString();
    // The plaintext secret is returned to the caller exactly once, on creation.
    const secret = await generateRandomString();
    const apiKey = await this.prisma.apiKey.create({
      data: {
        key,
        secret: await generateHash(secret),
        ...params.data,
        user: { connect: { id: params.userId } },
        organizationId: params.organizationId,
      },
    });
    await this.auditLogService.record(AuditEvent.API_KEY_CREATED, {
      actorId: params.userId,
      resourceType: "api-key",
      resourceId: String(apiKey.id),
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      detail: { description: apiKey.description },
    });
    return { ...expose<ApiKey>({ ...apiKey }), secret };
  }

  async getApiKeysForOrganization(organizationId: string, params: ApiKeyListQuery): Promise<Expose<ApiKey>[]> {
    return await this.listApiKeys({ organizationId }, params);
  }

  async getApiKeysForUser(userId: string, params: ApiKeyListQuery): Promise<Expose<ApiKey>[]> {
    return await this.listApiKeys({ userId }, params);
  }

  async getApiKeyForOrganization(organizationId: string, id: number): Promise<Expose<ApiKey>> {
    return expose<ApiKey>(await this.getOwnedApiKey({ organizationId }, id));
  }

  async getApiKeyForUser(userId: string, id: number): Promise<Expose<ApiKey>> {
    return expose<ApiKey>(await this.getOwnedApiKey({ userId }, id));
  }

  async getApiKeyFromKey(key: string) {
    const cached = this.lru.get(key);
    // expose() mutates its argument, so hand it a copy to keep the cached row intact.
    if (cached) return expose<ApiKey>({ ...cached });
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { key },
    });
    if (!apiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    this.lru.set(key, apiKey);
    return expose<ApiKey>({ ...apiKey });
  }

  async updateApiKey(userId: string, id: number, data: Prisma.ApiKeyUpdateInput): Promise<Expose<ApiKey>> {
    return await this.updateOwnedApiKey({ userId }, id, data);
  }

  async deleteApiKey(
    userId: string,
    id: number,
    requestContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<Expose<ApiKey>> {
    return await this.deleteOwnedApiKey({ userId }, id, requestContext);
  }

  async updateApiKeyForOrganization(
    organizationId: string,
    id: number,
    data: Prisma.ApiKeyUpdateInput,
  ): Promise<Expose<ApiKey>> {
    return await this.updateOwnedApiKey({ organizationId }, id, data);
  }

  async deleteApiKeyForOrganization(organizationId: string, id: number): Promise<Expose<ApiKey>> {
    return await this.deleteOwnedApiKey({ organizationId }, id);
  }

  async getApiKeyLogsForOrganization(organizationId: string, id: number, params: ApiKeyLogsQuery) {
    return await this.getOwnedApiKeyLogs({ organizationId }, id, params);
  }

  async getApiKeyLogs(userId: string, id: number, params: ApiKeyLogsQuery) {
    return await this.getOwnedApiKeyLogs({ userId }, id, params);
  }

  private async listApiKeys(owner: ApiKeyOwner, params: ApiKeyListQuery): Promise<Expose<ApiKey>[]> {
    const { skip, take, cursor, where, orderBy } = params;
    const apiKeys = await this.prisma.apiKey.findMany({
      skip,
      take,
      cursor,
      where: { ...where, ...this.ownerWhere(owner) },
      orderBy,
    });
    return apiKeys.map((apiKey) => expose<ApiKey>(apiKey));
  }

  private async getOwnedApiKey(owner: ApiKeyOwner, id: number): Promise<ApiKey> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });
    if (!apiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    const owned =
      "organizationId" in owner ? apiKey.organizationId === owner.organizationId : apiKey.userId === owner.userId;
    if (!owned) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return apiKey;
  }

  private async updateOwnedApiKey(
    owner: ApiKeyOwner,
    id: number,
    data: Prisma.ApiKeyUpdateInput,
  ): Promise<Expose<ApiKey>> {
    const ownedApiKey = await this.getOwnedApiKey(owner, id);
    const apiKey = await this.prisma.apiKey.update({
      where: { id },
      data,
    });
    this.lru.delete(ownedApiKey.key);
    return expose<ApiKey>(apiKey);
  }

  private async deleteOwnedApiKey(
    owner: ApiKeyOwner,
    id: number,
    requestContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<Expose<ApiKey>> {
    const ownedApiKey = await this.getOwnedApiKey(owner, id);
    const apiKey = await this.prisma.apiKey.delete({
      where: { id },
    });
    this.lru.delete(ownedApiKey.key);
    await this.auditLogService.record(AuditEvent.API_KEY_DELETED, {
      actorId: "organizationId" in owner ? undefined : owner.userId,
      resourceType: "api-key",
      resourceId: String(id),
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
    });
    return expose<ApiKey>(apiKey);
  }

  private async getOwnedApiKeyLogs(owner: ApiKeyOwner, id: number, params: ApiKeyLogsQuery) {
    const apiKey = await this.getOwnedApiKey(owner, id);
    return await this.getApiLogsFromKey(apiKey.key, params);
  }

  private ownerWhere(owner: ApiKeyOwner): Prisma.ApiKeyWhereInput {
    if ("organizationId" in owner) {
      return { organizationId: owner.organizationId };
    }
    // Personal API keys are those without an organization.
    return { user: { id: owner.userId }, organizationId: null };
  }

  private async getApiLogsFromKey(apiKey: string, params: ApiKeyLogsQuery): Promise<Record<string, unknown>[]> {
    // API key usage logs are not wired to a log store yet; return empty until
    // a backend (previously elasticsearch) is integrated again.
    return [];
  }
}
