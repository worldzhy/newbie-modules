import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { RedisService } from "@modules/redis/redis.service";

/**
 * Synchronous report outcomes (ADR-080). `ACCEPTED` is counted too: it is the
 * denominator of the rejection-spike alert and the only signal that separates
 * "reports are rejected" from "reports never arrive".
 */
export const InstallationReportOutcome = {
  ACCEPTED: "ACCEPTED",
  MISSING_TOKEN: "MISSING_TOKEN",
  MALFORMED_TOKEN: "MALFORMED_TOKEN",
  UNKNOWN_TOKEN: "UNKNOWN_TOKEN",
  WRONG_KIND: "WRONG_KIND",
  REVOKED_TOKEN: "REVOKED_TOKEN",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
} as const;

export type InstallationReportOutcome = (typeof InstallationReportOutcome)[keyof typeof InstallationReportOutcome];

/**
 * Asynchronous consumption state, written by collectors whose ingest is
 * decoupled from the HTTP response (frontend-monitor). Kept separate from the
 * synchronous outcomes: the client already received 200 when a failure lands
 * here.
 */
export interface InstallationPipelineState {
  queueDepth: number;
  deadLetterCount: number;
  lastFailureAt?: string;
}

export interface InstallationReceipts {
  /** Outcome counts over the retained 24-hour window. */
  histogram24h: Partial<Record<InstallationReportOutcome, number>>;
  /** Most recent non-empty 5-minute bucket, derived by scanning backwards. */
  lastRejection?: { outcome: InstallationReportOutcome; at: string; count: number };
  /** Present only for collectors with an asynchronous pipeline. */
  pipeline?: InstallationPipelineState;
}

/** One 5-minute bucket of outcome counts, newest first in `readBuckets`. */
export interface InstallationReceiptBucket {
  at: string;
  outcomes: Partial<Record<InstallationReportOutcome, number>>;
}

/** 5-minute receipt buckets, retained for 24 hours (ADR-080). */
export const RECEIPT_BUCKET_MS = 5 * 60 * 1000;
export const RECEIPT_RETENTION_SECONDS = 24 * 60 * 60;
const RECEIPT_BUCKET_COUNT = RECEIPT_RETENTION_SECONDS / (RECEIPT_BUCKET_MS / 1000);

/** Members kept per (kind, bucket) fingerprint set. Bounds memory to ~26 MB. */
export const RECEIPT_TOP_N = 256;

/** One recorded event. */
export interface InstallationReceiptEvent {
  kind: string;
  outcome: InstallationReportOutcome;
  /** Set when the event has an installation; failures before resolution do not. */
  installationId?: string | null;
  /** Stable token pseudonym (ADR-078); never the raw token. */
  fingerprint?: string;
  /** Source IP, only used for MISSING_TOKEN attribution. */
  sourceIp?: string;
}

/**
 * Redis-backed installation receipts (ADR-080).
 *
 * Cardinality is bounded two ways: attributed outcomes use one hash per
 * installation, and unattributed outcomes use one kind-wide hash plus a
 * top-N ZSET per kind. `other` is derived at read time as
 * `total - sum(top-N scores)`, so no key is created for it.
 *
 * Every write is fail-open: a Redis outage must never turn a report or an
 * authentication decision into a 500. Losing counts is acceptable; losing
 * availability is not.
 */
@Injectable()
export class InstallationReceiptsService {
  private readonly logger = new Logger(InstallationReceiptsService.name);
  private degradedWarned = false;

  constructor(private readonly redis: RedisService) {}

