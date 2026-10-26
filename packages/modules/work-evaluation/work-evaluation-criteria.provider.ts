import { Injectable } from "@nestjs/common";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";
import { CriteriaProvider, CriteriaSelection } from "@modules/evaluation/ports/criteria.provider";
import { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import { WorkEvaluationPeriodService } from "./work-evaluation-period.service";
import { readPeriodId } from "./work-evaluation-run-config";

/**
 * WorkEvaluationCriteriaProvider — the CriteriaProvider for subject kind
 * "work" (ADR-024). The applicable version is never chosen freely: the run's
 * period (runConfig.periodId, ADR-026) pins exactly one published criteria
 * version, and this port only follows the pin.
 */
@Injectable()
export class WorkEvaluationCriteriaProvider implements CriteriaProvider {
  constructor(
    private readonly criteria: EvaluationCriteriaService,
    private readonly periods: WorkEvaluationPeriodService,
  ) {}

  async selectVersion(
    _subject: EvaluationSubjectRef,
    runConfig?: Record<string, unknown> | null,
  ): Promise<CriteriaSelection | null> {
    const periodId = readPeriodId(runConfig);
    if (!periodId) return null;
    const period = await this.periods.getPeriodById(periodId);
    const version = await this.criteria.getVersion(period.criteriaVersionId);
    return { family: version.family, version: version.version };
  }
}
