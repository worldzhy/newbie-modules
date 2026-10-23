import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  PeopleEvaluationPeriod,
  PeopleEvaluationRubricVersion,
  PeriodStatus,
  PeriodType,
  Prisma,
} from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CreatePeopleEvaluationPeriodRequestDto,
  CreatePeopleEvaluationRubricVersionRequestDto,
  CreatePeopleEvaluationAssessmentRequestDto,
  CreatePeopleEvaluationPipPlanRequestDto,
  DeclarePeopleEvaluationHomeGroundRequestDto,
  ListPeopleEvaluationPeriodsRequestDto,
  ReportPeopleEvaluationDocumentRequestDto,
  ReportPeopleEvaluationSessionRequestDto,
  ReportPeopleEvaluationWorkspaceRequestDto,
  ReviewPeopleEvaluationAssessmentRequestDto,
  UpsertPeopleEvaluationPacketRequestDto,
} from "./people-evaluation.dto";

/**
 * PeopleEvaluationService — persistence layer for rubric versions, periods,
 * collector-reported workspaces/sessions, evidence packets, assessments and
 * PIP plans (ADR-029).
 *
 * The service never judges: evidence construction, coverage accounting and
 * attribution are deterministic code paths (registry/host runners), while
 * judgment is produced by the assessment agent and stored verbatim together
 * with its coverage declaration.
 */
