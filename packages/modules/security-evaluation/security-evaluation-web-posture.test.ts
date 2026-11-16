import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvaluationEvidenceItem, EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";
import type { JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import type { SecurityEvaluationWebOriginService } from "./assets/security-evaluation-web-origin.service";
import { SecurityEvaluationCriteriaProvider } from "./criteria/security-evaluation-criteria.provider";
import { SecurityEvaluationWebPostureEvidenceProvider } from "./evidence/security-evaluation-web-posture-evidence.provider";
import {
  SecurityEvaluationWebPostureJudgment,
  webPostureFingerprint,
} from "./judgment/web-posture/security-evaluation-web-posture.judgment";
import type { WebHttpObservation, WebProbeAccess, WebTlsObservation } from "./ports/web-probe.access";
import {
  SECURITY_EVALUATION_KEY_WEB_POSTURE,
  SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_CSP,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_HSTS,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_PERMISSIONS_POLICY,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_REFERRER_POLICY,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_LEGACY_PROTOCOL,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_WEAK_CIPHER,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_API,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_HTML,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_FRAME_OPTIONS,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_API,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_HTML,
  SECURITY_EVALUATION_WEB_POSTURE_RULE_SET_VERSION,
} from "./security-evaluation.constants";

/**
 * Behavior-level tests for the web-posture capability (ADR-066): criteria
 * selection per standardKey, the deterministic judgment predicates and
 * fingerprints, and the evidence collector's port and skip semantics. All
 * fakes are in-memory; nothing here touches the network or a database.
 */

const ORIGIN = "https://app.example.com";

function subject(kind: string, subjectKey = ORIGIN): EvaluationSubjectRef {
  return {
    id: "subject-1",
    subjectType: "security-evaluation",
    kind,
    subjectKey,
    displayName: "App",
  };
}

function createCriteriaProvider() {
  const calls: string[] = [];
  const seed = {
    seedWebPostureBaseline: async () => {
      calls.push("web-posture");
    },
  };
  const provider = new SecurityEvaluationCriteriaProvider(seed as never);
  return { provider, calls };
}

test("web-origin selects web-posture v1 only when its standardKey is requested", async () => {
  const { provider, calls } = createCriteriaProvider();
  const selection = await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN), {
    standardKey: SECURITY_EVALUATION_KEY_WEB_POSTURE,
  });
  assert.deepEqual(selection, {
    standardKey: SECURITY_EVALUATION_KEY_WEB_POSTURE,
    version: SECURITY_EVALUATION_WEB_POSTURE_RULE_SET_VERSION,
  });
  assert.deepEqual(calls, ["web-posture"]);
});

test("web-origin returns null for an unknown standardKey or an omitted one", async () => {
  const { provider, calls } = createCriteriaProvider();
  assert.equal(
    await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN), { standardKey: "npm-osv" }),
    null,
  );
  assert.equal(await provider.selectVersion(subject(SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN), null), null);
  assert.deepEqual(calls, []);
});

function httpObservation(overrides: Partial<WebHttpObservation> = {}): WebHttpObservation {
  return {
    role: "html",
    requestedUrl: `${ORIGIN}/`,
    finalUrl: `${ORIGIN}/`,
    status: 200,
    headers: {},
    redirects: [],
    ...overrides,
  };
}

function tlsObservation(overrides: Partial<WebTlsObservation> = {}): WebTlsObservation {
  return {
    protocols: { tls10: false, tls11: false, tls12: true, tls13: true },
    cipherSuites: [],
    ...overrides,
  };
}

function judgmentInput(options: {
  html?: WebHttpObservation;
  api?: WebHttpObservation;
  tls?: WebTlsObservation;
}): JudgmentInput {
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  const evidence: EvaluationEvidenceItem[] = [];
  if (options.html) {
    evidence.push({
      id: "http:html",
      layer: "web",
      source: "web-origin",
      summary: "html",
      observedAt,
      payload: { origin: ORIGIN, observation: options.html },
    });
  }
  if (options.api) {
    evidence.push({
      id: "http:api.session",
      layer: "web",
      source: "web-origin",
      summary: "api.session",
      observedAt,
      payload: { origin: ORIGIN, observation: options.api },
    });
  }
  if (options.tls) {
    evidence.push({
      id: "tls:origin",
      layer: "web",
      source: "web-origin",
      summary: "tls",
      observedAt,
      payload: { origin: ORIGIN, observation: options.tls },
    });
  }
  return {
    subject: { id: "subject-1", subjectKey: ORIGIN, displayName: "App" },
    ruleSetVersion: {
      id: "version-1",
      subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
      standardKey: SECURITY_EVALUATION_KEY_WEB_POSTURE,
      version: SECURITY_EVALUATION_WEB_POSTURE_RULE_SET_VERSION,
    },
    criteria: [],
    evidence,
    runConfig: null,
  };
}

