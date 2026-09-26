import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AgentStatus, AgentType } from "@generated/prisma/enums";

/** Positive token cache lifetime. Tokens rarely change, so 60s saves a PG hit per batch. */
const POSITIVE_TTL_MS = 60_000;
/** Negative cache lifetime: invalid tokens are rejected without hammering PG. */
const NEGATIVE_TTL_MS = 10_000;
/** Minimum interval between lastSeenAt/status UPDATEs for one agent. */
const TOUCH_THROTTLE_MS = 30_000;
/**
 * Hard cap on cached tokens (positive + negative). The endpoint is
 * unauthenticated, so random-token traffic must not grow the Map without
 * bound; at this size oldest entries are evicted.
 */
const MAX_CACHE_ENTRIES = 10_000;

/** Canonical UUID format of the agent token column (PG uuid). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CachedAgent {
  /** Null means the token was rejected (negative cache entry). */
  agentId: string | null;
  applicationId: string | null;
  expiresAt: number;
}

/**
 * Resolves SERVER_MONITOR agent tokens to application ids.
 *
 * The ingest path is high-volume, so every batch would otherwise cost one PG
 * point lookup plus an Agent UPDATE. Results are cached in-process and the
 * lastSeenAt write is throttled. Trade-off: a revoked/disabled token keeps
 * being accepted for up to POSITIVE_TTL_MS; multi-instance deployments each
 * throttle their own lastSeenAt writes (both are acceptable for this metric).
 */
@Injectable()
export class AgentTokenResolver {
  private readonly cache = new Map<string, CachedAgent>();
  private readonly lastTouchAt = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates the token and returns the owning application id.
   * Throws UnauthorizedException when missing, unknown, wrong agent type,
   * or DISABLED. Performs the throttled PENDING -> ACTIVE touch.
   */
  async resolveApplicationId(token: string | undefined): Promise<string> {
    if (!token) {
      throw new UnauthorizedException("Missing application report token.");
    }

    const now = Date.now();

    // Reject malformed tokens up front: a non-UUID value would make Prisma
    // throw a validation error (surfacing as 400) and bypass the negative
    // cache, exposing the open endpoint to per-request PG hits.
    if (!UUID_PATTERN.test(token)) {
      this.putNegativeCache(token, now);
      throw new UnauthorizedException("Invalid application report token.");
    }

    const cached = this.cache.get(token);
    if (cached) {
      if (cached.expiresAt <= now) {
        // Lazy eviction of expired entries.
        this.cache.delete(token);
      } else if (!cached.applicationId || !cached.agentId) {
        throw new UnauthorizedException("Invalid application report token.");
      } else {
        await this.touchAgent(cached.agentId);
        return cached.applicationId;
      }
    }

    const agent = await this.prisma.agent.findUnique({ where: { token } });
    if (
      !agent ||
      agent.type !== AgentType.SERVER_MONITOR ||
      agent.status === AgentStatus.DISABLED
    ) {
      this.putNegativeCache(token, now);
      throw new UnauthorizedException("Invalid application report token.");
    }

    this.putCache(token, {
      agentId: agent.id,
      applicationId: agent.applicationId,
      expiresAt: now + POSITIVE_TTL_MS,
    });
    await this.touchAgent(agent.id);
    return agent.applicationId;
  }

  /** Stores a negative cache entry with the size cap applied. */
  private putNegativeCache(token: string, now: number): void {
    this.putCache(token, {
      agentId: null,
      applicationId: null,
      expiresAt: now + NEGATIVE_TTL_MS,
    });
  }

  /** Inserts a cache entry, evicting the oldest one when the cap is reached. */
  private putCache(token: string, entry: CachedAgent): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      // Map iteration order is insertion order; drop the oldest key.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(token, entry);
  }

  /**
   * Flips PENDING -> ACTIVE on first contact and refreshes lastSeenAt, at most
   * once per TOUCH_THROTTLE_MS per agent. The CASE SQL also prevents an older
   * concurrent write from moving lastSeenAt backwards.
   */
  private async touchAgent(agentId: string): Promise<void> {
    const nowMs = Date.now();
    const last = this.lastTouchAt.get(agentId) ?? 0;
    if (nowMs - last < TOUCH_THROTTLE_MS) return;

    const now = new Date(nowMs);
    await this.prisma.$executeRaw`
      UPDATE "application"."Agent"
      SET "lastSeenAt" = ${now},
          "status" = CASE WHEN "status" = 'PENDING' THEN 'ACTIVE'::"application"."AgentStatus" ELSE "status" END
      WHERE "id" = ${agentId}::uuid
        AND ("lastSeenAt" IS NULL OR "lastSeenAt" < ${now})
    `;
    this.lastTouchAt.set(agentId, nowMs);
  }
}
