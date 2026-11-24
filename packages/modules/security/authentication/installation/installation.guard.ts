import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Installation } from "@generated/prisma/client";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";
import { Request } from "express";
import { hashInstallationToken, installationTokenFingerprint } from "../../installation/installation-credential";
import { InstallationBudgetService } from "../../installation/installation-budget.service";
import {
  InstallationKindRegistry,
  InstallationKindDescriptor,
  installationKindToWire,
} from "../../installation/installation-kind";
import { InstallationReceiptsService, InstallationReportOutcome } from "../../installation/installation-receipts";
import { InstallationVerifier } from "../../installation/installation-verifier";
import { resolveInstallationSourceIp } from "../../installation/source-ip";
import { INSTALLATION_AUTH_KEY } from "./installation.decorator";

const BEARER_PATTERN = /^bearer\s+(.+)$/i;

/**
 * Message used for every credential failure. Unknown, malformed, revoked and
 * wrong-kind tokens are indistinguishable to the caller (ADR-078): the only
 * place the real reason is recorded is the receipt.
 */
const GENERIC_INVALID_TOKEN = "Invalid or revoked installation token.";

/** Request surface this guard populates for controllers and receipts. */
export interface InstallationAuthRequest extends Request {
  installation?: Installation;
  installationKind?: string;
}

/**
 * Eighth authentication strategy (ADR-016, rewritten by ADR-078/079/080):
 * installation tokens for machine-to-machine report endpoints.
 *
 * Order matters and is deliberate:
 *  1. Missing token is rejected before any hashing or storage access.
 *  2. The first budget layer runs before credential resolution, so the
 *     rejection path is O(1) Redis and never touches the database.
 *  3. The token is resolved once across all kinds.
 *  4. The kind is compared here, not in the verifier: the verifier answers
 *     "whose token is this", not "may it call this endpoint".
 *  5. The second budget layer runs after resolution, keyed by installation.
 *
 * Every rejection writes a receipt; the guard runs before interceptors, so
 * these outcomes can never be recorded by one.
 */
@Injectable()
export class InstallationAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly kindRegistry: InstallationKindRegistry,
    private readonly verifier: InstallationVerifier,
    private readonly budget: InstallationBudgetService,
    private readonly receipts: InstallationReceiptsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.getAllAndOverride<string>(INSTALLATION_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!kind) {
      throw new InternalServerErrorException(
        "InstallationAuthGuard was reached without @InstallationAuth(kind) metadata.",
      );
    }
    // Fail closed: a missing descriptor means no budget and no kind check.
    const descriptor = this.kindRegistry.require(kind);

    const req = context.switchToHttp().getRequest<InstallationAuthRequest>();
    const sourceIp = resolveInstallationSourceIp(req);
    const token = this.extractToken(req, descriptor);

    if (!token) {
      this.record(kind, InstallationReportOutcome.MISSING_TOKEN, { sourceIp });
      throw new UnauthorizedException("Missing installation token: present it as Authorization: Bearer <token>.");
    }

    const tokenHash = hashInstallationToken(token);
    const fingerprint = installationTokenFingerprint(token);
    const keySubject = descriptor.budget.scope === "token-and-ip" ? `${tokenHash}:${sourceIp ?? "unknown"}` : tokenHash;

    if (!(await this.budget.spend(kind, "key", keySubject, descriptor.budget.perKey))) {
      this.record(kind, InstallationReportOutcome.RATE_LIMITED, { fingerprint, sourceIp });
      throw new NewbieException(NewbieExceptionType.Request_RateLimited);
    }

    const verification = await this.verifier.verify(token);

    switch (verification.status) {
      case "malformed": {
        this.record(kind, InstallationReportOutcome.MALFORMED_TOKEN, { fingerprint, sourceIp });
        throw new UnauthorizedException(GENERIC_INVALID_TOKEN);
      }
      case "unknown": {
        this.record(kind, InstallationReportOutcome.UNKNOWN_TOKEN, { fingerprint, sourceIp });
        throw new UnauthorizedException(GENERIC_INVALID_TOKEN);
      }
      case "revoked": {
        this.record(kind, InstallationReportOutcome.REVOKED_TOKEN, {
          fingerprint,
          sourceIp,
          installationId: verification.installation.id,
        });
        throw new UnauthorizedException(GENERIC_INVALID_TOKEN);
      }
      case "valid": {
        const { installation } = verification;
        if (installationKindToWire(installation.kind) !== kind) {
          this.record(kind, InstallationReportOutcome.WRONG_KIND, { fingerprint, sourceIp });
          throw new UnauthorizedException(GENERIC_INVALID_TOKEN);
        }

        const total = descriptor.budget.perInstallationTotal;
        if (total && !(await this.budget.spend(kind, "total", installation.id, total))) {
          this.record(kind, InstallationReportOutcome.RATE_LIMITED, {
            fingerprint,
            sourceIp,
            installationId: installation.id,
          });
          throw new NewbieException(NewbieExceptionType.Request_RateLimited);
        }

        req.installation = installation;
        req.installationKind = kind;
        return true;
      }
    }
  }

  private record(
    kind: string,
    outcome: InstallationReportOutcome,
    extra: { fingerprint?: string; sourceIp?: string; installationId?: string },
  ): void {
    // Fail-open: receipts must never change the authentication outcome.
    void this.receipts.record({ kind, outcome, ...extra });
  }

  private extractToken(req: Request, descriptor: InstallationKindDescriptor): string | undefined {
    const authorization = req.headers["authorization"];
    if (typeof authorization === "string") {
      const match = BEARER_PATTERN.exec(authorization.trim());
      if (match?.[1]) return match[1].trim();
    }

    if (descriptor.legacyHeader) {
      const legacy = req.headers[descriptor.legacyHeader];
      if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
    }

    if (descriptor.bodyTokenField) {
      const body: unknown = req.body;
      let parsed: unknown = body;
      if (typeof body === "string") {
        // sendBeacon posts text/plain, which the text body parser leaves as a
        // raw string; tolerate malformed payloads here and let the controller
        // produce the definitive 400.
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = undefined;
        }
      }
      if (parsed && typeof parsed === "object") {
        const value = (parsed as Record<string, unknown>)[descriptor.bodyTokenField];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }

    return undefined;
  }
}
