import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ApiKey, Prisma } from "@generated/prisma/client";
import { API_KEY_NOT_FOUND, UNAUTHORIZED_RESOURCE } from "@devbie/newbie/exceptions/errors.constants";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { generateRandomString } from "@devbie/newbie/utilities/random.util";
import { generateHash } from "@devbie/newbie/utilities/common.util";
import { Expose, expose } from "../../helpers/expose";
import { AuditLogService, AuditEvent } from "@modules/audit/audit-log.service";

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
  constructor(
    private prisma: PrismaService,
    private auditLogService: AuditLogService,
  ) {}

  async createApiKey(params: {
    userId: string;
    ipAddress?: string;
    userAgent?: string;
    data: Omit<Prisma.ApiKeyCreateInput, "key" | "secret" | "user">;
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

  async getApiKeysForUser(userId: string, params: ApiKeyListQuery): Promise<Expose<ApiKey>[]> {
    return await this.listApiKeys(userId, params);
  }

  async getApiKeyForUser(userId: string, id: number): Promise<Expose<ApiKey>> {
    return expose<ApiKey>(await this.getOwnedApiKey(userId, id));
  }

  async updateApiKey(userId: string, id: number, data: Prisma.ApiKeyUpdateInput): Promise<Expose<ApiKey>> {
    return await this.updateOwnedApiKey(userId, id, data, { actorId: userId });
  }

  async deleteApiKey(
    userId: string,
    id: number,
    requestContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<Expose<ApiKey>> {
    return await this.deleteOwnedApiKey(userId, id, { ...requestContext, actorId: userId });
  }

  async getApiKeyLogs(userId: string, id: number, params: ApiKeyLogsQuery) {
    return await this.getOwnedApiKeyLogs(userId, id, params);
  }

  private async listApiKeys(userId: string, params: ApiKeyListQuery): Promise<Expose<ApiKey>[]> {
    const { skip, take, cursor, where, orderBy } = params;
    const apiKeys = await this.prisma.apiKey.findMany({
      skip,
      take,
      cursor,
      where: { ...where, user: { id: userId } },
      orderBy,
    });
    return apiKeys.map((apiKey) => expose<ApiKey>(apiKey));
  }

  private async getOwnedApiKey(userId: string, id: number): Promise<ApiKey> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });
    if (!apiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (apiKey.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return apiKey;
  }

  private async updateOwnedApiKey(
    userId: string,
    id: number,
    data: Prisma.ApiKeyUpdateInput,
    attribution?: { actorId?: string },
  ): Promise<Expose<ApiKey>> {
    await this.getOwnedApiKey(userId, id);
    const apiKey = await this.prisma.apiKey.update({
      where: { id },
      data,
    });
    await this.auditLogService.record(AuditEvent.API_KEY_UPDATED, {
      actorId: attribution?.actorId,
      resourceType: "api-key",
      resourceId: String(id),
      // The validation pipe materializes every declared DTO property (as
      // undefined when absent); only fields actually provided were updated.
      detail: { updatedFields: Object.keys(data).filter((field) => data[field] !== undefined) },
    });
    return expose<ApiKey>(apiKey);
  }

  private async deleteOwnedApiKey(
    userId: string,
    id: number,
    attribution?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<Expose<ApiKey>> {
    await this.getOwnedApiKey(userId, id);
    const apiKey = await this.prisma.apiKey.delete({
      where: { id },
    });
    await this.auditLogService.record(AuditEvent.API_KEY_DELETED, {
      actorId: attribution?.actorId,
      resourceType: "api-key",
      resourceId: String(id),
      ipAddress: attribution?.ipAddress,
      userAgent: attribution?.userAgent,
    });
    return expose<ApiKey>(apiKey);
  }

  private async getOwnedApiKeyLogs(userId: string, id: number, params: ApiKeyLogsQuery) {
    const apiKey = await this.getOwnedApiKey(userId, id);
    return await this.getApiLogsFromKey(apiKey.key, params);
  }

  private async getApiLogsFromKey(_apiKey: string, _params: ApiKeyLogsQuery): Promise<Record<string, unknown>[]> {
    // API key usage logs are not wired to a log store yet; return empty until
    // a backend (previously elasticsearch) is integrated again.
    return [];
  }
}
