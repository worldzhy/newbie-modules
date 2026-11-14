import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationSubjectService, toSubjectRef } from "@modules/evaluation/evaluation-subject.service";

import { SecurityEvaluationAssetService } from "../assets/security-evaluation-asset.service";
import { requirePositiveInteger } from "../persistence/security-evaluation-intel-negative-cache.repository";
import {
  SECURITY_EVALUATION_PLATFORM_SCOPE_ID,
  SECURITY_EVALUATION_PLATFORM_SCOPE_TYPE,
  SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
  SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX,
  SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX,
  SECURITY_EVALUATION_WEB_ORIGIN_PATH_ROLES,
  SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS,
  SECURITY_EVALUATION_WEB_ORIGIN_WELL_KNOWN_PATH,
  type SecurityEvaluationWebOriginVerificationMethod,
  type SecurityEvaluationWebOriginVerificationStatus,
} from "../security-evaluation.constants";
import {
  VerificationFetchAccess,
  securityEvaluationVerificationFetchAccessToken,
} from "../ports/web-origin-verification-access.port";

const VERIFICATION_INTERVAL_DAYS_KEY = "modules.security-evaluation.webOriginVerificationIntervalDays";
const REVERIFY_FAILURE_THRESHOLD_KEY = "modules.security-evaluation.webOriginReverifyFailureThreshold";
const TOKEN_BYTES_KEY = "modules.security-evaluation.webOriginTokenBytes";

/** Base64url expansion: 4 characters per 3 bytes, rounded up. */
const MAX_TOKEN_BYTES = 48;
const DAYS_MS = 86_400_000;

export interface CreateSecurityEvaluationWebOriginInput {
  /** Origin (`scheme://host[:port]`); normalized before anything is written. */
  origin: string;
  /** Label shown in the UI; defaults to the normalized origin. */
  label?: string;
  /** Free-form deployment slot chosen by the host ("production", "staging"…). */
  environment: string;
  /** Path role → relative path; unknown roles are rejected. */
  targetPaths?: Record<string, string>;
  /** Provenance: which host source attributes this origin. */
  sourceType: string;
  sourceId: string;
}

export interface SecurityEvaluationWebOriginRegistration {
  subjectId: string;
  assetId: string;
  webOriginId: string;
  origin: string;
  verificationStatus: SecurityEvaluationWebOriginVerificationStatus;
  verificationToken: string;
}

export interface SecurityEvaluationWebOriginChallenge {
  assetId: string;
  origin: string;
  method: SecurityEvaluationWebOriginVerificationMethod;
  token: string;
  /** Publish this TXT record (DNS_TXT). */
  dnsRecordName?: string;
  dnsRecordValue?: string;
  /** Publish the token at this URL (WELL_KNOWN). */
  wellKnownUrl?: string;
}

export interface SecurityEvaluationWebOriginVerificationResult {
  assetId: string;
  origin: string;
  status: SecurityEvaluationWebOriginVerificationStatus;
  verifiedAt: Date | null;
  lastVerifiedAt: Date | null;
  consecutiveFailures: number;
}

export interface SecurityEvaluationWebOriginTarget {
  subjectId: string;
  assetId: string;
  origin: string;
  label: string;
  environment: string;
  targetPaths: Record<string, string>;
}

/**
 * SecurityEvaluationWebOriginService — registration and ownership verification
 * of web-origin assets (ADR-066 §1, ADR-044 §2).
 *
 * Registration is one transaction: subject, asset and the web-origin record
 * either all exist or none do, so a half-registered origin can never enter the
 * evaluation pipeline. Identity lives on the asset (`naturalKey` is the
 * normalized origin, `displayName` the label) and attribution lives on the
 * provenance rows — this service only owns what is specific to a web origin:
 * environment, target paths and the verification lifecycle.
 *
 * Verification is host-driven: the module generates the token and compares
 * published values through `VerificationFetchAccess`, but never performs
 * network I/O itself. Re-verification is lazy (`listActiveVerified`) because
 * the module registers no scheduler; an origin whose failures exceed the
 * configured threshold drops to `FAILED` and stops being evaluated.
 */
