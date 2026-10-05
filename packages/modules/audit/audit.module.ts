import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogService } from "./audit-log.service";
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
export class AuditModule {}
