import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { EvaluationJudgment, JudgmentInput, JudgmentPort } from "@modules/evaluation/ports/judgment.port";

import { mergeJudgments, type SecurityEvaluationJudgmentPart } from "./security-evaluation-judgment-merge";
import {
  SECURITY_EVALUATION_JUDGMENT_MECHANISMS,
  type SecurityEvaluationJudgmentMechanism,
} from "./security-evaluation-mechanism";
import { resolveSecurityEvaluationJudgmentMechanisms } from "./security-evaluation-mechanism.registry";

/**
 * SecurityEvaluationJudgmentService — the single JudgmentPort binding for this
 * feature (ADR-022 D3, ADR-046).
 *
 * Dispatch is a table lookup: the evaluationKey's declared mechanism list is
 * executed in parallel and the results merged under the composition contract.
 * Adding an evaluationKey or a second mechanism dimension changes the registry
 * data, not this class. An unknown evaluationKey is a contract error, not a
 * silent pass.
 */
@Injectable()
export class SecurityEvaluationJudgmentService implements JudgmentPort {
  constructor(
    @Inject(SECURITY_EVALUATION_JUDGMENT_MECHANISMS)
    private readonly mechanisms: readonly SecurityEvaluationJudgmentMechanism[],
  ) {}

  async judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    const mechanisms = resolveSecurityEvaluationJudgmentMechanisms(input.ruleSetVersion.evaluationKey, this.mechanisms);
    if (!mechanisms) {
      throw new BadRequestException(
        `No security-evaluation judgment is implemented for criteria evaluationKey "${input.ruleSetVersion.evaluationKey}".`,
      );
    }

    const parts: SecurityEvaluationJudgmentPart[] = await Promise.all(
      mechanisms.map(async (mechanism) => ({
        mechanismName: mechanism.name,
        judgment: await mechanism.judge(input),
      })),
    );
    return mergeJudgments(parts);
  }
}
