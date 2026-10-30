import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import { SecurityEvaluationCriteriaProvider } from "./criteria/security-evaluation-criteria.provider";
import {
  SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION,
  SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION,
  SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION,
  SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION,
  SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  SECURITY_EVALUATION_KEY_AWS_CUSTOM,
  SECURITY_EVALUATION_KEY_NPM_OSV,
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
} from "./security-evaluation.constants";

/**
 * Behavior-level tests for the criteria provider's evaluationKey dispatch.
 * The provider is pure once the seed is stubbed, so the contract is testable
 * without a database.
 */

function subject(kind: string): EvaluationSubjectRef {
  return {
    id: "subject-1",
    kind,
    scopeType: "project",
    scopeId: "project-1",
    subjectKey: "key-1",
    displayName: "Subject 1",
  };
}

function createProvider() {
  const calls: string[] = [];
  const seed = {
    ensureDependencyBaseline: async () => {
      calls.push("dependency");
    },
    ensureAwsConfigBaseline: async () => {
      calls.push("cis");
    },
    ensureAwsCustomBaseline: async () => {
      calls.push("custom");
    },
    ensureIntelligenceBaseline: async () => {
      calls.push("intel");
    },
  };
  // The provider only uses the baseline methods.
  const provider = new SecurityEvaluationCriteriaProvider(seed as never);
  return { provider, calls };
}

test("repository subject defaults to the npm/OSV evaluationKey", async () => {
  const { provider, calls } = createProvider();
  const selection = await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY), null);
  assert.deepEqual(selection, {
    evaluationKey: SECURITY_EVALUATION_KEY_NPM_OSV,
    version: SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION,
  });
  assert.deepEqual(calls, ["dependency"]);
});

test("repository subject switches to threat-intel when requested", async () => {
  const { provider, calls } = createProvider();
  const selection = await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY), {
    evaluationKey: SECURITY_EVALUATION_KEY_THREAT_INTEL,
  });
  assert.deepEqual(selection, {
    evaluationKey: SECURITY_EVALUATION_KEY_THREAT_INTEL,
    version: SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION,
  });
  assert.deepEqual(calls, ["intel"]);
});

test("aws-account subject defaults to the CIS benchmark evaluationKey", async () => {
  const { provider, calls } = createProvider();
  const selection = await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT), null);
  assert.deepEqual(selection, {
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    version: SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION,
  });
  assert.deepEqual(calls, ["cis"]);
});

test("aws-account subject selects the custom hardening evaluationKey when requested", async () => {
  const { provider, calls } = createProvider();
  const selection = await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT), {
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
  });
  assert.deepEqual(selection, {
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    version: SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION,
  });
  assert.deepEqual(calls, ["custom"]);
});
