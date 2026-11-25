import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { InstallationReceiptsService, InstallationReportOutcome } from "../../installation/installation-receipts";
import { InstallationAuthRequest } from "./installation.guard";

/**
 * Records `ACCEPTED` for every successfully served installation report
 * (ADR-080). The guard runs before interceptors, so positive outcomes — which
 * only exist after the handler returns — must be recorded here.
 *
 * Only routes that passed the installation guard carry `installationKind`;
 * everything else is ignored.
 */
@Injectable()
export class InstallationReceiptsInterceptor implements NestInterceptor {
  constructor(private readonly receipts: InstallationReceiptsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<InstallationAuthRequest>();
    const kind = req.installationKind;
    if (!kind) return next.handle();

    return next.handle().pipe(
      tap(() => {
        void this.receipts.record({
          kind,
          outcome: InstallationReportOutcome.ACCEPTED,
          installationId: req.installation?.id ?? null,
        });
      }),
    );
  }
}