@Injectable()
export class SecurityEvaluationWebOriginService {
  private readonly verificationIntervalMs: number;
  private readonly reverifyFailureThreshold: number;
  private readonly tokenBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subjects: EvaluationSubjectService,
    private readonly assets: SecurityEvaluationAssetService,
    config: ConfigService,
    @Optional()
    @Inject(securityEvaluationVerificationFetchAccessToken)
    private readonly verificationFetch?: VerificationFetchAccess,
  ) {
    this.verificationIntervalMs =
      requirePositiveInteger(
        Number(config.getOrThrow<string>(VERIFICATION_INTERVAL_DAYS_KEY)),
        VERIFICATION_INTERVAL_DAYS_KEY,
      ) * DAYS_MS;
    this.reverifyFailureThreshold = requirePositiveInteger(
      Number(config.getOrThrow<string>(REVERIFY_FAILURE_THRESHOLD_KEY)),
      REVERIFY_FAILURE_THRESHOLD_KEY,
    );
    this.tokenBytes = requirePositiveInteger(Number(config.getOrThrow<string>(TOKEN_BYTES_KEY)), TOKEN_BYTES_KEY);
    if (this.tokenBytes > MAX_TOKEN_BYTES) {
      throw new Error(`${TOKEN_BYTES_KEY} must be at most ${MAX_TOKEN_BYTES} bytes (VarChar(64) base64url).`);
    }
  }

  /**
   * Register an origin: platform-level subject + asset + verification record,
   * atomically. Re-registration is idempotent and never resets verification —
   * it only refreshes the label, environment and target paths.
   */
  async create(input: CreateSecurityEvaluationWebOriginInput): Promise<SecurityEvaluationWebOriginRegistration> {
    const origin = normalizeWebOrigin(input.origin);
    const environment = requireEnvironment(input.environment);
    const targetPaths = normalizeTargetPaths(input.targetPaths);
    const label = input.label?.trim() || origin;
    const verificationToken = this.generateToken();

    return this.prisma.$transaction(async (transaction) => {
      const subject = await this.subjects.getOrCreateSubject(
        {
          kind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
          scopeType: SECURITY_EVALUATION_PLATFORM_SCOPE_TYPE,
          scopeId: SECURITY_EVALUATION_PLATFORM_SCOPE_ID,
          subjectKey: origin,
          displayName: label,
        },
        transaction,
      );
      const asset = await this.assets.getOrCreateAsset(toSubjectRef(subject), transaction);
      const webOrigin = await transaction.securityEvaluationWebOrigin.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          environment,
          targetPaths: targetPaths as Prisma.InputJsonValue,
          verificationToken,
        },
        update: {
          environment,
          targetPaths: targetPaths as Prisma.InputJsonValue,
        },
      });
      const now = new Date();
      await transaction.securityEvaluationAssetProvenance.upsert({
        where: {
          subjectId_sourceType_sourceId: {
            subjectId: subject.id,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
          },
        },
        create: {
          subjectId: subject.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          firstSubmittedAt: now,
          lastSubmittedAt: now,
        },
        update: { lastSubmittedAt: now },
      });

      return {
        subjectId: subject.id,
        assetId: asset.id,
        webOriginId: webOrigin.id,
        origin,
        verificationStatus: webOrigin.verificationStatus as SecurityEvaluationWebOriginVerificationStatus,
        verificationToken: webOrigin.verificationToken,
      };
    });
  }

  /**
   * Return the challenge to publish. The token is reused while it is the one
   * the operator may have already published; a `FAILED` origin gets a fresh
   * token because the old one was exposed long enough to fail repeatedly.
   */
  async requestVerification(
    assetId: string,
    method: SecurityEvaluationWebOriginVerificationMethod,
  ): Promise<SecurityEvaluationWebOriginChallenge> {
    requireVerificationMethod(method);
    const row = await this.getWebOrigin(assetId);
    if (row.verificationStatus === "REVOKED") {
      throw new BadRequestException(`Web origin ${row.asset.naturalKey} is revoked and cannot be verified.`);
    }

    const regenerate = row.verificationStatus === "FAILED";
    const token = regenerate ? this.generateToken() : row.verificationToken;
    await this.prisma.securityEvaluationWebOrigin.update({
      where: { assetId },
      data: {
        verificationMethod: method,
        verificationToken: token,
        ...(regenerate ? { verificationFailures: 0 } : {}),
        ...(row.verificationStatus === "VERIFIED" ? {} : { verificationStatus: "PENDING" }),
      },
    });

    return buildChallenge(assetId, row.asset.naturalKey, method, token);
  }

  /**
   * Check the published token and persist the outcome. A transport failure is
   * a failed verification (the origin could not be proven), which is what the
   * three-strike rule is meant to catch.
   */
  async verify(assetId: string): Promise<SecurityEvaluationWebOriginVerificationResult> {
    const fetch = this.verificationFetch;
    if (!fetch) {
      throw new InternalServerErrorException(
        `${securityEvaluationVerificationFetchAccessToken} is not bound; the host must implement web-origin verification reads.`,
      );
    }

    const row = await this.getWebOrigin(assetId);
    if (row.verificationStatus === "REVOKED") {
      throw new BadRequestException(`Web origin ${row.asset.naturalKey} is revoked and cannot be verified.`);
    }
    const method = row.verificationMethod as SecurityEvaluationWebOriginVerificationMethod | null;
    if (!method) {
      throw new BadRequestException(
        `Web origin ${row.asset.naturalKey} has no verification method; request one first.`,
      );
    }

    const matched = await this.matchesPublishedToken(fetch, row.asset.naturalKey, method, row.verificationToken);
    const now = new Date();

    if (matched) {
      const updated = await this.prisma.securityEvaluationWebOrigin.update({
        where: { assetId },
        data: {
          verificationStatus: "VERIFIED",
          verifiedAt: row.verifiedAt ?? now,
          lastVerifiedAt: now,
          verificationFailures: 0,
        },
      });
      return toVerificationResult(assetId, row.asset.naturalKey, updated);
    }

    const failures = row.verificationFailures + 1;
    const updated = await this.prisma.securityEvaluationWebOrigin.update({
      where: { assetId },
      data: {
        verificationFailures: failures,
        verificationStatus: failures >= this.reverifyFailureThreshold ? "FAILED" : row.verificationStatus,
      },
    });
    return toVerificationResult(assetId, row.asset.naturalKey, updated);
  }

  /**
   * The submission gate: active, verified origins, lazily re-verified when the
   * configured interval has elapsed. Rows that fail past the threshold are no
   * longer returned.
   */
  async listActiveVerified(): Promise<SecurityEvaluationWebOriginTarget[]> {
    const rows = await this.prisma.securityEvaluationWebOrigin.findMany({
      where: { isActive: true, verificationStatus: "VERIFIED" },
      include: { asset: true },
      orderBy: { assetId: "asc" },
    });

    const targets: SecurityEvaluationWebOriginTarget[] = [];
    for (const row of rows) {
      const due = !row.lastVerifiedAt || Date.now() - row.lastVerifiedAt.getTime() >= this.verificationIntervalMs;
      let status = row.verificationStatus;
      if (due) {
        try {
          status = (await this.verify(row.assetId)).status;
        } catch {
          // A host-side lookup error is already counted inside verify(); an
          // unbound port or a missing method leaves the row untouched.
          status = row.verificationStatus;
        }
      }
      if (status !== "VERIFIED") continue;
      targets.push({
        subjectId: row.asset.subjectId,
        assetId: row.assetId,
        origin: row.asset.naturalKey,
        label: row.asset.displayName,
        environment: row.environment,
        targetPaths: parseTargetPaths(row.targetPaths),
      });
    }
    return targets;
  }

  /** The role → relative-path map the evidence providers resolve targets from. */
  async pathRoles(assetId: string): Promise<Record<string, string>> {
    const row = await this.getWebOrigin(assetId);
    return parseTargetPaths(row.targetPaths);
  }

  private async getWebOrigin(assetId: string) {
    const row = await this.prisma.securityEvaluationWebOrigin.findUnique({
      where: { assetId },
      include: { asset: true },
    });
    if (!row) throw new NotFoundException(`Security evaluation web origin ${assetId} not found`);
    return row;
  }

  private async matchesPublishedToken(
    fetch: VerificationFetchAccess,
    origin: string,
    method: SecurityEvaluationWebOriginVerificationMethod,
    token: string,
  ): Promise<boolean> {
    const host = new URL(origin).hostname;
    try {
      if (method === "DNS_TXT") {
        const values = await fetch.lookupTxt(`${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX}.${host}`);
        return values.some(
          (value) => value.trim() === `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX}${token}`,
        );
      }
      const body = await fetch.fetchText(`https://${host}${SECURITY_EVALUATION_WEB_ORIGIN_WELL_KNOWN_PATH}`);
      return body.trim() === token;
    } catch {
      return false;
    }
  }

  private generateToken(): string {
    return randomBytes(this.tokenBytes).toString("base64url");
  }
}

