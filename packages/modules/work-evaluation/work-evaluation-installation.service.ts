import { Injectable, NotFoundException } from "@nestjs/common";
import { Installation, InstallationKind } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { InstallationCredentialService } from "@modules/security/installation/installation-credential.service";
import {
  DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS,
  isInstallationOnline,
} from "@modules/security/installation/installation-presence";
import {
  CreateWorkEvaluationInstallationRequestDto,
  WorkEvaluationInstallationCredentialResponseDto,
} from "./work-evaluation.dto";

/** Expected interval between installation reports, in seconds. */
export const WORK_EVALUATION_REPORT_INTERVAL_SECONDS = 60;

/** An installation agent that has not reported for this long is shown as offline. */
export const WORK_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS = DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS;

/** Audit resource type for installation credential events. */
const AUDIT_RESOURCE_TYPE = "work-evaluation-installation";

/** Evaluatee binding and host facts stored next to the shared installation row. */
interface WorkEvaluationAgentState {
  developerId: string;
  hostname: string | null;
}

/** Projection returned by the supervisor API. No credential material. */
export interface WorkEvaluationInstallationView {
  id: string;
  label: string;
  developerId: string;
  hostname: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  online: boolean;
  createdAt: Date;
}

/**
 * Enrollment registry for member-side installation agents (ADR-024).
 *
 * Identity and credential live in the shared `Installation` row (ADR-078);
 * this service adds the evaluatee binding (`developerId`), which is the single
 * authorization fact for ingest: an agent may only write evidence for its own
 * evaluatee, so a leaked token cannot write for another member.
 */
@Injectable()
export class WorkEvaluationInstallationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: InstallationCredentialService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** Enroll an installation. The plaintext token is returned ONCE. */
  async create(
    input: CreateWorkEvaluationInstallationRequestDto,
    actor?: string,
  ): Promise<WorkEvaluationInstallationCredentialResponseDto> {
    const { installation, token } = await this.credentials.create({
      kind: InstallationKind.WORK_EVALUATION,
      label: input.label,
    });
    await this.prisma.workEvaluationAgentState.create({
      data: {
        installationId: installation.id,
        developerId: input.developerId,
        hostname: input.hostname ?? null,
      },
    });
    await this.recordAudit("work-evaluation.installation.created", installation.id, actor, {
      label: input.label,
      developerId: input.developerId,
    });
    return {
      ...this.toView(installation, { developerId: input.developerId, hostname: input.hostname ?? null }),
      token,
    };
  }

  async list(query: { developerId?: string }) {
    const states = await this.prisma.workEvaluationAgentState.findMany({
      where: query.developerId ? { developerId: query.developerId } : undefined,
    });
    if (states.length === 0) return [];
    const installations = await this.prisma.installation.findMany({
      where: { kind: InstallationKind.WORK_EVALUATION, id: { in: states.map((state) => state.installationId) } },
      orderBy: { issuedAt: "desc" },
    });
    const statesByInstallation = new Map(states.map((state) => [state.installationId, state]));
    return installations.map((installation) =>
      this.toView(installation, statesByInstallation.get(installation.id) as WorkEvaluationAgentState),
    );
  }

  /** Resolve the evaluatee an ingest request may write for. */
  async resolveScope(installationId: string): Promise<{ installationId: string; developerId: string }> {
    const state = await this.prisma.workEvaluationAgentState.findUnique({
      where: { installationId },
      select: { developerId: true },
    });
    if (!state) throw new NotFoundException(`Installation ${installationId} has no evaluatee binding.`);
    return { installationId, developerId: state.developerId };
  }

  async getOrThrow(id: string): Promise<Installation> {
    const installation = await this.prisma.installation.findFirst({
      where: { id, kind: InstallationKind.WORK_EVALUATION },
    });
    if (!installation) throw new NotFoundException(`Installation ${id} not found.`);
    return installation;
  }

  async get(id: string) {
    const installation = await this.getOrThrow(id);
    const state = await this.prisma.workEvaluationAgentState.findUnique({ where: { installationId: id } });
    if (!state) throw new NotFoundException(`Installation ${id} has no evaluatee binding.`);
    return this.toView(installation, state);
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string): Promise<WorkEvaluationInstallationCredentialResponseDto> {
    await this.getOrThrow(id);
    const { token } = await this.credentials.rotate(id);
    await this.recordAudit("work-evaluation.installation.token_rotated", id, actor);
    return { ...(await this.get(id)), token };
  }

  /** Soft revocation: ingest is rejected (401), reported rows are retained. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    const revokedAt = new Date();
    await this.credentials.setRevokedAt(id, revokedAt);
    await this.recordAudit("work-evaluation.installation.revoked", id, actor);
    return { id, revokedAt };
  }

  /**
   * Refresh liveness on ingest in a single statement: firstSeenAt is set once
   * (COALESCE), lastSeenAt always moves forward. One round trip, no read first.
   */
  async touchOnIngest(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "module/security"."Installation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", NOW()),
          "lastSeenAt" = NOW(),
          "updatedAt" = NOW()
      WHERE "id" = ${id}::uuid
    `;
  }

  private toView(installation: Installation, state: WorkEvaluationAgentState): WorkEvaluationInstallationView {
    return {
      id: installation.id,
      label: installation.label,
      developerId: state.developerId,
      hostname: state.hostname,
      firstSeenAt: installation.firstSeenAt,
      lastSeenAt: installation.lastSeenAt,
      revokedAt: installation.revokedAt,
      online:
        !installation.revokedAt &&
        installation.lastSeenAt != null &&
        isInstallationOnline(
          installation.lastSeenAt,
          WORK_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS,
          Date.now(),
        ),
      createdAt: installation.createdAt,
    };
  }

  private async recordAudit(
    action: string,
    resourceId: string,
    actor?: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogService.record(action, {
      resourceType: AUDIT_RESOURCE_TYPE,
      resourceId,
      actorId: actor ?? null,
      actorType: actor ? "user" : "system",
      detail,
    });
  }
}
