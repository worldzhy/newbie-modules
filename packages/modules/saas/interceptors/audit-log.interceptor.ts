import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import {Reflector} from '@nestjs/core';
import type {Prisma} from '@prisma/client';
import {getClientIp} from 'request-ip';
import {Observable} from 'rxjs';
import {tap} from 'rxjs/operators';
import {UAParser} from 'ua-parser-js';
import {AUDIT_LOG_DATA} from '../modules/audit-logs/audit-log.constants';
import {UserRequest} from '../modules/auth/auth.interface';
import {WebhooksService} from '../modules/webhooks/webhooks.service';
import {GeolocationService} from '../providers/geolocation/geolocation.service';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';

@Injectable()
export class AuditLogger implements NestInterceptor {
  private logger = new Logger(AuditLogger.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly geolocationService: GeolocationService,
    private readonly webhooksService: WebhooksService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    let auditLog = this.reflector.get<string | string[]>(
      AUDIT_LOG_DATA,
      context.getHandler()
    );
    return next.handle().pipe(
      tap(() => {
        (async () => {
          if (auditLog) {
            if (typeof auditLog === 'string') auditLog = [auditLog];
            const request = context.switchToHttp().getRequest() as UserRequest;
            const teamId = parseInt(request.params.teamId);
            const ip = getClientIp(request);
            const location = await this.geolocationService.getLocation(ip);
            const userAgent = request.get('user-agent');
            const ua = UAParser(userAgent);
            for await (const rawEvent of auditLog) {
              let event = rawEvent;
              if (request.user.id && request.user.type === 'user')
                event = event.replace('{userId}', request.user.id.toString());
              if (teamId) event = event.replace('{teamId}', teamId.toString());
              const data: Prisma.AuditLogCreateInput = {
                event,
                rawEvent,
                city: location?.city?.names?.en,
                region: location?.subdivisions?.pop()?.names?.en,
                timezone: location?.location?.time_zone,
                countryCode: location?.country?.iso_code,
                userAgent,
                browser:
                  `${ua.browser.name ?? ''} ${
                    ua.browser.version ?? ''
                  }`.trim() || undefined,
                operatingSystem:
                  `${ua.os.name ?? ''} ${ua.os.version ?? ''}`
                    .replace('Mac OS', 'macOS')
                    .trim() || undefined,
              };
              if (request.user.id && request.user.type === 'user')
                data.user = {connect: {id: request.user.id}};
              if (request.user.id && request.user.type === 'api-key')
                data.apiKey = {connect: {id: request.user.id}};
              if (teamId) data.team = {connect: {id: teamId}};
              await this.prisma.auditLog.create({data});
              if (teamId) this.webhooksService.triggerWebhook(teamId, event);
            }
          }
        })()
          .then(() => {})
          .catch(err => this.logger.error('Unable to save audit log', err));
      })
    );
  }
}
