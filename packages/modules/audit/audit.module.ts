import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogService } from "./audit-log.service";
import { AuditContextMiddleware } from "./audit-context.middleware";
import { AuditContextService } from "./audit-context.service";
import { GeolocationService } from "./helpers/geolocation.service";
import { HttpAccessInterceptor } from "./http-access.interceptor";

@Global()
@Module({
  controllers: [AuditLogController],
  providers: [
    AuditLogService,
    AuditContextService,
    GeolocationService,
    { provide: APP_INTERCEPTOR, useClass: HttpAccessInterceptor },
  ],
  exports: [AuditLogService, AuditContextService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Named splat wildcard required by path-to-regexp v8 (Express 5):
    // matches every route including the root path.
    consumer.apply(AuditContextMiddleware).forRoutes({ path: "/{*splat}", method: RequestMethod.ALL });
  }
}
