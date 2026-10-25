import { Injectable, NotFoundException } from "@nestjs/common";
import { PeopleEvaluationInstallation, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import {
  InstallationCredentialAudit,
  InstallationCredentialStore,
  issueInstallationCredential,
  revokeInstallationCredential,
  rotateInstallationCredential,
} from "@modules/security/installation/installation-credential";
import { prismaInstallationCredentialStore } from "@modules/security/installation/prisma-installation-credential-store";
import { InstallationTokenVerifier } from "@modules/security/installation/installation-token.verifier";
import {
  CreatePeopleEvaluationInstallationRequestDto,
  PeopleEvaluationInstallationCredentialResponseDto,
} from "./people-evaluation.dto";

/** An installation agent that has not reported for this long is shown as offline. */
export const PEOPLE_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS = 180;

/** Database schema for the people-evaluation module (mirrors prisma @@schema). */
const PEOPLE_EVALUATION_SCHEMA = "module/people-evaluation";

/** Audit resource type for installation credential events. */
const AUDIT_RESOURCE_TYPE = "people-evaluation-installation";

/** Domain columns stored next to the credential (ADR-019). */
interface PeopleEvaluationInstallationDraft {
  label: string;
  evaluateeUserId: string;
  hostname: string | null;
}

/**
 * Enrollment registry for member-side installation agents (ADR-029).
 *
 * Token generation, hashing, lifecycle and verification come from security
 * (ADR-019); this class only adapts the table and projects domain state. The
 * row still pins the evaluatee the token may report for, so a leaked token
 * cannot write evidence for another member.
 */
@Injectable()
export class PeopleEvaluationInstallationService {
  private readonly credentials: InstallationCredentialStore<
    PeopleEvaluationInstallationDraft,
    PeopleEvaluationInstallation
  >;
  private readonly tokenVerifier: InstallationTokenVerifier<PeopleEvaluationInstallation>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.credentials = prismaInstallationCredentialStore<
      PeopleEvaluationInstallationDraft,
      PeopleEvaluationInstallation
    >(this.prisma.peopleEvaluationInstallation);
    this.tokenVerifier = new InstallationTokenVerifier(this.credentials);
  }

  private credentialAudit(actor?: string): InstallationCredentialAudit {
    return { recorder: this.auditLogService, resourceType: AUDIT_RESOURCE_TYPE, actorId: actor };
  }

  private withDerivedState(row: PeopleEvaluationInstallation) {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - new Date(row.lastSeenAt).getTime() <= PEOPLE_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS * 1000;
    const { tokenHash: _tokenHash, ...rest } = row;
    return { ...rest, online };
  }

  /** Enroll an installation. The plaintext token is returned ONCE. */
  async create(
    input: CreatePeopleEvaluationInstallationRequestDto,
    actor?: string,
  ): Promise<PeopleEvaluationInstallationCredentialResponseDto> {
    const { record, token } = await issueInstallationCredential(
      this.credentials,
      {
        label: input.label,
        evaluateeUserId: input.evaluateeUserId,
        hostname: input.hostname ?? null,
      },
      {
        ...this.credentialAudit(actor),
        detail: { label: input.label, evaluateeUserId: input.evaluateeUserId },
      },
    );
    return { ...this.withDerivedState(record), token };
  }

  async list(query: { evaluateeUserId?: string }) {
    const rows = await this.prisma.peopleEvaluationInstallation.findMany({
      where: query.evaluateeUserId ? { evaluateeUserId: query.evaluateeUserId } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.peopleEvaluationInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string): Promise<PeopleEvaluationInstallationCredentialResponseDto> {
    await this.getOrThrow(id);
    const { token } = await rotateInstallationCredential(this.credentials, id, this.credentialAudit(actor));
    return { ...this.withDerivedState(await this.getOrThrow(id)), token };
  }

  /** Soft revocation: ingest is rejected (401), reported rows are retained. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    return revokeInstallationCredential(this.credentials, id, this.credentialAudit(actor));
  }

  /** Token-only authentication for the ingest endpoints. */
  async resolveByToken(token: string) {
    return this.tokenVerifier.verify(token);
  }

  /**
   * Refresh liveness on ingest in a single statement: firstSeenAt is set once
   * (COALESCE), lastSeenAt always moves forward. One round trip, no read first.
   */
  async touchOnIngest(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE ${Prisma.raw(`"${PEOPLE_EVALUATION_SCHEMA}"."PeopleEvaluationInstallation"`)}
      SET "firstSeenAt" = COALESCE("firstSeenAt", NOW()),
          "lastSeenAt" = NOW()
      WHERE "id" = ${id}::uuid
    `;
  }
}
