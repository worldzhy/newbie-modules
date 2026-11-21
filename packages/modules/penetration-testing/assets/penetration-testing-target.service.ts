import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationSubjectService } from "@modules/evaluation/evaluation-subject.service";

import {
  PENETRATION_TESTING_DNS_TXT_NAME_PREFIX,
  PENETRATION_TESTING_DNS_TXT_VALUE_PREFIX,
  PENETRATION_TESTING_ENVIRONMENTS,
  PENETRATION_TESTING_PATH_ROLES,
  PENETRATION_TESTING_REVERIFY_FAILURE_THRESHOLD,
  PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET,
  PENETRATION_TESTING_SUBJECT_TYPE,
  PENETRATION_TESTING_TOKEN_BYTES,
  PENETRATION_TESTING_VERIFICATION_INTERVAL_DAYS,
  PENETRATION_TESTING_VERIFICATION_METHODS,
  PENETRATION_TESTING_WELL_KNOWN_PATH,
  type PenetrationTestingEnvironment,
  type PenetrationTestingVerificationMethod,
} from "../penetration-testing.constants";
import {
  PENETRATION_TESTING_VERIFICATION_ACCESS,
  type PenetrationVerificationAccess,
} from "../ports/verification.access";

const DAYS_MS = 86_400_000;
const MAX_DECLARED_PORTS = 64;
const TARGET_PATH_MAX_LENGTH = 255;

export interface CreatePenetrationTestingTargetInput {
  /** Origin (`scheme://host[:port]`); normalized before anything is written. */
  origin: string;
  /** Label shown in the UI; defaults to the normalized origin. */
  label?: string;
  environment: PenetrationTestingEnvironment;
  /** Ports the authorization declares; empty means the scheme default. */
  declaredPorts?: number[];
  /** Path role → relative path; unknown roles are rejected. */
  targetPaths?: Record<string, string>;
}

export interface PenetrationTestingTargetRegistration {
  subjectId: string;
  targetId: string;
  origin: string;
  environment: PenetrationTestingEnvironment;
  verificationStatus: string;
  verificationToken: string;
}

export interface PenetrationTestingTargetMaterial {
  subjectId: string;
  origin: string;
  label: string;
  environment: PenetrationTestingEnvironment;
  ports: number[];
  targetPaths: Record<string, string>;
  verificationStatus: string;
  verificationMethod: PenetrationTestingVerificationMethod | null;
  verificationFailureCount: number;
  verifiedAt: Date | null;
  lastVerifiedAt: Date | null;
  isActive: boolean;
}

export interface PenetrationTestingActiveTarget {
  subjectId: string;
  origin: string;
  label: string;
  environment: PenetrationTestingEnvironment;
  ports: number[];
  targetPaths: Record<string, string>;
}

export interface PenetrationTestingVerificationCheck {
  subjectId: string;
  origin: string;
  status: string;
  verifiedAt: Date | null;
  lastVerifiedAt: Date | null;
  consecutiveFailures: number;
}

/**
 * PenetrationTestingTargetService — registration and ownership verification of
 * web-target subjects (ADR-075 §4, ADR-044 §2 shape).
 *
 * Registration is one transaction: the subject and the target material either
 * both exist or neither do. Verification is host-driven: the module mints the
 * token and compares published values through `PenetrationVerificationAccess`,
 * but never performs network I/O itself. Re-verification is lazy because the
 * module registers no scheduler; failures past the policy threshold drop the
 * row to `FAILED` and stop evaluation.
 */
