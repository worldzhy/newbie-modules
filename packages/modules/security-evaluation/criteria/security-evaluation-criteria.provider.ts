import { Injectable } from "@nestjs/common";
import { CriteriaProvider, CriteriaSelection } from "@modules/evaluation/ports/criteria.provider";
import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import {
  SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION,
  SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION,
  SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION,
  SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  SECURITY_EVALUATION_KEY_AWS_CUSTOM,
  SECURITY_EVALUATION_KEY_NPM_OSV,
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
  SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION,
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
} from "../security-evaluation.constants";
import { SecurityEvaluationCriteriaSeed } from "./security-evaluation-criteria.seed";

/**
 * SecurityEvaluationCriteriaProvider — the CriteriaProvider for the subject
 * kinds this feature owns. The applicable version is the one this build ships;
 * the seed guarantees it is published before any run can reference it.
 *
 * For the repository kind the runConfig may request the INTEL evaluationKey
 * via `evaluationKey: "threat-intel"` (ADR-039); otherwise the npm/OSV
 * evaluationKey is selected by default. For the aws-account kind the runConfig
 * may request `evaluationKey: "aws-custom"` (custom hardening rules) and falls
 * back to the CIS benchmark otherwise.
 */
@Injectable()
export class SecurityEvaluationCriteriaProvider implements CriteriaProvider {
  constructor(private readonly seed: SecurityEvaluationCriteriaSeed) {}

  async selectVersion(
    subject: EvaluationSubjectRef,
    runConfig?: Record<string, unknown> | null,
  ): Promise<CriteriaSelection | null> {
    switch (subject.kind) {
      case SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY:
        if (runConfig?.evaluationKey === SECURITY_EVALUATION_KEY_THREAT_INTEL) {
          await this.seed.ensureIntelligenceBaseline();
          return {
            evaluationKey: SECURITY_EVALUATION_KEY_THREAT_INTEL,
            version: SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION,
          };
        }
        await this.seed.ensureDependencyBaseline();
        return {
          evaluationKey: SECURITY_EVALUATION_KEY_NPM_OSV,
          version: SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION,
        };
      case SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT:
        if (runConfig?.evaluationKey === SECURITY_EVALUATION_KEY_AWS_CUSTOM) {
          await this.seed.ensureCloudCustomBaseline();
          return {
            evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
            version: SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION,
          };
        }
        await this.seed.ensureCloudConfigBaseline();
        return {
          evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
          version: SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION,
        };
      default:
        return null;
    }
  }
}