  /** Record one event. Never throws. */
  async record(event: InstallationReceiptEvent): Promise<void> {
    if (!this.redis.isConfigured()) return;
    try {
      const client = this.redis.getClient();
      const bucket = this.bucketStart(Date.now());
      const ttl = RECEIPT_RETENTION_SECONDS + Math.ceil(RECEIPT_BUCKET_MS / 1000);
      const pipeline = client.pipeline();

      if (event.installationId) {
        const key = this.ownedKey(event.installationId, bucket);
        pipeline.hincrby(key, event.outcome, 1);
        pipeline.expire(key, ttl);
      } else {
        const key = this.kindKey(event.kind, bucket);
        pipeline.hincrby(key, event.outcome, 1);
        pipeline.expire(key, ttl);

        if (event.fingerprint) {
          const setKey = this.fingerprintKey(event.kind, bucket);
          pipeline.zincrby(setKey, 1, event.fingerprint);
          // Keep only the top N by count; rank 0 is the lowest score.
          pipeline.zremrangebyrank(setKey, 0, -(RECEIPT_TOP_N + 1));
          pipeline.expire(setKey, ttl);
        }

        if (event.outcome === InstallationReportOutcome.MISSING_TOKEN && event.sourceIp) {
          const ipKey = this.ipKey(event.kind, bucket);
          pipeline.zincrby(ipKey, 1, ipKeyDigest(event.sourceIp));
          pipeline.zremrangebyrank(ipKey, 0, -(RECEIPT_TOP_N + 1));
          pipeline.expire(ipKey, ttl);
        }
      }

      await pipeline.exec();
      this.recovered();
    } catch (error) {
      this.degraded(error);
    }
  }

  /**
   * Read the 24-hour histogram for one installation. `installationId` is
   * optional: before resolution only the kind-wide bucket exists.
   */
  async read(kind: string, installationId?: string | null): Promise<InstallationReceipts> {
    const empty: InstallationReceipts = { histogram24h: {} };
    if (!this.redis.isConfigured()) return empty;

    try {
      const client = this.redis.getClient();
      const buckets = this.recentBuckets(Date.now());
      const pipeline = client.pipeline();
      for (const bucket of buckets) {
        pipeline.hgetall(this.kindKey(kind, bucket));
        if (installationId) pipeline.hgetall(this.ownedKey(installationId, bucket));
      }
      const results = await pipeline.exec();
      if (!results) return empty;

      const histogram: Partial<Record<InstallationReportOutcome, number>> = {};
      let lastRejection: InstallationReceipts["lastRejection"];
      let index = 0;
      for (const bucket of buckets) {
        const kindHash = results[index++]?.[1] as Record<string, string> | null;
        const ownedHash = installationId ? (results[index++]?.[1] as Record<string, string> | null) : null;
        const merged = this.mergeHashes(kindHash, ownedHash);
        for (const [outcome, count] of Object.entries(merged)) {
          histogram[outcome as InstallationReportOutcome] =
            (histogram[outcome as InstallationReportOutcome] ?? 0) + count;
        }
        if (!lastRejection) {
          const top = this.topOutcome(merged);
          if (top) lastRejection = { outcome: top.outcome, count: top.count, at: new Date(bucket).toISOString() };
        }
      }

      const receipts: InstallationReceipts = { histogram24h: histogram };
      if (lastRejection) receipts.lastRejection = lastRejection;
      if (installationId) {
        const pipelineState = await this.readPipelineState(installationId);
        if (pipelineState) receipts.pipeline = pipelineState;
      }
      return receipts;
    } catch (error) {
      this.degraded(error);
      return empty;
    }
  }

  /**
   * Per-bucket outcome counts, newest first. The rejection-spike rule compares
   * the newest bucket with the baseline of the previous ones, so the bucket
   * boundary stays a storage detail of this service.
   */
  async readBuckets(kind: string, count: number, installationId?: string | null): Promise<InstallationReceiptBucket[]> {
    if (!this.redis.isConfigured()) return [];

    try {
      const client = this.redis.getClient();
      const buckets = this.recentBuckets(Date.now()).slice(0, count);
      const pipeline = client.pipeline();
      for (const bucket of buckets) {
        pipeline.hgetall(this.kindKey(kind, bucket));
        if (installationId) pipeline.hgetall(this.ownedKey(installationId, bucket));
      }
      const results = await pipeline.exec();
      if (!results) return [];

      let index = 0;
      return buckets.map((bucket) => {
        const kindHash = results[index++]?.[1] as Record<string, string> | null;
        const ownedHash = installationId ? (results[index++]?.[1] as Record<string, string> | null) : null;
        return { at: new Date(bucket).toISOString(), outcomes: this.mergeHashes(kindHash, ownedHash) };
      });
    } catch (error) {
      this.degraded(error);
      return [];
    }
  }