@Injectable()
export class PenetrationTestingTargetService {
  private readonly verificationIntervalMs = PENETRATION_TESTING_VERIFICATION_INTERVAL_DAYS * DAYS_MS;
  private readonly reverifyFailureThreshold = PENETRATION_TESTING_REVERIFY_FAILURE_THRESHOLD;
  private readonly tokenBytes = PENETRATION_TESTING_TOKEN_BYTES;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subjects: EvaluationSubjectService,
    @Optional()
    @Inject(PENETRATION_TESTING_VERIFICATION_ACCESS)
    private readonly verificationFetch?: PenetrationVerificationAccess,
  ) {}

  /**
   * Register a target idempotently. Declared material is refreshed in place, but
   * verification is reset only when that material changes: an identical
   * re-registration keeps the token and the status, while a changed environment,
   * port set or path map rotates the token and drops the row to `PENDING` so the
   * gate refuses it until the new material is verified. A `REVOKED` row can
   * never be resurrected.
   */
  async create(input: CreatePenetrationTestingTargetInput): Promise<PenetrationTestingTargetRegistration> {
    const origin = normalizeWebOrigin(input.origin);
    const environment = requireEnvironment(input.environment);
    const ports = normalizeDeclaredPorts(input.declaredPorts);
    const targetPaths = input.targetPaths === undefined ? undefined : normalizeTargetPaths(input.targetPaths);
    const label = input.label?.trim() || origin;
    const verificationToken = this.generateToken();

    return this.prisma.$transaction(async (transaction) => {
      const subject = await this.subjects.getOrCreateSubject(
        {
          subjectType: PENETRATION_TESTING_SUBJECT_TYPE,
          kind: PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET,
          subjectKey: origin,
          displayName: label,
        },
        transaction,
      );
      const existing = await transaction.penetrationTestingTarget.findUnique({
        where: { subjectId: subject.id },
      });
      if (existing?.verificationStatus === "REVOKED") {
        throw new ConflictException(`Penetration target ${origin} is revoked and cannot be re-registered.`);
      }

      const materialChanged =
        existing === null ||
        existing.environment !== environment ||
        !samePortSet(existing.declaredPorts, ports) ||
        (targetPaths !== undefined && !samePathMap(parseTargetPaths(existing.targetPaths), targetPaths));

      const target = existing
        ? await transaction.penetrationTestingTarget.update({
            where: { subjectId: subject.id },
            data: {
              environment,
              declaredPorts: ports,
              ...(targetPaths !== undefined ? { targetPaths: targetPaths as Prisma.InputJsonValue } : {}),
              ...(materialChanged
                ? {
                    verificationToken,
                    verificationStatus: "PENDING",
                    verificationMethod: null,
                    verifiedAt: null,
                    lastVerifiedAt: null,
                    verificationFailureCount: 0,
                  }
                : {}),
            },
          })
        : await transaction.penetrationTestingTarget.create({
            data: {
              subjectId: subject.id,
              environment,
              declaredPorts: ports,
              targetPaths: (targetPaths ?? {}) as Prisma.InputJsonValue,
              verificationToken,
            },
          });

      return {
        subjectId: subject.id,
        targetId: target.id,
        origin,
        environment,
        verificationStatus: target.verificationStatus,
        verificationToken: target.verificationToken,
      };
    });
  }

  /** Probe both placements in order and persist the outcome (ADR-074 D3 shape). */
  async checkVerification(subjectId: string): Promise<PenetrationTestingVerificationCheck> {
    const fetch = this.verificationFetch;
    if (!fetch) {
      throw new InternalServerErrorException(
        `${PENETRATION_TESTING_VERIFICATION_ACCESS} is not bound; the host must implement target verification reads.`,
      );
    }

    const { row, subject } = await this.getTarget(subjectId);
    if (row.verificationStatus === "REVOKED") {
      throw new BadRequestException(`Penetration target ${subject.subjectKey} is revoked and cannot be verified.`);
    }

    const matchedMethod = await this.probePublishedToken(fetch, subject.subjectKey, row.verificationToken);
    const now = new Date();

    if (matchedMethod) {
      const updated = await this.prisma.penetrationTestingTarget.update({
        where: { subjectId },
        data: {
          verificationStatus: "VERIFIED",
          verificationMethod: matchedMethod,
          verifiedAt: row.verifiedAt ?? now,
          lastVerifiedAt: now,
          verificationFailureCount: 0,
        },
      });
      return toVerificationCheck(subjectId, subject.subjectKey, updated);
    }

    const failures = row.verificationFailureCount + 1;
    const updated = await this.prisma.penetrationTestingTarget.update({
      where: { subjectId },
      data: {
        verificationFailureCount: failures,
        verificationStatus: failures >= this.reverifyFailureThreshold ? "FAILED" : row.verificationStatus,
      },
    });
    return toVerificationCheck(subjectId, subject.subjectKey, updated);
  }

  /**
   * The submission gate: active, verified targets, lazily re-verified when the
   * interval has elapsed. Rows that fail past the threshold are not returned.
   */
  async listActiveVerified(): Promise<PenetrationTestingActiveTarget[]> {
    const rows = await this.prisma.penetrationTestingTarget.findMany({
      where: { isActive: true, verificationStatus: "VERIFIED" },
      orderBy: { subjectId: "asc" },
    });
    const subjects = rows.length
      ? await this.prisma.evaluationSubject.findMany({
          where: { id: { in: rows.map((row) => row.subjectId) } },
          select: { id: true, subjectKey: true, displayName: true },
        })
      : [];
    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));

    const targets: PenetrationTestingActiveTarget[] = [];
    for (const row of rows) {
      const subject = subjectById.get(row.subjectId);
      if (!subject) continue;
      const due = !row.lastVerifiedAt || Date.now() - row.lastVerifiedAt.getTime() >= this.verificationIntervalMs;
      let status = row.verificationStatus;
      if (due) {
        try {
          status = (await this.checkVerification(row.subjectId)).status;
        } catch {
          // A host-side lookup error is already counted inside checkVerification();
          // an unbound port leaves the row untouched.
          status = row.verificationStatus;
        }
      }
      if (status !== "VERIFIED") continue;
      targets.push({
        subjectId: row.subjectId,
        origin: subject.subjectKey,
        label: subject.displayName,
        environment: row.environment as PenetrationTestingEnvironment,
        ports: row.declaredPorts,
        targetPaths: parseTargetPaths(row.targetPaths),
      });
    }
    return targets;
  }

  /** The role → relative-path map the evidence provider resolves targets from. */
  async pathRoles(subjectId: string): Promise<Record<string, string>> {
    const { row } = await this.getTarget(subjectId);
    return parseTargetPaths(row.targetPaths);
  }

  /** Target material for a run; throws when the subject has no target row. */
  async material(subjectId: string): Promise<PenetrationTestingTargetMaterial> {
    const { row, subject } = await this.getTarget(subjectId);
    return {
      subjectId,
      origin: subject.subjectKey,
      label: subject.displayName,
      environment: row.environment as PenetrationTestingEnvironment,
      ports: row.declaredPorts,
      targetPaths: parseTargetPaths(row.targetPaths),
      verificationStatus: row.verificationStatus,
      verificationMethod: row.verificationMethod as PenetrationTestingVerificationMethod | null,
      verificationFailureCount: row.verificationFailureCount,
      verifiedAt: row.verifiedAt,
      lastVerifiedAt: row.lastVerifiedAt,
      isActive: row.isActive,
    };
  }

  async deactivate(subjectId: string): Promise<void> {
    await this.getTarget(subjectId);
    await this.prisma.penetrationTestingTarget.update({ where: { subjectId }, data: { isActive: false } });
  }

  /** Raw row + subject, used by the run gate. */
  async getTarget(subjectId: string) {
    const row = await this.prisma.penetrationTestingTarget.findUnique({ where: { subjectId } });
    if (!row) throw new NotFoundException(`Penetration testing target ${subjectId} not found`);
    const subject = await this.prisma.evaluationSubject.findUnique({
      where: { id: subjectId },
      select: { subjectKey: true, displayName: true },
    });
    if (!subject) throw new NotFoundException(`Evaluation subject ${subjectId} not found`);
    return { row, subject };
  }

  /** First placement that shows the token wins; DNS first, then `.well-known`. */
  private async probePublishedToken(
    fetch: PenetrationVerificationAccess,
    origin: string,
    token: string,
  ): Promise<PenetrationTestingVerificationMethod | null> {
    for (const method of PENETRATION_TESTING_VERIFICATION_METHODS) {
      if (await this.matchesPublishedToken(fetch, origin, method, token)) return method;
    }
    return null;
  }

  private async matchesPublishedToken(
    fetch: PenetrationVerificationAccess,
    origin: string,
    method: PenetrationTestingVerificationMethod,
    token: string,
  ): Promise<boolean> {
    const host = new URL(origin).hostname;
    try {
      if (method === "DNS_TXT") {
        const values = await fetch.lookupTxt(`${PENETRATION_TESTING_DNS_TXT_NAME_PREFIX}.${host}`);
        return values.some((value) => value.trim() === `${PENETRATION_TESTING_DNS_TXT_VALUE_PREFIX}${token}`);
      }
      const body = await fetch.fetchText(`https://${host}${PENETRATION_TESTING_WELL_KNOWN_PATH}`);
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
 * trailing dot, default ports omitted, no trailing slash. Paths, queries and
 * fragments are rejected — path-level targets belong to `targetPaths`.
 */
export function normalizeWebOrigin(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BadRequestException(`Invalid web target '${input}'.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestException(`Web target '${input}' must use http or https.`);
  }
  if (url.username || url.password) {
    throw new BadRequestException(`Web target '${input}' must not carry credentials.`);
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new BadRequestException(`Web target '${input}' must not carry a path, query or fragment.`);
  }
  const hostname = url.hostname.replace(/\.$/, "");
  if (!hostname) {
    throw new BadRequestException(`Web target '${input}' has no host.`);
  }
  return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`;
}

export function normalizeDeclaredPorts(input?: number[]): number[] {
  if (!input || input.length === 0) return [];
  const ports = [...new Set(input)].sort((left, right) => left - right);
  if (ports.length > MAX_DECLARED_PORTS) {
    throw new BadRequestException(`At most ${MAX_DECLARED_PORTS} declared ports are allowed.`);
  }
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new BadRequestException(`Declared port '${port}' must be an integer between 1 and 65535.`);
    }
  }
  return ports;
}

export function normalizeTargetPaths(input?: Record<string, string>): Record<string, string> {
  if (!input) return {};
  const normalized: Record<string, string> = {};
  for (const [role, value] of Object.entries(input)) {
    if (!(PENETRATION_TESTING_PATH_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException(
        `Unknown target path role '${role}'; expected one of ${PENETRATION_TESTING_PATH_ROLES.join(", ")}.`,
      );
    }
    const path = value.trim();
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new BadRequestException(`Target path for '${role}' must be an absolute path on the target.`);
    }
    if (path.length > TARGET_PATH_MAX_LENGTH) {
      throw new BadRequestException(`Target path for '${role}' must be at most ${TARGET_PATH_MAX_LENGTH} characters.`);
    }
    normalized[role] = path;
  }
  return normalized;
}

function requireEnvironment(value: string): PenetrationTestingEnvironment {
  if (!(PENETRATION_TESTING_ENVIRONMENTS as readonly string[]).includes(value)) {
    throw new BadRequestException(
      `Environment '${value}' is not supported; expected ${PENETRATION_TESTING_ENVIRONMENTS.join(" or ")}.`,
    );
  }
  return value as PenetrationTestingEnvironment;
}

function parseTargetPaths(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const parsed: Record<string, string> = {};
  for (const [role, path] of Object.entries(value)) {
    if (typeof path === "string") parsed[role] = path;
  }
  return parsed;
}

/** Port lists are a set: stored order is not part of the declared material. */
function samePortSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort((a, b) => a - b);
  const rightSorted = [...right].sort((a, b) => a - b);
  return leftSorted.every((port, index) => port === rightSorted[index]);
}

/** JSONB does not preserve key order, so compare the map by key/value pairs. */
function samePathMap(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return rightKeys.every((key) => left[key] === right[key]);
}

function toVerificationCheck(
  subjectId: string,
  origin: string,
  row: {
    verificationStatus: string;
    verifiedAt: Date | null;
    lastVerifiedAt: Date | null;
    verificationFailureCount: number;
  },
): PenetrationTestingVerificationCheck {
  return {
    subjectId,
    origin,
    status: row.verificationStatus,
    verifiedAt: row.verifiedAt,
    lastVerifiedAt: row.lastVerifiedAt,
    consecutiveFailures: row.verificationFailureCount,
  };
}