function severityByCriterion(input: JudgmentInput) {
  return new SecurityEvaluationWebPostureJudgment()
    .judge(input)
    .then((judgment) => new Map(judgment.findings.map((finding) => [finding.criterionKey, finding.severity])));
}

const REJECTION_CRITERIA = [
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_HTML,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_HSTS,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_FRAME_OPTIONS,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_CSP,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_PERMISSIONS_POLICY,
  SECURITY_EVALUATION_WEB_POSTURE_CRITERION_REFERRER_POLICY,
];

test("a bare HTML response yields the expected findings and severities", async () => {
  const severities = await severityByCriterion(judgmentInput({ html: httpObservation() }));

  assert.deepEqual([...severities.keys()].sort(), [...REJECTION_CRITERIA].sort());
  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_HTML), "LOW");
  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_HSTS), "LOW");
  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_FRAME_OPTIONS), "MEDIUM");
  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_CSP), "LOW");
  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_PERMISSIONS_POLICY), "INFO");
  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_REFERRER_POLICY), "LOW");
});

test("compliant HTML and TLS observations produce no findings", async () => {
  const judgment = await new SecurityEvaluationWebPostureJudgment().judge(
    judgmentInput({
      html: httpObservation({
        headers: {
          "x-content-type-options": "nosniff",
          "strict-transport-security": "max-age=31536000; includeSubDomains",
          "x-frame-options": "DENY",
          "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
          "permissions-policy": "geolocation=()",
          "referrer-policy": "no-referrer",
        },
      }),
      tls: tlsObservation(),
    }),
  );

  assert.deepEqual(judgment.findings, []);
  assert.deepEqual(judgment.verdicts, []);
  assert.deepEqual(judgment.evaluatedRefs, ["http:html", "tls:origin"]);
});

test("a missing api.session observation hides the API criteria and lands in skipped", async () => {
  const judgment = await new SecurityEvaluationWebPostureJudgment().judge(judgmentInput({ html: httpObservation() }));
  const keys = judgment.findings.map((finding) => finding.criterionKey);

  assert.equal(keys.includes(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_API), false);
  assert.equal(keys.includes(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_API), false);
  assert.equal(judgment.skipped?.total, 1);
  assert.deepEqual(judgment.skipped?.items, ["http:api.session"]);
});

test("the api.session observation adds its own header criteria", async () => {
  const severities = await severityByCriterion(
    judgmentInput({
      html: httpObservation({
        headers: {
          "x-content-type-options": "nosniff",
          "strict-transport-security": "max-age=31536000",
          "x-frame-options": "DENY",
          "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
          "permissions-policy": "geolocation=()",
          "referrer-policy": "no-referrer",
        },
      }),
      api: httpObservation({ role: "api.session", headers: { "x-powered-by": "Express" } }),
    }),
  );

  assert.equal(severities.size, 2);
  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_API), "INFO");
  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_API), "INFO");
});

test("an X-Powered-By header on HTML is an INFO finding", async () => {
  const severities = await severityByCriterion(
    judgmentInput({ html: httpObservation({ headers: { "x-powered-by": "Next.js" } }) }),
  );

  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_HTML), "INFO");
});

test("TLS 1.0 and a 3DES suite yield MEDIUM and HIGH findings", async () => {
  const severities = await severityByCriterion(
    judgmentInput({
      tls: tlsObservation({
        protocols: { tls10: true, tls11: false, tls12: true, tls13: false },
        cipherSuites: [{ protocol: "TLSv1", name: "TLS_RSA_WITH_3DES_EDE_CBC_SHA" }],
      }),
    }),
  );

  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_LEGACY_PROTOCOL), "MEDIUM");
  assert.equal(severities.get(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_WEAK_CIPHER), "HIGH");
});