@Injectable()
export class PeopleEvaluationService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Rubric versions ---------------------------------------------------

  async findActiveRubric(): Promise<PeopleEvaluationRubricVersion | null> {
    return this.prisma.peopleEvaluationRubricVersion.findFirst({
      where: { isActive: true },
      orderBy: { publishedAt: "desc" },
      include: { evaluationDimensions: { orderBy: { dimensionKey: "asc" } } },
    });
  }

  /**
   * Create and publish a rubric version. Dimensions are written to their own
   * table — never into a JSON blob. Activation is atomic: publishing a new
   * version deactivates every other version in the same transaction so exactly
   * one rubric is active at a time.
   */
  async createRubricVersion(
    input: CreatePeopleEvaluationRubricVersionRequestDto,
  ): Promise<PeopleEvaluationRubricVersion> {
    const dimensionKeys = input.dimensions.map((dimension) => dimension.dimensionKey);
    if (new Set(dimensionKeys).size !== dimensionKeys.length) {
      throw new BadRequestException("Duplicate dimensionKey in rubric dimensions");
    }

    const publishedAt = input.publishedAt ?? new Date();
    const isActive = input.isActive ?? true;

    return this.prisma.$transaction(async (tx) => {
      if (isActive) {
        await tx.peopleEvaluationRubricVersion.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }
      return tx.peopleEvaluationRubricVersion.create({
        data: {
          version: input.version,
          floorRules: input.floorRules,
          companyDirectionStatement: input.companyDirectionStatement,
          publishedAt,
          isActive,
          evaluationDimensions: {
            create: input.dimensions.map((dimension) => ({
              dimensionKey: dimension.dimensionKey,
              name: dimension.name,
              anchorLow: dimension.anchorLow,
              anchorHigh: dimension.anchorHigh,
              fullLoadBaseRef: dimension.fullLoadBaseRef,
              description: dimension.description,
              calibrationExamples: dimension.calibrationExamples,
            })),
          },
        },
        include: { evaluationDimensions: true },
      });
    });
  }

  // --- Evaluation periods ------------------------------------------------

  async listPeriods(query: ListPeopleEvaluationPeriodsRequestDto) {
    const where = query.type ? { type: query.type } : {};
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.PeopleEvaluationPeriod,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: { where, orderBy: [{ periodStart: "desc" }, { id: "asc" }] },
    });
  }

  async getPeriodById(id: string): Promise<PeopleEvaluationPeriod> {
    const period = await this.prisma.peopleEvaluationPeriod.findUnique({ where: { id } });
    if (!period) {
      throw new NotFoundException(`Evaluation period ${id} not found`);
    }
    return period;
  }

  /** Locates the COLLECTION period containing an event timestamp, if any. */
  async findCollectionPeriodAt(at: Date): Promise<PeopleEvaluationPeriod | null> {
    return this.prisma.peopleEvaluationPeriod.findFirst({
      where: {
        type: PeriodType.COLLECTION,
        periodStart: { lte: at },
        periodEnd: { gt: at },
      },
      orderBy: { periodStart: "desc" },
    });
  }

  async createPeriod(input: CreatePeopleEvaluationPeriodRequestDto): Promise<PeopleEvaluationPeriod> {
    const rubric = await this.prisma.peopleEvaluationRubricVersion.findUnique({
      where: { id: input.rubricVersionId },
    });
    if (!rubric) {
      throw new NotFoundException(`PeopleEvaluationRubricVersion ${input.rubricVersionId} not found`);
    }
    if (!rubric.isActive) {
      throw new ConflictException(`PeopleEvaluationRubricVersion ${input.rubricVersionId} is not active`);
    }
    if (input.periodStart >= input.periodEnd) {
      throw new BadRequestException("periodStart must be before periodEnd");
    }
    // Ex ante anchor: a period cannot start before its rubric was published.
    if (input.periodStart < rubric.publishedAt) {
      throw new BadRequestException(
        `Period cannot start before rubric ${rubric.version} was published at ${rubric.publishedAt.toISOString()}`,
      );
    }

    const overlapping = await this.prisma.peopleEvaluationPeriod.findFirst({
      where: {
        type: input.type,
        periodStart: { lt: input.periodEnd },
        periodEnd: { gt: input.periodStart },
      },
      select: { id: true, periodStart: true, periodEnd: true },
    });
    if (overlapping) {
      throw new ConflictException(
        `Period overlaps existing ${input.type} period ${overlapping.id} (${overlapping.periodStart.toISOString()} – ${overlapping.periodEnd.toISOString()})`,
      );
    }

    if (input.collectionPeriodIds && input.collectionPeriodIds.length > 0) {
      if (input.type !== PeriodType.REVIEW) {
        throw new BadRequestException("collectionPeriodIds is only allowed on REVIEW periods");
      }
      const collectionPeriods = await this.prisma.peopleEvaluationPeriod.findMany({
        where: { id: { in: input.collectionPeriodIds } },
        select: { id: true, type: true },
      });
      if (collectionPeriods.length !== input.collectionPeriodIds.length) {
        throw new BadRequestException("collectionPeriodIds contains unknown period ids");
      }
      const nonCollection = collectionPeriods.filter((period) => period.type !== PeriodType.COLLECTION);
      if (nonCollection.length > 0) {
        throw new BadRequestException(
          `collectionPeriodIds must reference COLLECTION periods: ${nonCollection.map((period) => period.id).join(", ")}`,
        );
      }
    }

    return this.prisma.peopleEvaluationPeriod.create({
      data: {
        rubricVersionId: input.rubricVersionId,
        type: input.type,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: input.status ?? PeriodStatus.UPCOMING,
        collectionPeriodIds: input.collectionPeriodIds,
      },
    });
  }

  /**
   * Advance a period through its lifecycle: UPCOMING → ACTIVE → CLOSED.
   * Skipping straight from UPCOMING to CLOSED is allowed (a period that
   * never opened); reopening a CLOSED period is not.
   */
  async transitionPeriodStatus(id: string, target: PeriodStatus): Promise<PeopleEvaluationPeriod> {
    const period = await this.getPeriodById(id);
    const allowedTransitions: Record<PeriodStatus, PeriodStatus[]> = {
      [PeriodStatus.UPCOMING]: [PeriodStatus.ACTIVE, PeriodStatus.CLOSED],
      [PeriodStatus.ACTIVE]: [PeriodStatus.CLOSED],
      [PeriodStatus.CLOSED]: [],
    };
    if (!allowedTransitions[period.status].includes(target)) {
      throw new ConflictException(`Illegal period status transition ${period.status} → ${target}`);
    }
    return this.prisma.peopleEvaluationPeriod.update({ where: { id }, data: { status: target } });
  }

  // --- Home ground -------------------------------------------------------

  /**
   * Declare (or re-declare) the specialty circle for one evaluatee × period.
   * The declaration is context for the assessment agent — it never carries
   * weights into any computation.
   */
  async declareHomeGround(input: DeclarePeopleEvaluationHomeGroundRequestDto) {
    const period = await this.getPeriodById(input.collectionPeriodId);
    if (period.type !== PeriodType.COLLECTION) {
      throw new BadRequestException("Home ground can only be declared on COLLECTION periods");
    }
    return this.prisma.peopleEvaluationHomeGround.upsert({
      where: {
        evaluateeUserId_collectionPeriodId: {
          evaluateeUserId: input.evaluateeUserId,
          collectionPeriodId: input.collectionPeriodId,
        },
      },
      create: {
        evaluateeUserId: input.evaluateeUserId,
        collectionPeriodId: input.collectionPeriodId,
        homeDimensions: input.homeDimensions,
      },
      update: { homeDimensions: input.homeDimensions, declaredAt: new Date() },
    });
  }

  // --- Collector-reported workspaces / sessions --------------------------

  /**
   * Upsert a workspace report. Called by the collector ingest path only — the
   * workspace split is self-declared by the member and never adjudicated here.
   */
  async reportWorkspace(installationId: string, input: ReportPeopleEvaluationWorkspaceRequestDto) {
    return this.prisma.peopleEvaluationMemberWorkspace.upsert({
      where: {
        evaluateeUserId_workspaceKey: {
          evaluateeUserId: input.evaluateeUserId,
          workspaceKey: input.workspaceKey,
        },
      },
      create: {
        evaluateeUserId: input.evaluateeUserId,
        workspaceKey: input.workspaceKey,
        rootPath: input.rootPath,
        isCompany: input.isCompany,
        repositories: input.repositories,
        installationId,
        reportedAt: new Date(),
      },
      update: {
        rootPath: input.rootPath,
        isCompany: input.isCompany,
        repositories: input.repositories,
        installationId,
        reportedAt: new Date(),
      },
    });
  }

  /**
   * Upsert the PG index row for one collected agent session. Transcript
   * chunks land in ClickHouse; this row is what the assessment agent lists
   * and drills into.
   */
  async reportSession(input: ReportPeopleEvaluationSessionRequestDto) {
    const period = await this.findCollectionPeriodAt(input.startedAt);
    return this.prisma.peopleEvaluationAgentSession.upsert({
      where: {
        evaluateeUserId_externalSessionId: {
          evaluateeUserId: input.evaluateeUserId,
          externalSessionId: input.externalSessionId,
        },
      },
      create: {
        evaluateeUserId: input.evaluateeUserId,
        collectionPeriodId: period?.id,
        workspaceKey: input.workspaceKey,
        externalSessionId: input.externalSessionId,
        model: input.model ?? "",
        turnCount: input.turnCount,
        messageCount: input.messageCount,
        toolCallCount: input.toolCallCount,
        toolNames: input.toolNames,
        touchedFiles: input.touchedFiles,
        durationMs: input.durationMs,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      },
      update: {
        collectionPeriodId: period?.id,
        workspaceKey: input.workspaceKey,
        model: input.model ?? "",
        turnCount: input.turnCount,
        messageCount: input.messageCount,
        toolCallCount: input.toolCallCount,
        toolNames: input.toolNames,
        touchedFiles: input.touchedFiles,
        durationMs: input.durationMs,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      },
    });
  }

  async listWorkspaces(evaluateeUserId: string) {
    return this.prisma.peopleEvaluationMemberWorkspace.findMany({
      where: { evaluateeUserId },
      orderBy: { reportedAt: "desc" },
    });
  }

  async listSessions(evaluateeUserId: string, collectionPeriodId?: string) {
    return this.prisma.peopleEvaluationAgentSession.findMany({
      where: {
        evaluateeUserId,
        ...(collectionPeriodId ? { collectionPeriodId } : {}),
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        externalSessionId: true,
        workspaceKey: true,
        model: true,
        turnCount: true,
        messageCount: true,
        toolCallCount: true,
        toolNames: true,
        touchedFiles: true,
        durationMs: true,
        startedAt: true,
        endedAt: true,
      },
    });
  }

  // --- Declared documents ------------------------------------------------

  /** Upsert a declared work artifact reported by the collector. */
  async reportDocument(input: ReportPeopleEvaluationDocumentRequestDto) {
    return this.prisma.peopleEvaluationDeclaredDocument.upsert({
      where: {
        evaluateeUserId_workspaceKey_refPath: {
          evaluateeUserId: input.evaluateeUserId,
          workspaceKey: input.workspaceKey,
          refPath: input.refPath,
        },
      },
      create: {
        evaluateeUserId: input.evaluateeUserId,
        workspaceKey: input.workspaceKey,
        title: input.title,
        refPath: input.refPath,
        description: input.description,
        content: input.content,
        capturedAt: input.capturedAt,
      },
      update: {
        title: input.title,
        description: input.description,
        content: input.content,
        capturedAt: input.capturedAt,
      },
    });
  }

  async listDocuments(evaluateeUserId: string) {
    return this.prisma.peopleEvaluationDeclaredDocument.findMany({
      where: { evaluateeUserId },
      orderBy: { capturedAt: "desc" },
      select: {
        id: true,
        workspaceKey: true,
        title: true,
        refPath: true,
        description: true,
        capturedAt: true,
      },
    });
  }

  async getDocument(id: string) {
    const document = await this.prisma.peopleEvaluationDeclaredDocument.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException(`Declared document ${id} not found`);
    }
    return document;
  }

  // --- Evidence packets --------------------------------------------------

  /** Create or replace the deterministic packet for one evaluatee × period. */
  async upsertPacket(input: UpsertPeopleEvaluationPacketRequestDto) {
    const data = {
      evaluateeUserId: input.evaluateeUserId,
      collectionPeriodId: input.collectionPeriodId,
      manifest: input.manifest,
      contentHash: input.contentHash,
      coverageStats: input.coverageStats,
      generatedAt: new Date(),
    };
    return this.prisma.peopleEvaluationEvidencePacket.upsert({
      where: {
        evaluateeUserId_collectionPeriodId: {
          evaluateeUserId: input.evaluateeUserId,
          collectionPeriodId: input.collectionPeriodId,
        },
      },
      create: data,
      update: data,
    });
  }

  async getPacket(id: string) {
    const packet = await this.prisma.peopleEvaluationEvidencePacket.findUnique({ where: { id } });
    if (!packet) {
      throw new NotFoundException(`Evidence packet ${id} not found`);
    }
    return packet;
  }

  // --- Assessments -------------------------------------------------------

  async createAssessment(input: CreatePeopleEvaluationAssessmentRequestDto) {
    const packet = await this.getPacket(input.packetId);
    if (packet.evaluateeUserId !== input.evaluateeUserId || packet.collectionPeriodId !== input.collectionPeriodId) {
      throw new BadRequestException("Assessment evaluatee/period does not match its evidence packet");
    }
    return this.prisma.peopleEvaluationAssessment.create({
      data: {
        evaluateeUserId: input.evaluateeUserId,
        collectionPeriodId: input.collectionPeriodId,
        packetId: input.packetId,
        blindSubjectId: input.blindSubjectId,
        promptVersion: input.promptVersion,
        model: input.model,
        dimensionScores: input.dimensionScores,
        overallText: input.overallText,
        highlights: input.highlights,
        risks: input.risks,
        unresolved: input.unresolved,
        skipped: input.skipped,
        disagreement: input.disagreement,
      },
    });
  }

  async listAssessments(evaluateeUserId: string, collectionPeriodId?: string) {
    return this.prisma.peopleEvaluationAssessment.findMany({
      where: {
        evaluateeUserId,
        ...(collectionPeriodId ? { collectionPeriodId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getAssessment(id: string) {
    const assessment = await this.prisma.peopleEvaluationAssessment.findUnique({ where: { id } });
    if (!assessment) {
      throw new NotFoundException(`Assessment ${id} not found`);
    }
    return assessment;
  }

  /** Coverage declaration for an assessment: the packet it was judged from. */
  async getAssessmentPacket(id: string) {
    const assessment = await this.getAssessment(id);
    return this.getPacket(assessment.packetId);
  }

  /** Record the supervisor's final call on an assessment. */
  async reviewAssessment(id: string, input: ReviewPeopleEvaluationAssessmentRequestDto) {
    await this.getAssessment(id);
    return this.prisma.peopleEvaluationAssessment.update({
      where: { id },
      data: {
        reviewedByUserId: input.reviewedByUserId,
        reviewNote: input.reviewNote,
        reviewedAt: new Date(),
      },
    });
  }

  // --- PIP plans ---------------------------------------------------------

  async createPipPlan(input: CreatePeopleEvaluationPipPlanRequestDto) {
    if (input.startDate >= input.endDate) {
      throw new BadRequestException("startDate must be before endDate");
    }
    return this.prisma.peopleEvaluationPipPlan.create({
      data: {
        evaluateeUserId: input.evaluateeUserId,
        triggerRefs: input.triggerRefs,
        startDate: input.startDate,
        endDate: input.endDate,
        checkpoints: input.checkpoints,
        decisionNote: input.decisionNote,
        decidedByUserId: input.decidedByUserId,
        result: input.result,
        decidedAt: input.result ? new Date() : undefined,
      },
    });
  }

  async listPipPlans(evaluateeUserId: string) {
    return this.prisma.peopleEvaluationPipPlan.findMany({
      where: { evaluateeUserId },
      orderBy: { createdAt: "desc" },
    });
  }
}
