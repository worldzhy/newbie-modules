import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  EvaluationCoverageBucket,
  EvaluationEvidenceItem,
  EvaluationFindingCandidate,
  EvaluationFindingSeverity,
} from "@modules/evaluation/ports/evaluation.contracts";
import type { EvaluationJudgment, JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import type { WebHttpObservation, WebTlsObservation } from "../../ports/web-probe.access";
import {
  SECURITY_EVALUATION_KEY_WEB_POSTURE,
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
} from "../../security-evaluation.constants";
import {
  SECURITY_EVALUATION_MECHANISM_NAME_WEB_POSTURE,
  type SecurityEvaluationJudgmentMechanism,
} from "../security-evaluation-mechanism";

const HTML_EVIDENCE_ID = "http:html";
const API_SESSION_EVIDENCE_ID = "http:api.session";
const TLS_EVIDENCE_ID = "tls:origin";

/** Six months, the HSTS lifetime this rule set requires (ADR-066 §4). */
const HSTS_MIN_MAX_AGE_SECONDS = 15_552_000;
const HSTS_MAX_AGE_PATTERN = /(?:^|;)\s*max-age\s*=\s*(\d+)/i;
const WEAK_CIPHER_PATTERN = /(^|[-_])(NULL|anon|eNULL|aNULL|EXPORT|RC4|3DES|DES|MD5)([-_]|$)/i;

/** Severity table of ADR-066 §4 — the single source of these levels. */
const SEVERITY_BY_CRITERION: ReadonlyMap<string, EvaluationFindingSeverity> = new Map([
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_HTML, "LOW"],
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_API, "INFO"],
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_HSTS, "LOW"],
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_HTML, "INFO"],
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_API, "INFO"],
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_FRAME_OPTIONS, "MEDIUM"],
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_CSP, "LOW"],
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_PERMISSIONS_POLICY, "INFO"],
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_REFERRER_POLICY, "LOW"],
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_LEGACY_PROTOCOL, "MEDIUM"],
  [SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_WEAK_CIPHER, "HIGH"],
]);

/**
 * Stable finding identity (ADR-066 §5): sha256 over
 * `criterionKey + "\u0000" + discriminator`. The discriminator is the header
 * name plus role for header rules, the protocol for deprecated-TLS findings,
 * and the suite name for weak-cipher findings — so "the same header is still
 * missing a year later" keeps one finding open, while a different weak suite
 * is a different problem. `subjectKey` is deliberately absent: subject scope
 * is carried by the finding row, matching the other identity helpers.
 */
export function webPostureFingerprint(criterionKey: string, discriminator: string): string {
  return createHash("sha256").update(`${criterionKey}\u0000${discriminator}`).digest("hex");
}

interface FindingDraft {
  criterionKey: string;
  discriminator: string;
  title: string;
  detail: string;
  evidenceRef: string;
}

/**
 * web-posture judgment — deterministic assertions over the observed HTTP and
 * TLS posture of a verified web origin (ADR-066 §4, §5).
 *
 * Pure by construction: it reads the run's evidence manifest only, calls no
 * model and no database, and every PASS emits nothing. Two runs over the same
 * observation therefore produce byte-identical findings, which is what keeps
 * finding lifecycle and MTTR meaningful.
 */
@Injectable()
export class SecurityEvaluationWebPostureJudgment implements SecurityEvaluationJudgmentMechanism {
  readonly name = SECURITY_EVALUATION_MECHANISM_NAME_WEB_POSTURE;

  judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    const httpById = new Map<string, WebHttpObservation>();
    let tls: WebTlsObservation | null = null;
    const evaluatedRefs: string[] = [];

    for (const item of input.evidence) {
      if (item.layer !== "web" || item.source !== "web-origin") continue;
      const observation = readObservation(item);
      if (item.id === TLS_EVIDENCE_ID && isTlsObservation(observation)) {
        tls = observation;
        evaluatedRefs.push(item.id);
        continue;
      }
      if ((item.id === HTML_EVIDENCE_ID || item.id === API_SESSION_EVIDENCE_ID) && isHttpObservation(observation)) {
        httpById.set(item.id, observation);
        evaluatedRefs.push(item.id);
      }
    }