test("fingerprints are stable across runs and distinct across discriminators", async () => {
  const input = judgmentInput({
    html: httpObservation(),
    tls: tlsObservation({
      protocols: { tls10: true, tls11: true, tls12: true, tls13: false },
      cipherSuites: [
        { protocol: "TLSv1", name: "TLS_RSA_WITH_RC4_128_SHA" },
        { protocol: "TLSv1.2", name: "TLS_RSA_WITH_3DES_EDE_CBC_SHA" },
      ],
    }),
  });
  const judgment = new SecurityEvaluationWebPostureJudgment();

  const first = await judgment.judge(input);
  const second = await judgment.judge(input);
  assert.deepEqual(
    first.findings.map((finding) => finding.fingerprint),
    second.findings.map((finding) => finding.fingerprint),
  );

  assert.equal(
    webPostureFingerprint(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_LEGACY_PROTOCOL, "tls1.0") ===
      webPostureFingerprint(SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_LEGACY_PROTOCOL, "tls1.1"),
    false,
  );
  const cipherFingerprints = first.findings
    .filter((finding) => finding.criterionKey === SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_WEAK_CIPHER)
    .map((finding) => finding.fingerprint);
  assert.equal(cipherFingerprints.length, 2);
  assert.equal(new Set(cipherFingerprints).size, 2);
});

function buildEvidenceProvider(options: {
  targetPaths: Record<string, string>;
  probe: WebProbeAccess | null;
}): SecurityEvaluationWebPostureEvidenceProvider {
  const webOrigins = {
    pathRoles: async () => options.targetPaths,
  } as unknown as SecurityEvaluationWebOriginService;
  return new SecurityEvaluationWebPostureEvidenceProvider(webOrigins, options.probe);
}

test("an unbound probe port fails the run instead of returning an empty collection", async () => {
  const provider = buildEvidenceProvider({ targetPaths: {}, probe: null });

  await assert.rejects(
    provider.collect(subject(SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN), {
      id: "version-1",
      subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
      standardKey: SECURITY_EVALUATION_KEY_WEB_POSTURE,
      version: SECURITY_EVALUATION_WEB_POSTURE_RULE_SET_VERSION,
    }),
    /SECURITY_EVALUATION_WEB_PROBE_ACCESS is not bound/,
  );
});

test("a missing api.session role is reported in the skipped bucket", async () => {
  const requests: string[] = [];
  const probe: WebProbeAccess = {
    observeHttp: async (request) => {
      requests.push(request.role);
      return httpObservation({ role: request.role });
    },
    observeTls: async () => tlsObservation(),
  };
  const provider = buildEvidenceProvider({ targetPaths: {}, probe });

  const collection = await provider.collect(subject(SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN), {
    id: "version-1",
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
    standardKey: SECURITY_EVALUATION_KEY_WEB_POSTURE,
    version: SECURITY_EVALUATION_WEB_POSTURE_RULE_SET_VERSION,
  });

  assert.deepEqual(requests, ["html"]);
  assert.deepEqual(
    collection.items.map((item) => item.id),
    ["http:html", "tls:origin"],
  );
  assert.deepEqual(collection.declaredUnlinked, { total: 0 });
  assert.deepEqual(collection.skipped, {
    total: 1,
    bySource: { "web-origin": 1 },
    note: "api.session path role is not configured; API header criteria were skipped.",
    items: ["http:api.session"],
  });
});

test("a configured api.session role adds one HTTP observation and no skip", async () => {
  const requests: Array<{ role: string; path: string }> = [];
  const probe: WebProbeAccess = {
    observeHttp: async (request) => {
      requests.push({ role: request.role, path: request.path });
      return httpObservation({ role: request.role, requestedUrl: `${ORIGIN}${request.path}` });
    },
    observeTls: async () => tlsObservation(),
  };
  const provider = buildEvidenceProvider({ targetPaths: { "api.session": "/api/session" }, probe });

  const collection = await provider.collect(subject(SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN), {
    id: "version-1",
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
    standardKey: SECURITY_EVALUATION_KEY_WEB_POSTURE,
    version: SECURITY_EVALUATION_WEB_POSTURE_RULE_SET_VERSION,
  });

  assert.deepEqual(requests, [
    { role: "html", path: "/" },
    { role: "api.session", path: "/api/session" },
  ]);
  assert.deepEqual(
    collection.items.map((item) => item.id),
    ["http:html", "http:api.session", "tls:origin"],
  );
  assert.deepEqual(collection.skipped, { total: 0 });
});
