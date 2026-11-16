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
import { EvaluationSubjectService } from "@modules/evaluation/evaluation-subject.service";

import { requirePositiveInteger } from "../persistence/security-evaluation-intel-negative-cache.repository";
import {
  SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
  SECURITY_EVALUATION_SUBJECT_TYPE,
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
  /** Path role → relative path; unknown roles are rejected. */
  targetPaths?: Record<string, string>;
}

export interface SecurityEvaluationWebOriginRegistration {
  subjectId: string;
  webOriginId: string;
  origin: string;
  verificationStatus: SecurityEvaluationWebOriginVerificationStatus;
  verificationToken: string;
}

export interface SecurityEvaluationWebOriginChallenge {
  subjectId: string;
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
  subjectId: string;
  origin: string;
  status: SecurityEvaluationWebOriginVerificationStatus;
  verifiedAt: Date | null;
  lastVerifiedAt: Date | null;
  consecutiveFailures: number;
}

export interface SecurityEvaluationWebOriginTarget {
  subjectId: string;
  origin: string;
  label: string;
  targetPaths: Record<string, string>;
}

export interface SecurityEvaluationWebOriginDetail extends SecurityEvaluationWebOriginTarget {
  verificationStatus: SecurityEvaluationWebOriginVerificationStatus;
  verificationMethod: SecurityEvaluationWebOriginVerificationMethod | null;
  verificationToken: string;
  verificationFailureCount: number;
  verifiedAt: Date | null;
  lastVerifiedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * SecurityEvaluationWebOriginService — registration and ownership verification
 * of web-origin subjects (ADR-066 §1, ADR-044 §2, ADR-068 D7).
 *
 * Registration is one transaction: the subject and the web-origin record
 * either both exist or neither do, so a half-registered origin can never enter
 * the evaluation pipeline. Identity lives on the subject (`subjectKey` is the
 * normalized origin, `displayName` the label) — this service only owns what is
 * specific to a web origin: target paths and the verification lifecycle. Provenance lives in the host (ADR-068 D8).
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
   * Register an origin: platform-level subject + verification record,
   * atomically. Re-registration is idempotent and never resets verification —
   * it only refreshes the label and target paths.
   */
  async create(input: CreateSecurityEvaluationWebOriginInput): Promise<SecurityEvaluationWebOriginRegistration> {
    const origin = normalizeWebOrigin(input.origin);
    const targetPaths = normalizeTargetPaths(input.targetPaths);
    const label = input.label?.trim() || origin;
    const verificationToken = this.generateToken();

    return this.prisma.$transaction(async (transaction) => {
      const subject = await this.subjects.getOrCreateSubject(
        {
          subjectType: SECURITY_EVALUATION_SUBJECT_TYPE,
          kind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
          subjectKey: origin,
          displayName: label,
        },
        transaction,
      );
      const webOrigin = await transaction.securityEvaluationWebOrigin.upsert({
        where: { subjectId: subject.id },
        create: {
          subjectId: subject.id,
          targetPaths: targetPaths as Prisma.InputJsonValue,
          verificationToken,
        },
        update: {
          targetPaths: targetPaths as Prisma.InputJsonValue,
        },
      });

      return {
        subjectId: subject.id,
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
    subjectId: string,
    method: SecurityEvaluationWebOriginVerificationMethod,
  ): Promise<SecurityEvaluationWebOriginChallenge> {
    requireVerificationMethod(method);
    const { row, subject } = await this.getWebOrigin(subjectId);
    if (row.verificationStatus === "REVOKED") {
      throw new BadRequestException(`Web origin ${subject.subjectKey} is revoked and cannot be verified.`);
    }

    const regenerate = row.verificationStatus === "FAILED";
    const token = regenerate ? this.generateToken() : row.verificationToken;
    await this.prisma.securityEvaluationWebOrigin.update({
      where: { subjectId },
      data: {
        verificationMethod: method,
        verificationToken: token,
        ...(regenerate ? { verificationFailureCount: 0 } : {}),
        ...(row.verificationStatus === "VERIFIED" ? {} : { verificationStatus: "PENDING" }),
      },
    });

    return buildChallenge(subjectId, subject.subjectKey, method, token);
  }

  /**
   * Check the published token and persist the outcome. A transport failure is
   * a failed verification (the origin could not be proven), which is what the
   * three-strike rule is meant to catch.
   */
  async verify(subjectId: string): Promise<SecurityEvaluationWebOriginVerificationResult> {
    const fetch = this.verificationFetch;
    if (!fetch) {
      throw new InternalServerErrorException(
        `${securityEvaluationVerificationFetchAccessToken} is not bound; the host must implement web-origin verification reads.`,
      );
    }

    const { row, subject } = await this.getWebOrigin(subjectId);
    if (row.verificationStatus === "REVOKED") {
      throw new BadRequestException(`Web origin ${subject.subjectKey} is revoked and cannot be verified.`);
    }
    const method = row.verificationMethod as SecurityEvaluationWebOriginVerificationMethod | null;
    if (!method) {
      throw new BadRequestException(`Web origin ${subject.subjectKey} has no verification method; request one first.`);
    }

    const matched = await this.matchesPublishedToken(fetch, subject.subjectKey, method, row.verificationToken);
    const now = new Date();

    if (matched) {
      const updated = await this.prisma.securityEvaluationWebOrigin.update({
        where: { subjectId },
        data: {
          verificationStatus: "VERIFIED",
          verifiedAt: row.verifiedAt ?? now,
          lastVerifiedAt: now,
          verificationFailureCount: 0,
        },
      });
      return toVerificationResult(subjectId, subject.subjectKey, updated);
    }

    const failures = row.verificationFailureCount + 1;
    const updated = await this.prisma.securityEvaluationWebOrigin.update({
      where: { subjectId },
      data: {
        verificationFailureCount: failures,
        verificationStatus: failures >= this.reverifyFailureThreshold ? "FAILED" : row.verificationStatus,
      },
    });
    return toVerificationResult(subjectId, subject.subjectKey, updated);
  }

  /**
   * The submission gate: active, verified origins, lazily re-verified when the
   * configured interval has elapsed. Rows that fail past the threshold are no
   * longer returned.
   */
  async listActiveVerified(): Promise<SecurityEvaluationWebOriginTarget[]> {
    const rows = await this.prisma.securityEvaluationWebOrigin.findMany({
      where: { isActive: true, verificationStatus: "VERIFIED" },
      orderBy: { subjectId: "asc" },
    });

    const subjectIds = rows.map((row) => row.subjectId);
    const subjects = subjectIds.length
      ? await this.prisma.evaluationSubject.findMany({
          where: { id: { in: subjectIds } },
          select: { id: true, subjectKey: true, displayName: true },
        })
      : [];
    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));

    const targets: SecurityEvaluationWebOriginTarget[] = [];
    for (const row of rows) {
      const subject = subjectById.get(row.subjectId);
      if (!subject) continue;
      const due = !row.lastVerifiedAt || Date.now() - row.lastVerifiedAt.getTime() >= this.verificationIntervalMs;
      let status = row.verificationStatus;
      if (due) {
        try {
          status = (await this.verify(row.subjectId)).status;
        } catch {
          // A host-side lookup error is already counted inside verify(); an
          // unbound port or a missing method leaves the row untouched.
          status = row.verificationStatus;
        }
      }
      if (status !== "VERIFIED") continue;
      targets.push({
        subjectId: row.subjectId,
        origin: subject.subjectKey,
        label: subject.displayName,
        targetPaths: parseTargetPaths(row.targetPaths),
      });
    }
    return targets;
  }

  /** The role → relative-path map the evidence providers resolve targets from. */
  async pathRoles(subjectId: string): Promise<Record<string, string>> {
    const { row } = await this.getWebOrigin(subjectId);
    return parseTargetPaths(row.targetPaths);
  }

  /** One origin with the token and status the operator needs to publish/check it. */
  async detail(subjectId: string): Promise<SecurityEvaluationWebOriginDetail> {
    const { row, subject } = await this.getWebOrigin(subjectId);
    return {
      subjectId,
      origin: subject.subjectKey,
      label: subject.displayName,
      targetPaths: parseTargetPaths(row.targetPaths),
      verificationStatus: row.verificationStatus as SecurityEvaluationWebOriginVerificationStatus,
      verificationMethod: row.verificationMethod as SecurityEvaluationWebOriginVerificationMethod | null,
      verificationToken: row.verificationToken,
      verificationFailureCount: row.verificationFailureCount,
      verifiedAt: row.verifiedAt,
      lastVerifiedAt: row.lastVerifiedAt,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async getWebOrigin(subjectId: string) {
    const row = await this.prisma.securityEvaluationWebOrigin.findUnique({ where: { subjectId } });
    if (!row) throw new NotFoundException(`Security evaluation web origin ${subjectId} not found`);
    const subject = await this.prisma.evaluationSubject.findUnique({
      where: { id: subjectId },
      select: { subjectKey: true, displayName: true },
    });
    if (!subject) throw new NotFoundException(`Evaluation subject ${subjectId} not found`);
    return { row, subject };
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
  subjectId: string,
  origin: string,
  method: SecurityEvaluationWebOriginVerificationMethod,
  token: string,
): SecurityEvaluationWebOriginChallenge {
  const host = new URL(origin).hostname;
  if (method === "DNS_TXT") {
    return {
      subjectId,
      origin,
      method,
      token,
      dnsRecordName: `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX}.${host}`,
      dnsRecordValue: `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX}${token}`,
    };
  }
  return {
    subjectId,
    origin,
    method,
    token,
    wellKnownUrl: `https://${host}${SECURITY_EVALUATION_WEB_ORIGIN_WELL_KNOWN_PATH}`,
  };
}

function toVerificationResult(
  subjectId: string,
  origin: string,
  row: {
    verificationStatus: string;
    verifiedAt: Date | null;
    lastVerifiedAt: Date | null;
    verificationFailureCount: number;
  },
): SecurityEvaluationWebOriginVerificationResult {
  return {
    subjectId,
    origin,
    status: row.verificationStatus as SecurityEvaluationWebOriginVerificationStatus,
    verifiedAt: row.verifiedAt,
    lastVerifiedAt: row.lastVerifiedAt,
    consecutiveFailures: row.verificationFailureCount,
  };
}

function requireVerificationMethod(method: string): void {
  if (!(SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS as readonly string[]).includes(method)) {
    throw new BadRequestException(
      `Unknown verification method '${method}'; expected one of ${SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS.join(", ")}.`,
    );
  }
}
