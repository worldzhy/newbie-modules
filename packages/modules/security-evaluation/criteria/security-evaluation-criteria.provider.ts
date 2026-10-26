import { Injectable } from "@nestjs/common";
import { CriteriaProvider, CriteriaSelection } from "@modules/evaluation/ports/criteria.provider";
import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import {
  SECURITY_EVALUATION_DEPENDENCY_CRITERIA_VERSION,
  SECURITY_EVALUATION_FAMILY_DEPENDENCY,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
} from "../security-evaluation.constants";
import { SecurityEvaluationCriteriaSeed } from "./security-evaluation-criteria.seed";

/**
 * SecurityEvaluationCriteriaProvider — the CriteriaProvider for subject kind
 * "repository". The applicable version is the one this build ships; the seed
 * guarantees it is published before any run can reference it.
 */
@Injectable()
export class SecurityEvaluationCriteriaProvider implements CriteriaProvider {
  constructor(private readonly seed: SecurityEvaluationCriteriaSeed) {}

  async selectVersion(subject: EvaluationSubjectRef): Promise<CriteriaSelection | null> {
    if (subject.kind !== SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY) return null;
    await this.seed.ensureDependencyBaseline();
    return {
      family: SECURITY_EVALUATION_FAMILY_DEPENDENCY,
      version: SECURITY_EVALUATION_DEPENDENCY_CRITERIA_VERSION,
    };
  }
}
