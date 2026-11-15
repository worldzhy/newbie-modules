import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import { SecurityEvaluationCriteriaProvider } from "./criteria/security-evaluation-criteria.provider";
import {
  SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION,
  SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION,
  SECURITY_EVALUATION_CODE_SCAN_RULE_SET_VERSION,
  SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION,
  SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION,
  SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  SECURITY_EVALUATION_KEY_AWS_CUSTOM,
  SECURITY_EVALUATION_KEY_CODE_SCAN,
  SECURITY_EVALUATION_KEY_NPM_OSV,
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
} from "./security-evaluation.constants";

/**
 * Behavior-level tests for the criteria provider's standardKey dispatch.
 * The provider is pure once the seed is stubbed, so the contract is testable
 * without a database.
 */

function subject(kind: string): EvaluationSubjectRef {
  return {
    id: "subject-1",
    subjectType: "security-evaluation",
    kind,
    subjectKey: "key-1",
    displayName: "Subject 1",
  };
}

function createProvider() {
  const calls: string[] = [];
  const seed = {
    seedDependencyBaseline: async () => {
      calls.push("dependency");
    },
    seedAwsConfigBaseline: async () => {
      calls.push("cis");
    },
    seedAwsCustomBaseline: async () => {
      calls.push("custom");
    },
    seedIntelligenceBaseline: async () => {
      calls.push("intel");
    },
    seedCodeScanBaseline: async () => {
      calls.push("code-scan");
    },
  };
  // The provider only uses the baseline methods.
  const provider = new SecurityEvaluationCriteriaProvider(seed as never);
  return { provider, calls };
}

test("repository subject defaults to the npm/OSV standardKey", async () => {
  const { provider, calls } = createProvider();
  const selection = await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY), null);
  assert.deepEqual(selection, {
    standardKey: SECURITY_EVALUATION_KEY_NPM_OSV,
    version: SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION,
  });
  assert.deepEqual(calls, ["dependency"]);
});

test("repository subject switches to threat-intel when requested", async () => {
  const { provider, calls } = createProvider();
  const selection = await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY), {
    standardKey: SECURITY_EVALUATION_KEY_THREAT_INTEL,
  });
  assert.deepEqual(selection, {
    standardKey: SECURITY_EVALUATION_KEY_THREAT_INTEL,
    version: SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION,
  });
  assert.deepEqual(calls, ["intel"]);
});

test("repository subject switches to code-scan only when explicitly requested (ADR-054)", async () => {
  const { provider, calls } = createProvider();
  const selection = await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY), {
    standardKey: SECURITY_EVALUATION_KEY_CODE_SCAN,
  });
  assert.deepEqual(selection, {
    standardKey: SECURITY_EVALUATION_KEY_CODE_SCAN,
    version: SECURITY_EVALUATION_CODE_SCAN_RULE_SET_VERSION,
  });
  assert.deepEqual(calls, ["code-scan"]);
});

test("aws-account subject defaults to the CIS benchmark standardKey", async () => {
  const { provider, calls } = createProvider();
  const selection = await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT), null);
  assert.deepEqual(selection, {
    standardKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    version: SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION,
  });
  assert.deepEqual(calls, ["cis"]);
});

test("aws-account subject selects the custom hardening standardKey when requested", async () => {
  const { provider, calls } = createProvider();
  const selection = await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT), {
    standardKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
  });
  assert.deepEqual(selection, {
    standardKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    version: SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION,
  });
  assert.deepEqual(calls, ["custom"]);
});
