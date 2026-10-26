import { BadRequestException, Injectable } from "@nestjs/common";
import type { EvaluationJudgment, JudgmentInput, JudgmentPort } from "@modules/evaluation/ports/judgment.port";

import { SECURITY_EVALUATION_FAMILY_DEPENDENCY } from "../security-evaluation.constants";
import { SecurityEvaluationDependencyJudgment } from "./dependency/security-evaluation-dependency.judgment";

/**
 * SecurityEvaluationJudgmentService — the single JudgmentPort binding for this
 * feature (ADR-022 D3).
 *
 * The skeleton binds one judgment port per subject kind, so every mechanism is
 * dispatched here on the run's criteria family instead of fighting the token
 * scheme. An unknown family is a contract error, not a silent pass.
 */
@Injectable()
export class SecurityEvaluationJudgmentService implements JudgmentPort {
  constructor(private readonly dependency: SecurityEvaluationDependencyJudgment) {}

  judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    switch (input.criteriaVersion.family) {
      case SECURITY_EVALUATION_FAMILY_DEPENDENCY:
        return this.dependency.judge(input);
      default:
        throw new BadRequestException(
          `No security-evaluation judgment is implemented for criteria family "${input.criteriaVersion.family}".`,
        );
    }
  }
}
