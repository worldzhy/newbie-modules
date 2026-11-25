import { Injectable, Optional } from "@nestjs/common";
import { Installation } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { hashInstallationToken, isInstallationTokenWellFormed } from "./installation-credential";

/** How long an unknown token is remembered as invalid. */
export const DEFAULT_NEGATIVE_CACHE_TTL_MS = 10_000;

/** Hard cap on remembered rejections so random traffic cannot grow the map. */
export const DEFAULT_MAX_CACHE_ENTRIES = 10_000;

/**
 * What the shared verifier answers (ADR-078 decision 2). It answers "whose
 * token is this", never "may it call this endpoint": the kind comparison
 * belongs to the guard.
 *
 * `malformed` is separated from `unknown` only for receipts and diagnostics;
 * both map to the same generic 401 on the wire.
 */
export type InstallationVerification =
  | { status: "valid"; installation: Installation }
  | { status: "revoked"; installation: Installation }
  | { status: "unknown" }
  | { status: "malformed" };

export interface InstallationVerifierOptions {
  negativeCacheTtlMs?: number;
  maxCacheEntries?: number;
  now?: () => number;
}

/**
 * One tokenHash lookup for every collector kind (ADR-078).
 *
 * Positive results are deliberately not cached: revocation and rotation must
 * take effect on the next request. Only unknown (well-formed but absent)
 * tokens are cached, to absorb garbage traffic.
 */
@Injectable()
export class InstallationVerifier {
  private readonly rejections = new Map<string, number>();
  private readonly negativeCacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly now: () => number;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() options: InstallationVerifierOptions = {},
  ) {
    this.negativeCacheTtlMs = options.negativeCacheTtlMs ?? DEFAULT_NEGATIVE_CACHE_TTL_MS;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  async verify(token: string): Promise<InstallationVerification> {
    if (!isInstallationTokenWellFormed(token)) {
      return { status: "malformed" };
    }

    const now = this.now();
    const rejectedUntil = this.rejections.get(token);
    if (rejectedUntil !== undefined) {
      if (rejectedUntil > now) return { status: "unknown" };
      this.rejections.delete(token);
    }

    const installation = await this.prisma.installation.findUnique({
      where: { tokenHash: hashInstallationToken(token) },
    });
    if (!installation) {
      this.reject(token, now);
      return { status: "unknown" };
    }
    // Revoked rows are not cached: restoring an installation takes effect on
    // the next request too.
    return installation.revokedAt === null ? { status: "valid", installation } : { status: "revoked", installation };
  }

  private reject(token: string, now: number): void {
    if (this.rejections.size >= this.maxCacheEntries) {
      const oldest = this.rejections.keys().next().value;
      if (oldest !== undefined) this.rejections.delete(oldest);
    }
    this.rejections.set(token, now + this.negativeCacheTtlMs);
  }
}
