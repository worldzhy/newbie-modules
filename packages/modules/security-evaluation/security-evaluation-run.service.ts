import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { EvaluationRun } from "@generated/prisma/client";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";
import { EvaluationResultService, ListEvaluationResultsInput } from "@modules/evaluation/evaluation-result.service";
import { EvaluationRunService, ListEvaluationRunsInput } from "@modules/evaluation/evaluation-run.service";
import { EvaluationRunnerService } from "@modules/evaluation/evaluation-runner.service";
import type { StartEvaluationRunInput } from "@modules/evaluation/evaluation-run.service";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

export interface StartSecurityEvaluationRunInput extends Omit<StartEvaluationRunInput, "subjectId"> {
  subjectId: string;
}

/** Config key of the web-origin verification switch (newbie.module.json, ADR-066). */
const WEB_ORIGIN_REQUIRE_VERIFICATION_KEY = "modules.security-evaluation.webOrigin.requireVerification";

/**
 * SecurityEvaluationRunService — thin façade over the skeleton's run lifecycle.
 *
 * Dispatch is two-phase. Admission (the skeleton opening the run row) stays on
 * the request path, so a missing subject, a draft criteria version or an active
 * run of the same subject and version still answers 400/404/409 instead of a
 * 202 for a run that will never execute. Execution is fire-and-forget: the
 * caller discovers the outcome by polling `GET /security-evaluation/runs`.
 *
 * Web-origin admission is decided here and nowhere else: every caller (manual
 * `POST /runs`, the daily scan, future dispatchers) enters through `startRun`.
 * `SECURITY_EVALUATION_WEB_ORIGIN_REQUIRE_VERIFICATION=true` requires a verified
 * origin; `false` admits unverified origins with a warning. The variable has no
 * default — a missing or non-boolean value fails the run instead of guessing.
 *
 * Callers that enumerate subjects (the daily scan) narrow their dispatch list
 * with `requiresWebOriginVerification()`: same switch, one reader, so the
 * selection can never contradict the gate.
 */
@Injectable()
export class SecurityEvaluationRunService {
  private readonly logger = new Logger(SecurityEvaluationRunService.name);

  constructor(
    private readonly runner: EvaluationRunnerService,
    private readonly runs: EvaluationRunService,
    private readonly results: EvaluationResultService,
    private readonly criteria: EvaluationCriteriaService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async startRun(input: StartSecurityEvaluationRunInput): Promise<void> {
    await this.assertWebOriginAdmitted(input.subjectId);
    // Admission (subject existence, published version, concurrency) is decided
    // by the skeleton inside `open`, on the request path; kind support is
    // decided by the port bindings, not by a guard here.
    const run = await this.runner.open(input);
    void this.runner.execute(run).catch((error: unknown) => {
      this.logger.error(`Evaluation run ${run.id} for subject ${input.subjectId} failed: ${getErrorMessage(error)}`);
    });
  }

  /**
   * Dispatch narrowing for enumerating callers (the daily scan): with the
   * switch on, an unverified origin would be refused by the gate anyway, so it
   * need not be submitted. Reads the same switch as `assertWebOriginAdmitted`,
   * so there is one interpretation of the variable, not two.
   */
  requiresWebOriginVerification(): boolean {
    return this.readRequireVerificationSwitch();
  }

  /**
   * The only web-origin gate: an inactive origin is always refused, and an
   * unverified one is refused unless the switch is explicitly off. Non-web-origin
   * subjects (no material row) pass through untouched.
   */
  private async assertWebOriginAdmitted(subjectId: string): Promise<void> {
    const requireVerification = this.readRequireVerificationSwitch();
    const origin = await this.prisma.securityEvaluationWebOrigin.findUnique({
      where: { subjectId },
      select: { isActive: true, verificationStatus: true },
    });
    if (!origin) return;
    if (!origin.isActive) {
      throw new ConflictException(`Web origin of subject ${subjectId} is deactivated and cannot be evaluated.`);
    }
    if (origin.verificationStatus === "VERIFIED") return;
    if (requireVerification) {
      throw new ConflictException(
        `Web origin of subject ${subjectId} is not verified (${origin.verificationStatus}); set SECURITY_EVALUATION_WEB_ORIGIN_REQUIRE_VERIFICATION=false to evaluate unverified origins.`,
      );
    }
    this.logger.warn(
      `Evaluating unverified web origin ${subjectId} (${origin.verificationStatus}) because SECURITY_EVALUATION_WEB_ORIGIN_REQUIRE_VERIFICATION=false.`,
    );
  }

  /** Strict boolean read: the switch has no default, so an absent value is an error. */
  private readRequireVerificationSwitch(): boolean {
    const raw = this.config.getOrThrow<string>(WEB_ORIGIN_REQUIRE_VERIFICATION_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`SECURITY_EVALUATION_WEB_ORIGIN_REQUIRE_VERIFICATION must be "true" or "false", got "${raw}".`);
  }

  /**
   * Runs decorated with their standardKey labels: the skeleton row only
   * carries ruleSetVersionId, while the API consumer displays the
   * standardKey and version of what the run was judged against.
   */
  async listRuns(query: ListEvaluationRunsInput) {
    const page = await this.runs.listRuns(query);
    const records = page.records as EvaluationRun[];
    const versionIds = [...new Set(records.map((run) => run.ruleSetVersionId))];
    const versions = new Map(
      (await Promise.all(versionIds.map((id) => this.criteria.getVersion(id)))).map((version) => [version.id, version]),
    );
    return {
      ...page,
      records: records.map((run) => {
        const version = versions.get(run.ruleSetVersionId);
        return { ...run, standardKey: version?.standardKey ?? "", ruleSetVersion: version?.version ?? "" };
      }),
    };
  }

  getRun(id: string) {
    return this.runs.findById(id);
  }

  listResults(query: ListEvaluationResultsInput) {
    return this.results.listResults(query);
  }

  getResult(id: string) {
    return this.results.getResult(id);
  }

  getResultForRun(runId: string) {
    return this.results.getResultForRun(runId);
  }
}
