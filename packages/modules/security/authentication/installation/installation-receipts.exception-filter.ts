import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import { InstallationReceiptsService, InstallationReportOutcome } from "../../installation/installation-receipts";
import { InstallationAuthRequest } from "./installation.guard";

/** HTTP status map for the outcomes that only exist as thrown errors. */
const STATUS_TO_OUTCOME: Record<number, InstallationReportOutcome> = {
  400: InstallationReportOutcome.INVALID_PAYLOAD,
  413: InstallationReportOutcome.PAYLOAD_TOO_LARGE,
  422: InstallationReportOutcome.INVALID_PAYLOAD,
  // Guard-level 429s are thrown before any handler and never reach a filter;
  // a 429 here is a handler-level limit such as the ingest queue cap.
  429: InstallationReportOutcome.RATE_LIMITED,
};

/**
 * Records payload-level rejections (ADR-080) without changing the response:
 * the filter delegates to Nest's default `BaseExceptionFilter`.
 *
 * `PAYLOAD_TOO_LARGE` comes from body-parser before the guard runs, so it is
 * recorded unattributed; `INVALID_PAYLOAD` comes from the handler after the
 * guard, so it carries the installation id.
 *
 * Recording is best-effort and never masks the original error.
 */
@Catch()
export class InstallationReceiptsExceptionFilter extends BaseExceptionFilter {
  constructor(
    adapterHost: HttpAdapterHost,
    private readonly receipts: InstallationReceiptsService,
  ) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    try {
      this.record(exception, host);
    } catch {
      // Receipts must never affect error handling.
    }
    super.catch(exception, host);
  }

  private record(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const outcome = STATUS_TO_OUTCOME[status];
    if (!outcome) return;

    const req = host.switchToHttp().getRequest<InstallationAuthRequest>();
    const kind = req.installationKind;
    if (!kind) return;

    void this.receipts.record({
      kind,
      outcome,
      installationId: req.installation?.id ?? null,
    });
  }
}