/**
 * Canonical origin (RFC 6454): lowercase scheme/host, IDN as punycode without a
 * trailing dot, default ports omitted, no trailing slash (ADR-066 §1). Paths,
 * queries and fragments are rejected — path-level targets belong to
 * `targetPaths`, not to the subject identity.
 */
export function normalizeWebOrigin(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BadRequestException(`Invalid web origin '${input}'.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestException(`Web origin '${input}' must use http or https.`);
  }
  if (url.username || url.password) {
    throw new BadRequestException(`Web origin '${input}' must not carry credentials.`);
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new BadRequestException(`Web origin '${input}' must not carry a path, query or fragment.`);
  }
  const hostname = url.hostname.replace(/\.$/, "");
  if (!hostname) {
    throw new BadRequestException(`Web origin '${input}' has no host.`);
  }
  return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`;
}

function normalizeTargetPaths(input?: Record<string, string>): Record<string, string> {
  if (!input) return {};
  const normalized: Record<string, string> = {};
  for (const [role, value] of Object.entries(input)) {
    if (!(SECURITY_EVALUATION_WEB_ORIGIN_PATH_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException(
        `Unknown target path role '${role}'; expected one of ${SECURITY_EVALUATION_WEB_ORIGIN_PATH_ROLES.join(", ")}.`,
      );
    }
    const path = value.trim();
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new BadRequestException(`Target path for '${role}' must be an absolute path on the origin.`);
    }
    normalized[role] = path;
  }
  return normalized;
}

function parseTargetPaths(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const parsed: Record<string, string> = {};
  for (const [role, path] of Object.entries(value)) {
    if (typeof path === "string") parsed[role] = path;
  }
  return parsed;
}

function buildChallenge(
  assetId: string,
  origin: string,
  method: SecurityEvaluationWebOriginVerificationMethod,
  token: string,
): SecurityEvaluationWebOriginChallenge {
  const host = new URL(origin).hostname;
  if (method === "DNS_TXT") {
    return {
      assetId,
      origin,
      method,
      token,
      dnsRecordName: `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX}.${host}`,
      dnsRecordValue: `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX}${token}`,
    };
  }
  return {
    assetId,
    origin,
    method,
    token,
    wellKnownUrl: `https://${host}${SECURITY_EVALUATION_WEB_ORIGIN_WELL_KNOWN_PATH}`,
  };
}

function toVerificationResult(
  assetId: string,
  origin: string,
  row: {
    verificationStatus: string;
    verifiedAt: Date | null;
    lastVerifiedAt: Date | null;
    verificationFailures: number;
  },
): SecurityEvaluationWebOriginVerificationResult {
  return {
    assetId,
    origin,
    status: row.verificationStatus as SecurityEvaluationWebOriginVerificationStatus,
    verifiedAt: row.verifiedAt,
    lastVerifiedAt: row.lastVerifiedAt,
    consecutiveFailures: row.verificationFailures,
  };
}

function requireVerificationMethod(method: string): void {
  if (!(SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS as readonly string[]).includes(method)) {
    throw new BadRequestException(
      `Unknown verification method '${method}'; expected one of ${SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS.join(", ")}.`,
    );
  }
}

function requireEnvironment(environment: string): string {
  const value = environment?.trim();
  if (!value || value.length > 32) {
    throw new BadRequestException("environment must be a non-empty string of at most 32 characters.");
  }
  return value;
}
