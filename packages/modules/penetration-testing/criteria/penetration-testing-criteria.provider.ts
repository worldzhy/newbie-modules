import { Injectable } from "@nestjs/common";
import { CriteriaProvider, CriteriaSelection } from "@modules/evaluation/ports/criteria.provider";
import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import {
  isPenetrationTestingKey,
  PENETRATION_TESTING_RULE_SET_VERSION,
  PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET,
} from "../penetration-testing.constants";
import { PenetrationTestingCriteriaSeed } from "./penetration-testing-criteria.seed";

/**
 * PenetrationTestingCriteriaProvider — selects one of the four published rule
 * sets from `runConfig.standardKey` (ADR-075 §5).
 *
 * All four keys share the `web-target` kind, so the key cannot come from the
 * subject; it must come from the run config, or the caller must pass an explicit
 * `ruleSetVersionId` and bypass this provider. A missing or unknown key returns
 * null, which the skeleton turns into a 400 — never a silent default.
 */
@Injectable()
export class PenetrationTestingCriteriaProvider implements CriteriaProvider {
  constructor(private readonly seed: PenetrationTestingCriteriaSeed) {}

  async selectVersion(
    subject: EvaluationSubjectRef,
    runConfig?: Record<string, unknown> | null,
  ): Promise<CriteriaSelection | null> {
    if (subject.kind !== PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET) return null;
    const standardKey = runConfig?.standardKey;
    if (!isPenetrationTestingKey(standardKey)) return null;
    await this.seed.seedAll();
    return { standardKey, version: PENETRATION_TESTING_RULE_SET_VERSION };
  }
}