    const drafts: FindingDraft[] = [];
    const html = httpById.get(HTML_EVIDENCE_ID);
    if (html) this.judgeHtml(html, drafts);
    const api = httpById.get(API_SESSION_EVIDENCE_ID);
    if (api) this.judgeApi(api, drafts);
    if (tls) this.judgeTls(tls, drafts);

    const findings = drafts.map((draft): EvaluationFindingCandidate => ({
      criterionKey: draft.criterionKey,
      fingerprint: webPostureFingerprint(draft.criterionKey, draft.discriminator),
      severity: severityOf(draft.criterionKey),
      title: draft.title,
      detail: draft.detail,
      evidenceRefs: [draft.evidenceRef],
    }));

    const skipped: EvaluationCoverageBucket | undefined = api
      ? undefined
      : {
          total: 1,
          items: [API_SESSION_EVIDENCE_ID],
          note: "api.session path role is not configured; API header criteria were skipped.",
        };

    return Promise.resolve({
      verdicts: [],
      findings,
      evaluatedRefs,
      ...(skipped ? { skipped } : {}),
      summary: `Web posture judged ${evaluatedRefs.length} observation(s): ${findings.length} finding(s).`,
      metadata: { rule: SECURITY_EVALUATION_KEY_WEB_POSTURE },
    });
  }

  /** HTML entry-point rules: MIME sniffing, HSTS, stack disclosure, framing, CSP and feature policy. */
  private judgeHtml(observation: WebHttpObservation, drafts: FindingDraft[]): void {
    const xcto = observation.headers["x-content-type-options"];
    if (!isNosniff(xcto)) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_HTML,
        discriminator: "x-content-type-options:html",
        title: "Missing X-Content-Type-Options on HTML responses",
        detail: `The HTML entry point returned "x-content-type-options: ${describe(xcto)}"; expected "nosniff".`,
        evidenceRef: HTML_EVIDENCE_ID,
      });
    }

    const hsts = observation.headers["strict-transport-security"];
    const maxAge = hsts === undefined ? null : parseMaxAge(hsts);
    if (hsts === undefined || maxAge === null || maxAge < HSTS_MIN_MAX_AGE_SECONDS) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_HSTS,
        discriminator: "strict-transport-security:html",
        title: "Missing or short HSTS",
        detail:
          hsts === undefined
            ? "The origin sent no Strict-Transport-Security header."
            : `The origin sent "strict-transport-security: ${hsts}" with max-age ${maxAge ?? "unset"}; at least ${HSTS_MIN_MAX_AGE_SECONDS} seconds is required.`,
        evidenceRef: HTML_EVIDENCE_ID,
      });
    }

    const poweredBy = observation.headers["x-powered-by"];
    if (poweredBy !== undefined) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_HTML,
        discriminator: "x-powered-by:html",
        title: "X-Powered-By exposed on HTML responses",
        detail: `The HTML entry point disclosed "x-powered-by: ${poweredBy}".`,
        evidenceRef: HTML_EVIDENCE_ID,
      });
    }

    const frameOptions = observation.headers["x-frame-options"];
    const csp = observation.headers["content-security-policy"];
    if (frameOptions === undefined && !(csp ?? "").toLowerCase().includes("frame-ancestors")) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_FRAME_OPTIONS,
        discriminator: "x-frame-options:html",
        title: "Missing frame embedding protection",
        detail:
          "The HTML entry point sent no X-Frame-Options header and its Content-Security-Policy carries no frame-ancestors directive.",
        evidenceRef: HTML_EVIDENCE_ID,
      });
    }

    if (csp === undefined) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_CSP,
        discriminator: "content-security-policy:html",
        title: "Missing Content-Security-Policy",
        detail: "The HTML entry point sent no Content-Security-Policy header.",
        evidenceRef: HTML_EVIDENCE_ID,
      });
    }

    const permissionsPolicy = observation.headers["permissions-policy"];
    if (permissionsPolicy === undefined) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_PERMISSIONS_POLICY,
        discriminator: "permissions-policy:html",
        title: "Missing Permissions-Policy",
        detail: "The HTML entry point sent no Permissions-Policy header.",
        evidenceRef: HTML_EVIDENCE_ID,
      });
    }

    const referrerPolicy = observation.headers["referrer-policy"];
    if (referrerPolicy === undefined) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_REFERRER_POLICY,
        discriminator: "referrer-policy:html",
        title: "Missing Referrer-Policy",
        detail: "The HTML entry point sent no Referrer-Policy header.",
        evidenceRef: HTML_EVIDENCE_ID,
      });
    }
  }

  /** API session rules: MIME sniffing and stack disclosure on the JSON endpoint. */
  private judgeApi(observation: WebHttpObservation, drafts: FindingDraft[]): void {
    const xcto = observation.headers["x-content-type-options"];
    if (!isNosniff(xcto)) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_API,
        discriminator: "x-content-type-options:api.session",
        title: "Missing X-Content-Type-Options on API responses",
        detail: `The API session path returned "x-content-type-options: ${describe(xcto)}"; expected "nosniff".`,
        evidenceRef: API_SESSION_EVIDENCE_ID,
      });
    }

    const poweredBy = observation.headers["x-powered-by"];
    if (poweredBy !== undefined) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_API,
        discriminator: "x-powered-by:api.session",
        title: "X-Powered-By exposed on API responses",
        detail: `The API session path disclosed "x-powered-by: ${poweredBy}".`,
        evidenceRef: API_SESSION_EVIDENCE_ID,
      });
    }
  }

  /** TLS rules: one finding per deprecated protocol and one per weak suite. */
  private judgeTls(observation: WebTlsObservation, drafts: FindingDraft[]): void {
    if (observation.protocols.tls10) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_LEGACY_PROTOCOL,
        discriminator: "tls1.0",
        title: "Deprecated TLS protocol enabled",
        detail: "The origin still negotiates TLS 1.0.",
        evidenceRef: TLS_EVIDENCE_ID,
      });
    }
    if (observation.protocols.tls11) {
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_LEGACY_PROTOCOL,
        discriminator: "tls1.1",
        title: "Deprecated TLS protocol enabled",
        detail: "The origin still negotiates TLS 1.1.",
        evidenceRef: TLS_EVIDENCE_ID,
      });
    }

    for (const suite of observation.cipherSuites) {
      if (!WEAK_CIPHER_PATTERN.test(suite.name)) continue;
      drafts.push({
        criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_WEAK_CIPHER,
        discriminator: suite.name,
        title: `Weak TLS cipher suite ${suite.name} offered`,
        detail: `The origin offers ${suite.name} (${suite.protocol}); broken or export-grade suites are forbidden.`,
        evidenceRef: TLS_EVIDENCE_ID,
      });
    }
  }
}

function severityOf(criterionKey: string): EvaluationFindingSeverity {
  const severity = SEVERITY_BY_CRITERION.get(criterionKey);
  if (!severity) throw new Error(`web-posture criterion "${criterionKey}" has no declared severity (ADR-066 §4).`);
  return severity;
}

function isNosniff(value: string | undefined): boolean {
  return value !== undefined && value.trim().toLowerCase() === "nosniff";
}

function parseMaxAge(value: string): number | null {
  const match = HSTS_MAX_AGE_PATTERN.exec(value);
  return match ? Number(match[1]) : null;
}

function describe(value: string | undefined): string {
  return value === undefined ? "<absent>" : value;
}

function readObservation(item: EvaluationEvidenceItem): unknown {
  const payload = item.payload;
  if (!payload || typeof payload !== "object") return null;
  return (payload as Record<string, unknown>).observation;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isHttpObservation(value: unknown): value is WebHttpObservation {
  const record = asRecord(value);
  return record !== null && typeof record.status === "number" && asRecord(record.headers) !== null;
}

function isTlsObservation(value: unknown): value is WebTlsObservation {
  const record = asRecord(value);
  return record !== null && asRecord(record.protocols) !== null && Array.isArray(record.cipherSuites);
}
