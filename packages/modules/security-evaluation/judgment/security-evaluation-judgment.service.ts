import { BadRequestException, Injectable } from "@nestjs/common";
import type { EvaluationJudgment, JudgmentInput, JudgmentPort } from "@modules/evaluation/ports/judgment.port";

import {
  SECURITY_EVALUATION_FAMILY_CLOUD_CONFIGURATION,
  SECURITY_EVALUATION_FAMILY_CLOUD_CUSTOM,
  SECURITY_EVALUATION_FAMILY_DEPENDENCY,
  SECURITY_EVALUATION_FAMILY_INTELLIGENCE,
} from "../security-evaluation.constants";
import { SecurityEvaluationCloudConfigJudgment } from "./cloud-config/security-evaluation-cloud-config.judgment";
import { SecurityEvaluationDependencyJudgment } from "./dependency/security-evaluation-dependency.judgment";
import { SecurityEvaluationIntelJudgment } from "./intel/security-evaluation-intel.judgment";

/**
 * SecurityEvaluationJudgmentService — the single JudgmentPort binding for this
 * feature (ADR-022 D3).
 *
 * The skeleton binds one judgment port per subject kind, so every mechanism is
 * dispatched here on the run's criteria evaluationKey instead of fighting the token
 * scheme. An unknown evaluationKey is a contract error, not a silent pass.
 */
@Injectable()
export class SecurityEvaluationJudgmentService implements JudgmentPort {
  constructor(
    private readonly dependency: SecurityEvaluationDependencyJudgment,
    private readonly cloudConfig: SecurityEvaluationCloudConfigJudgment,
    private readonly intel: SecurityEvaluationIntelJudgment,
  ) {}

  judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    switch (input.criteriaVersion.evaluationKey) {
      case SECURITY_EVALUATION_FAMILY_DEPENDENCY:
        return this.dependency.judge(input);
      case SECURITY_EVALUATION_FAMILY_CLOUD_CONFIGURATION:
      case SECURITY_EVALUATION_FAMILY_CLOUD_CUSTOM:
        return this.cloudConfig.judge(input);
      case SECURITY_EVALUATION_FAMILY_INTELLIGENCE:
        return this.intel.judge(input);
      default:
        throw new BadRequestException(
          `No security-evaluation judgment is implemented for criteria evaluationKey "${input.criteriaVersion.evaluationKey}".`,
        );
    }
  }
}
