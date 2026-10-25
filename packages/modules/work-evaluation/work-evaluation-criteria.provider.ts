import { Injectable } from "@nestjs/common";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";
import { EvaluationSubjectService } from "@modules/evaluation/evaluation-subject.service";
import { CriteriaProvider, CriteriaSelection } from "@modules/evaluation/ports/criteria.provider";
import { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import { WorkEvaluationPeriodService } from "./work-evaluation-period.service";
import { readWorkEvaluationSubjectMetadata } from "./work-evaluation-subject";

/**
 * WorkEvaluationCriteriaProvider — the CriteriaProvider for subject kind
 * "work" (ADR-024). The applicable version is never chosen at run time: the
 * subject's period pins exactly one published criteria version (spec §4.5),
 * and this port only follows the pin.
 */
@Injectable()
export class WorkEvaluationCriteriaProvider implements CriteriaProvider {
  constructor(
    private readonly subjects: EvaluationSubjectService,
    private readonly criteria: EvaluationCriteriaService,
    private readonly periods: WorkEvaluationPeriodService,
  ) {}

  async selectVersion(subject: EvaluationSubjectRef): Promise<CriteriaSelection> {
    const metadata = await readWorkEvaluationSubjectMetadata(this.subjects, subject.id);
    const period = await this.periods.getPeriodById(metadata.periodId);
    const version = await this.criteria.getVersion(period.criteriaVersionId);
    return { family: version.family, version: version.version };
  }
}
