import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiKey, Prisma } from "@generated/prisma/client";
import { API_KEY_NOT_FOUND, UNAUTHORIZED_RESOURCE } from "@devbie/newbie/exceptions/errors.constants";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { generateRandomString } from "@devbie/newbie/utilities/random.util";
import { Expose, expose } from "../../helpers/expose";
import { LRUCache } from "lru-cache";

@Injectable()
export class ApiKeyService {
  private lru: LRUCache<{}, {}, unknown>;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.lru = new LRUCache({
      maxSize: this.configService.getOrThrow<number>("modules.account.cache.apiKeyLruSize"),
      sizeCalculation: (value, key) => JSON.stringify(value).length,
    });
  }

  async createApiKey(params: {
    userId: string;
    organizationId?: string;
    data: Omit<Omit<Prisma.ApiKeyCreateInput, "key" | "secret">, "user" | "organization">;
  }): Promise<ApiKey> {
    const key = await generateRandomString();
    const secret = await generateRandomString();
    return await this.prisma.apiKey.create({
      data: {
        key,
        secret,
        ...params.data,
        user: { connect: { id: params.userId } },
        organizationId: params.organizationId,
      },
    });
  }

  async getApiKeysForOrganization(
    organizationId: string,
    params: {
      skip?: number;
      take?: number;
      cursor?: Prisma.ApiKeyWhereUniqueInput;
      where?: Prisma.ApiKeyWhereInput;
      orderBy?: Prisma.ApiKeyOrderByWithAggregationInput;
    },
  ): Promise<Expose<ApiKey>[]> {
    const { skip, take, cursor, where, orderBy } = params;
    const apiKey = await this.prisma.apiKey.findMany({
      skip,
      take,
      cursor,
      where: { ...where, organizationId },
      orderBy,
    });
    return apiKey.map((organization) => expose<ApiKey>(organization));
  }

  async getApiKeysForUser(
    userId: string,
    params: {
      skip?: number;
      take?: number;
      cursor?: Prisma.ApiKeyWhereUniqueInput;
      where?: Prisma.ApiKeyWhereInput;
      orderBy?: Prisma.ApiKeyOrderByWithAggregationInput;
    },
  ): Promise<Expose<ApiKey>[]> {
    const { skip, take, cursor, where, orderBy } = params;
    const apiKey = await this.prisma.apiKey.findMany({
      skip,
      take,
      cursor,
      where: { ...where, user: { id: userId }, organizationId: null },
      orderBy,
    });
    return apiKey.map((user) => expose<ApiKey>(user));
  }

  async getApiKeyForOrganization(organizationId: string, id: number): Promise<Expose<ApiKey>> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });
    if (!apiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (apiKey.organizationId !== organizationId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return expose<ApiKey>(apiKey);
  }

  async getApiKeyForUser(userId: string, id: number): Promise<Expose<ApiKey>> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });
    if (!apiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (apiKey.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return expose<ApiKey>(apiKey);
  }

  async getApiKeyFromKey(key: string) {
    if (this.lru.has(key)) return this.lru.get(key);
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { key },
    });
    if (!apiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    this.lru.set(key, apiKey);
    return expose<ApiKey>(apiKey);
  }

  async updateApiKey(userId: string, id: number, data: Prisma.ApiKeyUpdateInput): Promise<Expose<ApiKey>> {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const apiKey = await this.prisma.apiKey.update({
      where: { id },
      data,
    });
    this.lru.delete(testApiKey.key);
    return expose<ApiKey>(apiKey);
  }

  async deleteApiKey(userId: string, id: number): Promise<Expose<ApiKey>> {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const apiKey = await this.prisma.apiKey.delete({
      where: { id },
    });
    this.lru.delete(testApiKey.key);
    return expose<ApiKey>(apiKey);
  }

  async updateApiKeyForOrganization(
    organizationId: string,
    id: number,
    data: Prisma.ApiKeyUpdateInput,
  ): Promise<Expose<ApiKey>> {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.organizationId !== organizationId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const apiKey = await this.prisma.apiKey.update({
      where: { id },
      data,
    });
    this.lru.delete(testApiKey.key);
    return expose<ApiKey>(apiKey);
  }

  async deleteApiKeyForOrganization(organizationId: string, id: number): Promise<Expose<ApiKey>> {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.organizationId !== organizationId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const apiKey = await this.prisma.apiKey.delete({
      where: { id },
    });
    this.lru.delete(testApiKey.key);
    return expose<ApiKey>(apiKey);
  }

  async getApiKeyLogsForOrganization(
    organizationId: string,
    id: number,
    params: {
      take?: number;
      cursor?: { id?: number };
      where?: { after?: string };
    },
  ) {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.organizationId !== organizationId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return await this.getApiLogsFromKey(testApiKey.key, params);
  }
  async getApiKeyLogs(
    userId: string,
    id: number,
    params: {
      take?: number;
      cursor?: { id?: number };
      where?: { after?: string };
    },
  ) {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return await this.getApiLogsFromKey(testApiKey.key, params);
  }

  private async getApiLogsFromKey(
    apiKey: string,
    params: {
      take?: number;
      cursor?: { id?: number };
      where?: { after?: string };
    },
  ): Promise<Record<string, any>[]> {
    // API key usage logs are not wired to a log store yet; return empty until
    // a backend (previously elasticsearch) is integrated again.
    return [];
  }
}
