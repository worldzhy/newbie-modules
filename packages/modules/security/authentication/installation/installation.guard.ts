import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { INSTALLATION_RESOLVERS, InstallationResolver } from "../../ports/installation.resolver";
import { INSTALLATION_AUTH_KEY } from "./installation.decorator";

const BEARER_PATTERN = /^bearer\s+(.+)$/i;

/**
 * Eighth authentication strategy (ADR-016): installation tokens for
 * machine-to-machine report endpoints. Unlike the passport-based strategies
 * this is a plain guard because the collector key ("kind") lives in route
 * metadata, which passport's validate() cannot see.
 *
 * Token sources, in order:
 *  1. `Authorization: Bearer <token>` — the single standard.
 *  2. The resolver's legacyHeader — private per-module headers kept for the
 *     SDK migration window; controllers never see them.
 *  3. The resolver's bodyTokenField — the web-monitor sendBeacon exception.
 *
 * On success the resolver's installation context is attached as
 * `req.installation`.
 */
@Injectable()
export class InstallationAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(INSTALLATION_RESOLVERS)
    private readonly resolvers?: InstallationResolver[],
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

    const resolver = this.resolvers?.find((candidate) => candidate.kind === kind);
    if (!resolver) {
      throw new InternalServerErrorException(
        `@InstallationAuth("${kind}") is active but no installation resolver is bound for that kind. Did the collector module load?`,
      );
    }

    const req = context.switchToHttp().getRequest<Request & { installation?: unknown }>();
    const token = this.extractToken(req, resolver);
    if (!token) {
      throw new UnauthorizedException("Missing installation token: present it as Authorization: Bearer <token>.");
    }

    req.installation = await resolver.resolve(token, kind);
    return true;
  }

  private extractToken(req: Request, resolver: InstallationResolver): string | undefined {
    const authorization = req.headers["authorization"];
    if (typeof authorization === "string") {
      const match = BEARER_PATTERN.exec(authorization.trim());
      if (match?.[1]) return match[1].trim();
    }

    if (resolver.legacyHeader) {
      const legacy = req.headers[resolver.legacyHeader];
      if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
    }

    if (resolver.bodyTokenField) {
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
        const value = (parsed as Record<string, unknown>)[resolver.bodyTokenField];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }

    return undefined;
  }
}
