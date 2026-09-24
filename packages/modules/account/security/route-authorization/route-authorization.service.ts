import {Injectable, RequestMethod} from '@nestjs/common';
import type {Request} from 'express';
import {PermissionAction, Prisma} from '@generated/prisma/client';
import {WhereInput} from '@casl/prisma';

export interface RouteMethodConfig {
  POST?: string[];
  GET?: string[];
  DELETE?: string[];
  PUT?: string[];
  PATCH?: string[];
  ALL?: string[];
}

export interface RoutePermissionRequirement {
  action: PermissionAction;
  resource: Prisma.ModelName;
  fields?: string[];
  conditions?: WhereInput<Prisma.ModelName>;
}

export type RouteAuthorizationPolicy = (req: Request) => boolean | Promise<boolean>;

export interface RouteAuthorizationConfig {
  permission?: RoutePermissionRequirement;
  policy?: RouteAuthorizationPolicy;
  routes: RouteMethodConfig;
}

@Injectable()
export class RouteAuthorizationService {
  private routeConfigs: {
    path: string;
    method: RequestMethod | 'ALL';
    permission?: RoutePermissionRequirement;
    policy?: RouteAuthorizationPolicy;
  }[] = [];

  configureRouteAuthorization(configs: RouteAuthorizationConfig[]) {
    configs.forEach(config => {
      if (!config.permission && !config.policy) {
        return;
      }
      if (config.routes.POST) {
        config.routes.POST.forEach(path => {
          this.addRouteConfig(path, RequestMethod.POST, config.permission, config.policy);
        });
      }
      if (config.routes.GET) {
        config.routes.GET.forEach(path => {
          this.addRouteConfig(path, RequestMethod.GET, config.permission, config.policy);
        });
      }
      if (config.routes.DELETE) {
        config.routes.DELETE.forEach(path => {
          this.addRouteConfig(path, RequestMethod.DELETE, config.permission, config.policy);
        });
      }
      if (config.routes.PUT) {
        config.routes.PUT.forEach(path => {
          this.addRouteConfig(path, RequestMethod.PUT, config.permission, config.policy);
        });
      }
      if (config.routes.PATCH) {
        config.routes.PATCH.forEach(path => {
          this.addRouteConfig(path, RequestMethod.PATCH, config.permission, config.policy);
        });
      }
      if (config.routes.ALL) {
        config.routes.ALL.forEach(path => {
          this.addRouteConfig(path, 'ALL', config.permission, config.policy);
        });
      }
    });
  }

  private addRouteConfig(
    path: string,
    method: RequestMethod | 'ALL',
    permission?: RoutePermissionRequirement,
    policy?: RouteAuthorizationPolicy
  ) {
    this.routeConfigs.push({path, method, permission, policy});
  }

  getPermissionForRoute(url: string, method: string): RoutePermissionRequirement | null {
    const config = this.routeConfigs.find(config => {
      if (!url.includes(config.path)) {
        return false;
      }
      if (config.method === 'ALL') {
        return true;
      }
      return this.matchMethod(config.method, method);
    });

    return config && config.permission ? config.permission : null;
  }

  getPolicyForRoute(url: string, method: string): RouteAuthorizationPolicy | null {
    const config = this.routeConfigs.find(config => {
      if (!url.includes(config.path)) {
        return false;
      }
      if (config.method === 'ALL') {
        return true;
      }
      return this.matchMethod(config.method, method);
    });
    return config && config.policy ? config.policy : null;
  }

  private matchMethod(definedMethod: RequestMethod, requestMethod: string): boolean {
    switch (definedMethod) {
      case RequestMethod.GET:
        return requestMethod === 'GET';
      case RequestMethod.POST:
        return requestMethod === 'POST';
      case RequestMethod.PUT:
        return requestMethod === 'PUT';
      case RequestMethod.DELETE:
        return requestMethod === 'DELETE';
      case RequestMethod.PATCH:
        return requestMethod === 'PATCH';
      case RequestMethod.ALL:
        return true;
      case RequestMethod.OPTIONS:
        return requestMethod === 'OPTIONS';
      case RequestMethod.HEAD:
        return requestMethod === 'HEAD';
      default:
        return false;
    }
  }
}
