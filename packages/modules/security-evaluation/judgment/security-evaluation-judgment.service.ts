import { BadRequestException, Injectable } from "@nestjs/common";
import type { EvaluationJudgment, JudgmentInput, JudgmentPort } from "@modules/evaluation/ports/judgment.port";

import {
  SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  SECURITY_EVALUATION_KEY_AWS_CUSTOM,
  SECURITY_EVALUATION_KEY_NPM_OSV,
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
} from "../security-evaluation.constants";
import { SecurityEvaluationAwsConfigJudgment } from "./aws-config/security-evaluation-aws-config.judgment";
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
    private readonly awsConfig: SecurityEvaluationAwsConfigJudgment,
    private readonly intel: SecurityEvaluationIntelJudgment,
  ) {}

  judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    switch (input.ruleSetVersion.evaluationKey) {
      case SECURITY_EVALUATION_KEY_NPM_OSV:
        return this.dependency.judge(input);
      case SECURITY_EVALUATION_KEY_AWS_CIS_1_5:
      case SECURITY_EVALUATION_KEY_AWS_CUSTOM:
        return this.awsConfig.judge(input);
      case SECURITY_EVALUATION_KEY_THREAT_INTEL:
        return this.intel.judge(input);
      default:
        throw new BadRequestException(
          `No security-evaluation judgment is implemented for criteria evaluationKey "${input.ruleSetVersion.evaluationKey}".`,
        );
    }
  }
}