  /** Overwrite the asynchronous pipeline state of one installation. Never throws. */
  async setPipelineState(installationId: string, state: InstallationPipelineState): Promise<void> {
    if (!this.redis.isConfigured()) return;
    try {
      const client = this.redis.getClient();
      const key = this.pipelineKey(installationId);
      const pipeline = client.pipeline();
      pipeline.hset(key, {
        queueDepth: String(state.queueDepth),
        deadLetterCount: String(state.deadLetterCount),
        lastFailureAt: state.lastFailureAt ?? "",
      });
      pipeline.expire(key, RECEIPT_RETENTION_SECONDS);
      await pipeline.exec();
      this.recovered();
    } catch (error) {
      this.degraded(error);
    }
  }

  private async readPipelineState(installationId: string): Promise<InstallationPipelineState | undefined> {
    const raw = await this.redis.getClient().hgetall(this.pipelineKey(installationId));
    if (!raw || Object.keys(raw).length === 0) return undefined;
    return {
      queueDepth: Number(raw.queueDepth ?? 0),
      deadLetterCount: Number(raw.deadLetterCount ?? 0),
      ...(raw.lastFailureAt ? { lastFailureAt: raw.lastFailureAt } : {}),
    };
  }

  private bucketStart(nowMs: number): number {
    return Math.floor(nowMs / RECEIPT_BUCKET_MS) * RECEIPT_BUCKET_MS;
  }

  /** Newest bucket first; the scan stops at the first non-empty one. */
  private recentBuckets(nowMs: number): number[] {
    const current = this.bucketStart(nowMs);
    const buckets: number[] = [];
    for (let i = 0; i < RECEIPT_BUCKET_COUNT; i += 1) {
      buckets.push(current - i * RECEIPT_BUCKET_MS);
    }
    return buckets;
  }

  private mergeHashes(
    kindHash: Record<string, string> | null,
    ownedHash: Record<string, string> | null,
  ): Record<string, number> {
    const merged: Record<string, number> = {};
    for (const hash of [kindHash, ownedHash]) {
      if (!hash) continue;
      for (const [outcome, raw] of Object.entries(hash)) {
        merged[outcome] = (merged[outcome] ?? 0) + Number(raw ?? 0);
      }
    }
    return merged;
  }

  private topOutcome(
    merged: Record<string, number>,
  ): { outcome: InstallationReportOutcome; count: number } | undefined {
    let best: { outcome: InstallationReportOutcome; count: number } | undefined;
    for (const [outcome, count] of Object.entries(merged)) {
      if (count <= 0) continue;
      if (!best || count > best.count) best = { outcome: outcome as InstallationReportOutcome, count };
    }
    return best;
  }

  private kindKey(kind: string, bucket: number): string {
    return `installation:receipt:kind:${kind}:${bucket}`;
  }

  private ownedKey(installationId: string, bucket: number): string {
    return `installation:receipt:owned:${installationId}:${bucket}`;
  }

  private fingerprintKey(kind: string, bucket: number): string {
    return `installation:receipt:fp:${kind}:${bucket}`;
  }

  private ipKey(kind: string, bucket: number): string {
    return `installation:receipt:ip:${kind}:${bucket}`;
  }

  private pipelineKey(installationId: string): string {
    return `installation:receipt:pipeline:${installationId}`;
  }

  private degraded(error: unknown): void {
    if (this.degradedWarned) return;
    this.degradedWarned = true;
    this.logger.warn(
      `Installation receipts are unavailable; counts are dropped until Redis recovers: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  private recovered(): void {
    if (!this.degradedWarned) return;
    this.degradedWarned = false;
    this.logger.log("Installation receipts recovered.");
  }
}

/** Irreversible short digest of a source IP for the per-IP receipt set. */
function ipKeyDigest(sourceIp: string): string {
  return createHash("sha256").update(`installation-ip:${sourceIp}`).digest("hex").slice(0, 16);
}
