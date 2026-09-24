import {Injectable, MiddlewareConsumer, RequestMethod} from '@nestjs/common';
import * as passport from 'passport';
import {RouteInfo} from '@nestjs/common/interfaces';
import {GuardType} from '../passport/guard.types';

export interface RouteMethodConfig {
  POST?: string[];
  GET?: string[];
  DELETE?: string[];
  PUT?: string[];
  PATCH?: string[];
  ALL?: string[];
}

export interface SecurityMiddlewareConfig {
  guard: GuardType;
  routes: RouteMethodConfig;
}

@Injectable()
export class RouteAuthenticationService {
  private publicRoutes: {path: string; method: RequestMethod | 'ALL'}[] = [];

  addPublicRoute(path: string, method: RequestMethod | 'ALL' = 'ALL') {
    this.publicRoutes.push({path, method});
  }

  isPublic(url: string, method: string): boolean {
    return this.publicRoutes.some(route => {
      if (!url.includes(route.path)) {
        return false;
      }
      if (route.method === 'ALL') {
        return true;
      }
      return this.matchMethod(route.method, method);
    });
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

  private routeGuardConfigs: {
    path: string;
    method: RequestMethod | 'ALL';
    guard: GuardType;
  }[] = [];

  configureRouteAuthentication(configs: SecurityMiddlewareConfig[]) {
    configs.forEach(config => {
      if (config.routes.POST) {
        config.routes.POST.forEach(path => {
          this.addRouteGuardConfig(path, RequestMethod.POST, config.guard);
          this.addPublicRoute(path, RequestMethod.POST);
        });
      }
      if (config.routes.GET) {
        config.routes.GET.forEach(path => {
          this.addRouteGuardConfig(path, RequestMethod.GET, config.guard);
          this.addPublicRoute(path, RequestMethod.GET);
        });
      }
      if (config.routes.DELETE) {
        config.routes.DELETE.forEach(path => {
          this.addRouteGuardConfig(path, RequestMethod.DELETE, config.guard);
          this.addPublicRoute(path, RequestMethod.DELETE);
        });
      }
      if (config.routes.PUT) {
        config.routes.PUT.forEach(path => {
          this.addRouteGuardConfig(path, RequestMethod.PUT, config.guard);
          this.addPublicRoute(path, RequestMethod.PUT);
        });
      }
      if (config.routes.PATCH) {
        config.routes.PATCH.forEach(path => {
          this.addRouteGuardConfig(path, RequestMethod.PATCH, config.guard);
          this.addPublicRoute(path, RequestMethod.PATCH);
        });
      }
      if (config.routes.ALL) {
        config.routes.ALL.forEach(path => {
          this.addRouteGuardConfig(path, 'ALL', config.guard);
          this.addPublicRoute(path, 'ALL');
        });
      }
    });
  }

  private addRouteGuardConfig(path: string, method: RequestMethod | 'ALL', guard: GuardType) {
    this.routeGuardConfigs.push({path, method, guard});
  }

  getGuardForRoute(url: string, method: string): GuardType | null {
    const config = this.routeGuardConfigs.find(config => {
      if (!url.includes(config.path)) {
        return false;
      }
      if (config.method === 'ALL') {
        return true;
      }
      return this.matchMethod(config.method, method);
    });

    return config ? config.guard : null;
  }
}
