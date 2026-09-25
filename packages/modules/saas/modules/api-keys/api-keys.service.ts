import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {Prisma} from '@prisma/client';
import {ApiKey} from '@prisma/client';
import {
  API_KEY_NOT_FOUND,
  UNAUTHORIZED_RESOURCE,
} from '../../errors/errors.constants';
import {
  teamOwnerScopes,
  userScopes,
  userScopesCustomized,
  teamMemberScopesCustomized,
} from '../../helpers/scopes';
import {Expose} from '../../helpers/interfaces';
import {expose} from '../../helpers/expose';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {generateRandomString} from '@devbie/newbie/utilities/random.util';
import {ElasticsearchService} from '@modules/elasticsearch/elasticsearch.service';
import {LRUCache} from 'lru-cache';

@Injectable()
export class ApiKeysService {
  private lru;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private elasticsearch: ElasticsearchService
  ) {
    this.lru = new LRUCache({
      maxSize: this.configService.getOrThrow<number>(
        'modules.saas.cache.apiKeyLruSize'
      ),
    });
  }

  async createApiKeyForTeam(
    teamId: number,
    userId: number,
    data: Omit<Omit<Prisma.ApiKeyCreateInput, 'apiKey'>, 'team'>
  ): Promise<ApiKey> {
    const apiKey = await generateRandomString();
    data.scopes = await this.cleanScopesForTeam(teamId, data.scopes);
    return this.prisma.apiKey.create({
      data: {
        ...data,
        apiKey,
        team: {connect: {id: teamId}},
        user: {connect: {id: userId}},
      },
    });
  }

  async createApiKeyForUser(
    userId: number,
    data: Omit<Omit<Prisma.ApiKeyCreateInput, 'apiKey'>, 'user'>
  ): Promise<ApiKey> {
    const apiKey = await generateRandomString();
    data.scopes = await this.cleanScopesForUser(userId, data.scopes);
    return this.prisma.apiKey.create({
      data: {...data, apiKey, user: {connect: {id: userId}}},
    });
  }

  async getApiKeysForTeam(
    teamId: number,
    params: {
      skip?: number;
      take?: number;
      cursor?: Prisma.ApiKeyWhereUniqueInput;
      where?: Prisma.ApiKeyWhereInput;
      orderBy?: Prisma.ApiKeyOrderByWithAggregationInput;
    }
  ): Promise<Expose<ApiKey>[]> {
    const {skip, take, cursor, where, orderBy} = params;
    try {
      const apiKey = await this.prisma.apiKey.findMany({
        skip,
        take,
        cursor,
        where: {...where, team: {id: teamId}},
        orderBy,
      });
      return apiKey.map(team => expose<ApiKey>(team));
    } catch (error) {
      return [];
    }
  }

  async getApiKeysForUser(
    userId: number,
    params: {
      skip?: number;
      take?: number;
      cursor?: Prisma.ApiKeyWhereUniqueInput;
      where?: Prisma.ApiKeyWhereInput;
      orderBy?: Prisma.ApiKeyOrderByWithAggregationInput;
    }
  ): Promise<Expose<ApiKey>[]> {
    const {skip, take, cursor, where, orderBy} = params;
    try {
      const apiKey = await this.prisma.apiKey.findMany({
        skip,
        take,
        cursor,
        where: {...where, user: {id: userId}, teamId: null},
        orderBy,
      });
      return apiKey.map(user => expose<ApiKey>(user));
    } catch (error) {
      return [];
    }
  }

  async getApiKeyForTeam(teamId: number, id: number): Promise<Expose<ApiKey>> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: {id},
    });
    if (!apiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (apiKey.teamId !== teamId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return expose<ApiKey>(apiKey);
  }

  async getApiKeyForUser(userId: number, id: number): Promise<Expose<ApiKey>> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: {id},
    });
    if (!apiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (apiKey.userId !== userId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return expose<ApiKey>(apiKey);
  }

  async getApiKeyFromKey(key: string): Promise<Expose<ApiKey>> {
    if (this.lru.has(key)) return this.lru.get(key);
    const apiKey = await this.prisma.apiKey.findFirst({
      where: {apiKey: key},
    });
    if (!apiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    this.lru.set(key, apiKey);
    return expose<ApiKey>(apiKey);
  }

  async updateApiKeyForTeam(
    teamId: number,
    id: number,
    data: Prisma.ApiKeyUpdateInput
  ): Promise<Expose<ApiKey>> {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: {id},
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.teamId !== teamId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    data.scopes = await this.cleanScopesForTeam(teamId, data.scopes);
    const apiKey = await this.prisma.apiKey.update({
      where: {id},
      data,
    });
    this.lru.delete(testApiKey.apiKey);
    return expose<ApiKey>(apiKey);
  }

  async updateApiKeyForUser(
    userId: number,
    id: number,
    data: Prisma.ApiKeyUpdateInput
  ): Promise<Expose<ApiKey>> {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: {id},
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.userId !== userId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    data.scopes = await this.cleanScopesForUser(userId, data.scopes);
    const apiKey = await this.prisma.apiKey.update({
      where: {id},
      data,
    });
    this.lru.delete(testApiKey.apiKey);
    return expose<ApiKey>(apiKey);
  }

  async replaceApiKeyForTeam(
    teamId: number,
    id: number,
    data: Prisma.ApiKeyCreateInput
  ): Promise<Expose<ApiKey>> {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: {id},
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.teamId !== teamId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    data.scopes = await this.cleanScopesForTeam(teamId, data.scopes);
    const apiKey = await this.prisma.apiKey.update({
      where: {id},
      data,
    });
    this.lru.delete(testApiKey.apiKey);
    return expose<ApiKey>(apiKey);
  }
  async replaceApiKeyForUser(
    userId: number,
    id: number,
    data: Prisma.ApiKeyCreateInput
  ): Promise<Expose<ApiKey>> {
    const testApiKey = await this.prisma.apiKey.findUniqueOrThrow({
      where: {id},
    });

    if (testApiKey.userId !== userId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    data.scopes = await this.cleanScopesForUser(userId, data.scopes);
    const apiKey = await this.prisma.apiKey.update({
      where: {id},
      data,
    });
    this.lru.delete(testApiKey.apiKey);
    return expose<ApiKey>(apiKey);
  }

  async deleteApiKeyForTeam(
    teamId: number,
    id: number
  ): Promise<Expose<ApiKey>> {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: {id},
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.teamId !== teamId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const apiKey = await this.prisma.apiKey.delete({
      where: {id},
    });
    this.lru.delete(testApiKey.apiKey);
    return expose<ApiKey>(apiKey);
  }
  async deleteApiKeyForUser(
    userId: number,
    id: number
  ): Promise<Expose<ApiKey>> {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: {id},
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.userId !== userId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const apiKey = await this.prisma.apiKey.delete({
      where: {id},
    });
    this.lru.delete(testApiKey.apiKey);
    return expose<ApiKey>(apiKey);
  }

  async getApiKeyLogsForTeam(
    teamId: number,
    id: number,
    params: {
      take?: number;
      cursor?: {id?: number};
      where?: {after?: string};
    }
  ) {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: {id},
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.teamId !== teamId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return this.getApiLogsFromKey(testApiKey.apiKey, params);
  }
  async getApiKeyLogsForUser(
    userId: number,
    id: number,
    params: {
      take?: number;
      cursor?: {id?: number};
      where?: {after?: string};
    }
  ) {
    const testApiKey = await this.prisma.apiKey.findUnique({
      where: {id},
    });
    if (!testApiKey) throw new NotFoundException(API_KEY_NOT_FOUND);
    if (testApiKey.userId !== userId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return this.getApiLogsFromKey(testApiKey.apiKey, params);
  }

  /**
   * Remove any unauthorized scopes in an API key for a user
   * This should run when a user's permissions have changed, for example
   * if they are removed from a team; this will remove any API scopes
   * they don't have access to anymore from that API key
   */
  async removeUnauthorizedScopesForUser(userId: number): Promise<void> {
    const userApiKeys = await this.prisma.apiKey.findMany({
      where: {user: {id: userId}},
    });
    if (!userApiKeys.length) return;
    const scopesAllowed = await this.getApiKeyScopesForUser(userId);
    for await (const apiKey of userApiKeys) {
      const currentScopes = (apiKey.scopes ?? []) as string[];
      const newScopes = currentScopes.filter(i =>
        Object.keys(scopesAllowed).includes(i)
      );
      if (currentScopes.length !== newScopes.length)
        this.prisma.apiKey.update({
          where: {id: apiKey.id},
          data: {scopes: newScopes},
        });
    }
  }

  private async getApiLogsFromKey(
    apiKey: string,
    params: {
      take?: number;
      cursor?: {id?: number};
      where?: {after?: string};
    }
  ): Promise<Record<string, any>[]> {
    const now = new Date();
    now.setDate(
      now.getDate() -
        this.configService.getOrThrow<number>(
          'modules.saas.tracking.deleteOldLogsDays'
        )
    );
    const result = await this.elasticsearch.search({
      index: this.configService.get<string>(
        'modules.saas.tracking.index'
      ),
      from: params.cursor?.id,
      body: {
        query: {
          bool: {
            must: [
              {match: {authorization: apiKey}},
              {
                range: {
                  date: {
                    gte: params.where?.after
                      ? new Date(
                          new Date().getTime() -
                            new Date(params.where?.after).getTime()
                        )
                      : now,
                  },
                },
              },
            ],
          },
        },
        sort: [{date: {order: 'desc'}}],
        size: params.take ?? 100,
      },
    });
    if (result) {
      try {
        return result.body.hits.hits.map(
          (item: {
            _index: string;
            _type: '_doc';
            _id: string;
            _score: any;
            _source: Record<string, any>;
          }) => ({...item._source, id: item._id})
        );
      } catch (error) {}
    }

    return [];
  }

  private async cleanScopesForTeam(
    teamId: number,
    scopes:
      | string[]
      | undefined
      | Prisma.ApiKeyCreatescopesInput
      | Prisma.ApiKeyUpdatescopesInput
  ) {
    if (!Array.isArray(scopes)) return [];
    const allowedScopes = await this.getApiKeyScopesForTeam(teamId);
    return (scopes as string[]).filter(i =>
      Object.keys(allowedScopes).includes(i)
    );
  }

  private async cleanScopesForUser(
    userId: number,
    scopes:
      | string[]
      | undefined
      | Prisma.ApiKeyCreatescopesInput
      | Prisma.ApiKeyUpdatescopesInput,
    allowedScopes?: Record<string, string>
  ): Promise<string[]> {
    if (!Array.isArray(scopes)) return [];
    if (!allowedScopes)
      allowedScopes = await this.getApiKeyScopesForUser(userId);

    return (scopes as string[]).filter(i =>
      Object.keys(allowedScopes).includes(i)
    );
  }

  /**
   * Clean all API keys for a user, i.e., make sure they don't have
   * any scopes they're not allowed to have
   */
  async cleanAllApiKeysForUser(userId: number): Promise<void> {
    const apiKeys = await this.prisma.apiKey.findMany({
      where: {user: {id: userId}},
      select: {id: true, scopes: true},
    });
    if (!apiKeys.length) return;
    const allowedScopes = await this.getApiKeyScopesForUser(userId);
    for await (const apiKey of apiKeys)
      await this.prisma.apiKey.update({
        where: {id: apiKey.id},
        data: {
          scopes: await this.cleanScopesForUser(
            userId,
            apiKey.scopes,
            allowedScopes
          ),
        },
      });
  }

  getApiKeyScopesForTeam(teamId: number): Record<string, string> {
    const scopes: Record<string, string> = {};
    Object.keys(teamOwnerScopes).forEach(
      key =>
        (scopes[key.replace('{teamId}', teamId.toString())] =
          teamOwnerScopes[key])
    );
    return scopes;
  }

  async getApiKeyScopesForUser(
    userId: number
  ): Promise<Record<string, string>> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: {id: userId},
      select: {role: true},
    });

    const scopes: Record<string, string> = {};
    if (user.role === 'SUDO') {
      scopes['*'] = 'Do everything (USE WITH CAUTION)';
      scopes['user-*:*'] = 'CRUD users';
      scopes['team-*:*'] = 'CRUD teams';
    }
    Object.keys(userScopes).forEach(
      key =>
        (scopes[key.replace('{userId}', userId.toString())] = userScopes[key])
    );
    return scopes;
  }

  async getApiKeyScopesForTeamCustomized(
    teamId: number
  ): Promise<Record<string, string>> {
    const scopes: Record<string, string> = {};
    // applicationScopes
    Object.keys(teamMemberScopesCustomized).forEach(
      key =>
        (scopes[key.replace('{teamId}', teamId.toString())] =
          teamMemberScopesCustomized[key])
    );
    return scopes;
  }

  async getApiKeyScopesForUserCustomized(
    userId: number
  ): Promise<Record<string, string>> {
    const scopes: Record<string, string> = {};
    // applicationScopes
    Object.keys(userScopesCustomized).forEach(key => {
      scopes[key.replace('{userId}', userId.toString())] =
        userScopesCustomized[key];
    });
    return scopes;
  }
}
