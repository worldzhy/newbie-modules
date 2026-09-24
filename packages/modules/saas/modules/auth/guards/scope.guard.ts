import {CanActivate, ExecutionContext, Injectable} from '@nestjs/common';
import {Reflector} from '@nestjs/core';
import * as minimatch from 'minimatch';
import {AccessTokenParsed, UserRequest} from '../auth.interface';

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const scopes = this.reflector.get<string[]>('scopes', context.getHandler());
    const request = context.switchToHttp().getRequest<UserRequest>();
    if (!scopes) return true;
    const user: AccessTokenParsed = request.user;
    let authorized = false;
    if (!user) return false;
    for (const userScope of user.scopes) {
      for (let scope of scopes) {
        // user scope
        if (request.params && request.params.userId) {
          scope = scope.replace(`{userId}`, request.params.userId);
        }

        // team scope
        if (request.params && request.params.teamId) {
          scope = scope.replace(`{teamId}`, request.params.teamId);
        }

        authorized = authorized || minimatch(scope, userScope);
        if (authorized) return true;
      }
    }
    return authorized;
  }
}
