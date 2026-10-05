import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogService } from "./audit-log.service";
import { AuditInterceptor } from "./audit.interceptor";
import { GeolocationService } from "./helpers/geolocation.service";

@Global()
@Module({
  controllers: [AuditLogController],
  providers: [
    AuditLogService,
    GeolocationService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditLogService],
})
export class AuditModule {}
