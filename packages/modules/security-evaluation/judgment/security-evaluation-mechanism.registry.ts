import {
  SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  SECURITY_EVALUATION_KEY_AWS_CUSTOM,
  SECURITY_EVALUATION_KEY_NPM_OSV,
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
} from "../security-evaluation.constants";
import {
  SECURITY_EVALUATION_MECHANISM_NAME_AWS_CONFIG,
  SECURITY_EVALUATION_MECHANISM_NAME_DEPENDENCY,
  SECURITY_EVALUATION_MECHANISM_NAME_INTEL,
  type SecurityEvaluationJudgmentMechanism,
} from "./security-evaluation-mechanism";

/**
 * Declarative mechanism composition (ADR-046): which mechanisms judge each
 * evaluationKey. `aws-cis-1.5` and `aws-custom` share the `aws-config`
 * mechanism explicitly — previously the sharing was implicit in the rulebook
 * filter and a switch fall-through.
 *
 * Adding a mechanism dimension is a data change here; the dispatcher does not
 * grow a branch.
 */
export const SECURITY_EVALUATION_JUDGMENT_MECHANISMS_BY_KEY: Readonly<Record<string, readonly string[]>> = {
  [SECURITY_EVALUATION_KEY_NPM_OSV]: [SECURITY_EVALUATION_MECHANISM_NAME_DEPENDENCY],
  [SECURITY_EVALUATION_KEY_AWS_CIS_1_5]: [SECURITY_EVALUATION_MECHANISM_NAME_AWS_CONFIG],
  [SECURITY_EVALUATION_KEY_AWS_CUSTOM]: [SECURITY_EVALUATION_MECHANISM_NAME_AWS_CONFIG],
  [SECURITY_EVALUATION_KEY_THREAT_INTEL]: [SECURITY_EVALUATION_MECHANISM_NAME_INTEL],
};

/**
 * Resolve the mechanisms declared for an evaluationKey. Returns undefined when
 * the key is unknown; throws when the registry names a mechanism the injected
 * set does not provide, or when two mechanisms share a name.
 */
export function resolveSecurityEvaluationJudgmentMechanisms(
  evaluationKey: string,
  mechanisms: readonly SecurityEvaluationJudgmentMechanism[],
): readonly SecurityEvaluationJudgmentMechanism[] | undefined {
  const names = SECURITY_EVALUATION_JUDGMENT_MECHANISMS_BY_KEY[evaluationKey];
  if (!names) return undefined;

  const byName = new Map<string, SecurityEvaluationJudgmentMechanism>();
  for (const mechanism of mechanisms) {
    if (byName.has(mechanism.name)) {
      throw new Error(`Duplicate judgment mechanism name "${mechanism.name}" (ADR-046).`);
    }
    byName.set(mechanism.name, mechanism);
  }

  return names.map((name) => {
    const mechanism = byName.get(name);
    if (!mechanism) {
      throw new Error(`Evaluation key "${evaluationKey}" declares unknown judgment mechanism "${name}" (ADR-046).`);
    }
    return mechanism;
  });
}
