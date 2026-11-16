import { ConflictException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";

import {
  SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION,
  SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION,
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_AUTH_BOUNDARY,
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_CRYPTO_MISUSE,
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_DANGEROUS_CONFIG,
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_INJECTION,
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_SECRET_EXPOSURE,
  SECURITY_EVALUATION_CODE_SCAN_RULE_SET_VERSION,
  SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION,
  SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY,
  SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  SECURITY_EVALUATION_KEY_AWS_CUSTOM,
  SECURITY_EVALUATION_KEY_CODE_SCAN,
  SECURITY_EVALUATION_KEY_NPM_OSV,
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
  SECURITY_EVALUATION_KEY_WEB_POSTURE,
  SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION,
  SECURITY_EVALUATION_INTELLIGENCE_CRITERION_KEY,
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
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
} from "../security-evaluation.constants";
import {
  SECURITY_EVALUATION_AWS_CIS_BENCHMARK,
  SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK,
} from "../judgment/aws-config/security-evaluation-aws-config.rulebook";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

interface CriterionSeed {
  criterionKey: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
}

interface BaselineSeed {
  kind: string;
  standardKey: string;
  version: string;
  description: string;
  metadata: Record<string, unknown>;
  criteria: CriterionSeed[];
}

/**
 * SecurityEvaluationCriteriaSeed — code-defined criteria, published once.
 *
 * Criteria content is part of this build, not admin data, and the version
 * string is the only thing that changes when the rules change. Seeding is
 * idempotent and safe under concurrent instances (unique-violation and
 * already-published races are absorbed), and it is retried lazily if the first
 * attempt failed — e.g. before the consumer has pushed the schema.
 */
@Injectable()
export class SecurityEvaluationCriteriaSeed implements OnModuleInit {
  private readonly logger = new Logger(SecurityEvaluationCriteriaSeed.name);
  private readonly seededFamilies = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly criteria: EvaluationCriteriaService,
  ) {}

  onModuleInit(): void {
    void this.seedMissingBaselines().catch((error: unknown) => {
      this.logger.warn(`Criteria baselines not seeded yet: ${getErrorMessage(error)}`);
    });
  }

  async seedDependencyBaseline(): Promise<void> {
    await this.seedBaselineIfMissing({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
      standardKey: SECURITY_EVALUATION_KEY_NPM_OSV,
      version: SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION,
      description: "Dependency vulnerability baseline: installed npm packages are matched against OSV.",
      metadata: { ecosystem: "npm", dataSource: "https://osv.dev" },
      criteria: [
        {
          criterionKey: SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY,
          name: "Vulnerable dependency",
          description: "An installed npm package version is listed as affected by an OSV vulnerability.",
          metadata: { ecosystem: "npm", dataSource: "https://osv.dev" },
        },
      ],
    });
  }

  /** CIS AWS Foundations Benchmark v1.5 initial set (ADR-027 D3). */
  async seedAwsConfigBaseline(): Promise<void> {
    const entries = SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.filter(
      (entry) => entry.standardKey === SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    );
    await this.seedBaselineIfMissing({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
      standardKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
      version: SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION,
      description: `${SECURITY_EVALUATION_AWS_CIS_BENCHMARK}: collected account configuration items are asserted per control.`,
      metadata: { benchmark: SECURITY_EVALUATION_AWS_CIS_BENCHMARK },
      criteria: entries.map((entry) => ({
        criterionKey: entry.criterionKey,
        name: entry.name,
        description: `${SECURITY_EVALUATION_AWS_CIS_BENCHMARK} control ${entry.controlId}.`,
        metadata: {
          controlId: entry.controlId,
          severity: entry.severity,
          remediation: entry.remediation,
          knowledgeRequirements: [...entry.requiredKnowledgeTypes],
          benchmark: SECURITY_EVALUATION_AWS_CIS_BENCHMARK,
        },
      })),
    });
  }

  /** aws-custom rules inherited from the predecessor aws-audit module (ADR-033/ADR-037). */
  async seedAwsCustomBaseline(): Promise<void> {
    const entries = SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.filter(
      (entry) => entry.standardKey === SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    );
    await this.seedBaselineIfMissing({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
      standardKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
      version: SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION,
      description:
        "aws-custom: non-benchmark cloud configuration checks (access keys, IAM policies, RDS/S3/EC2 hardening) inherited from the predecessor aws-audit module.",
      metadata: { benchmark: null },
      criteria: entries.map((entry) => ({
        criterionKey: entry.criterionKey,
        name: entry.name,
        description: entry.remediation,
        metadata: {
          severity: entry.severity,
          remediation: entry.remediation,
          knowledgeRequirements: [...entry.requiredKnowledgeTypes],
        },
      })),
    });
  }

  /** INTEL criteria: recent threat-intel items matched to the subject's scope (ADR-039). */
  async seedIntelligenceBaseline(): Promise<void> {
    await this.seedBaselineIfMissing({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
      standardKey: SECURITY_EVALUATION_KEY_THREAT_INTEL,
      version: SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION,
      description:
        "Threat-intel relevance: recently collected threat-intelligence items are matched against the subject's scope entity set (hard entity recall + LLM structured re-rank).",
      metadata: { matchProtocol: "b3-hard-recall-plus-llm-rerank", negativeCache: "per-item-per-scope" },
      criteria: [
        {
          criterionKey: SECURITY_EVALUATION_INTELLIGENCE_CRITERION_KEY,
          name: "Threat exposure",
          description:
            "A recently collected threat-intel item affects the subject's scope (matched entity or LLM-confirmed relevance).",
          metadata: { verdictSources: ["hard-recall", "llm"] },
        },
      ],
    });
  }

  /**
   * CODE_SCAN criteria (ADR-054): one ASSERTION per risk category. The
   * metadata carries the severity guidance and the CWE mapping the LLM
   * judgment aligns to; the product is assertion findings, never a score
   * (ADR-020 D5.3).
   */
  async seedCodeScanBaseline(): Promise<void> {
    await this.seedBaselineIfMissing({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
      standardKey: SECURITY_EVALUATION_KEY_CODE_SCAN,
      version: SECURITY_EVALUATION_CODE_SCAN_RULE_SET_VERSION,
      description:
        "Code scan: every source file of the repository snapshot is judged by an LLM against five risk categories (full scan; a finding's identity is its criterion + path + symbol, not the content).",
      metadata: { mechanism: "code-llm", scanScope: "full" },
      criteria: [
        {
          criterionKey: SECURITY_EVALUATION_CODE_SCAN_CRITERION_INJECTION,
          name: "Injection sink",
          description:
            "Untrusted input reaches a command, query, template or expression execution sink without parameterization or validation.",
          metadata: {
            severityGuidance: "MEDIUM to CRITICAL depending on reachability of the sink",
            cwe: ["CWE-78", "CWE-89", "CWE-94"],
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_CODE_SCAN_CRITERION_AUTH_BOUNDARY,
          name: "Missing authorization boundary",
          description:
            "A privileged operation is reachable without an authentication or authorization check at the boundary.",
          metadata: {
            severityGuidance: "HIGH to CRITICAL when the privileged operation is externally reachable",
            cwe: ["CWE-306", "CWE-862"],
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_CODE_SCAN_CRITERION_SECRET_EXPOSURE,
          name: "Hardcoded secret",
          description: "Credential, token, key or other secret material embedded in source code.",
          metadata: { severityGuidance: "HIGH; CRITICAL when the secret grants production access", cwe: ["CWE-798"] },
        },
        {
          criterionKey: SECURITY_EVALUATION_CODE_SCAN_CRITERION_CRYPTO_MISUSE,
          name: "Cryptographic misuse",
          description:
            "Weak algorithm, static IV, predictable randomness for security purposes, or other misuse of a cryptographic primitive.",
          metadata: {
            severityGuidance: "LOW to HIGH depending on the protected asset",
            cwe: ["CWE-327", "CWE-329", "CWE-338"],
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_CODE_SCAN_CRITERION_DANGEROUS_CONFIG,
          name: "Dangerous configuration",
          description:
            "Insecure default or dangerous flag in code-level configuration (TLS verification off, debug enabled, permissive CORS, …).",
          metadata: { severityGuidance: "MEDIUM; HIGH when exposed in a production path", cwe: ["CWE-16", "CWE-942"] },
        },
      ],
    });
  }

  /**
   * WEB_POSTURE criteria (ADR-066 §4): one ASSERTION per externally observable
   * fact of a verified web origin — response-header presence and values, HSTS
   * parameters, and TLS protocol/cipher posture. The metadata states the
   * pass/fail predicate for readers; the mechanism carries the authoritative
   * severity table.
   */
  async seedWebPostureBaseline(): Promise<void> {
    await this.seedBaselineIfMissing({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
      standardKey: SECURITY_EVALUATION_KEY_WEB_POSTURE,
      version: SECURITY_EVALUATION_WEB_POSTURE_RULE_SET_VERSION,
      description:
        "Web posture: one bounded observation per run (the HTML entry point, the configured API session path when present, and the TLS handshake) is asserted for response-header and TLS posture.",
      metadata: { mechanism: "web-posture", observation: "single-get-plus-tls-handshake" },
      criteria: [
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_HTML,
          name: "Missing X-Content-Type-Options on HTML responses",
          description: "The HTML entry point's response does not opt out of MIME sniffing.",
          metadata: {
            severity: "LOW",
            target: "path:html",
            predicate: 'header "x-content-type-options" is absent or its trimmed value is not "nosniff"',
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_API,
          name: "Missing X-Content-Type-Options on API responses",
          description: "The configured API session path does not opt out of MIME sniffing.",
          metadata: {
            severity: "INFO",
            target: "path:api.session",
            predicate: 'header "x-content-type-options" is absent or its trimmed value is not "nosniff"',
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_HSTS,
          name: "Missing or short HSTS",
          description: "The origin does not require HTTPS for a meaningful lifetime.",
          metadata: {
            severity: "LOW",
            target: "origin",
            predicate: 'header "strict-transport-security" is absent or its max-age is below 15552000 seconds',
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_HTML,
          name: "X-Powered-By exposed on HTML responses",
          description: "The HTML entry point discloses the technology stack.",
          metadata: { severity: "INFO", target: "path:html", predicate: 'header "x-powered-by" is present' },
        },
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_API,
          name: "X-Powered-By exposed on API responses",
          description: "The API session path discloses the technology stack.",
          metadata: {
            severity: "INFO",
            target: "path:api.session",
            predicate: 'header "x-powered-by" is present',
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_FRAME_OPTIONS,
          name: "Missing frame embedding protection",
          description: "The HTML entry point can be embedded by another origin.",
          metadata: {
            severity: "MEDIUM",
            target: "path:html",
            predicate: 'header "x-frame-options" is absent and the CSP header does not contain "frame-ancestors"',
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_CSP,
          name: "Missing Content-Security-Policy",
          description: "The HTML entry point declares no content security policy.",
          metadata: {
            severity: "LOW",
            target: "path:html",
            predicate: 'header "content-security-policy" is absent',
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_PERMISSIONS_POLICY,
          name: "Missing Permissions-Policy",
          description: "The HTML entry point does not restrict powerful browser features.",
          metadata: {
            severity: "INFO",
            target: "path:html",
            predicate: 'header "permissions-policy" is absent',
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_REFERRER_POLICY,
          name: "Missing Referrer-Policy",
          description: "The HTML entry point sends full referrers to other origins by default.",
          metadata: {
            severity: "LOW",
            target: "path:html",
            predicate: 'header "referrer-policy" is absent',
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_LEGACY_PROTOCOL,
          name: "Deprecated TLS protocol enabled",
          description: "The origin still negotiates TLS 1.0 or TLS 1.1.",
          metadata: {
            severity: "MEDIUM",
            target: "origin",
            predicate: "a TLS handshake reports tls10 or tls11 as supported",
          },
        },
        {
          criterionKey: SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_WEAK_CIPHER,
          name: "Weak TLS cipher suite offered",
          description: "The origin offers a cipher suite that is broken or export-grade.",
          metadata: {
            severity: "HIGH",
            target: "origin",
            predicate: "an offered cipher suite name matches NULL, anon, EXPORT, RC4, 3DES, DES or MD5",
          },
        },
      ],
    });
  }

  private async seedMissingBaselines(): Promise<void> {
    await this.seedDependencyBaseline();
    await this.seedAwsConfigBaseline();
    await this.seedAwsCustomBaseline();
    await this.seedIntelligenceBaseline();
    await this.seedCodeScanBaseline();
    await this.seedWebPostureBaseline();
  }

  private async seedBaselineIfMissing(baseline: BaselineSeed): Promise<void> {
    const seedKey = `${baseline.kind}/${baseline.standardKey}/${baseline.version}`;
    if (this.seededFamilies.has(seedKey)) return;

    let row = await this.findVersion(baseline.kind, baseline.standardKey, baseline.version);
    if (!row) {
      try {
        row = await this.criteria.createVersion({
          subjectKind: baseline.kind,
          standardKey: baseline.standardKey,
          version: baseline.version,
          description: baseline.description,
          metadata: baseline.metadata,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        row = await this.findVersion(baseline.kind, baseline.standardKey, baseline.version);
        if (!row) throw error;
      }
    }

    // Seed the missing criteria by key rather than only when the version is
    // empty: a crash between the first criterion write and publication leaves a
    // partially seeded draft, and a count === 0 gate would publish it as-is.
    const existing = await this.prisma.evaluationCriterion.findMany({
      where: { ruleSetVersionId: row.id },
      select: { criterionKey: true },
    });
    const existingKeys = new Set(existing.map((criterion) => criterion.criterionKey));
    for (const criterion of baseline.criteria) {
      if (existingKeys.has(criterion.criterionKey)) continue;
      try {
        await this.criteria.addCriterion(row.id, { kind: "ASSERTION", ...criterion });
      } catch (error) {
        // A concurrent instance added the criterion first; that is the goal.
        if (!isUniqueViolation(error)) throw error;
      }
    }

    const latest = await this.findVersion(baseline.kind, baseline.standardKey, baseline.version);
    if (!latest) {
      throw new Error(
        `Criteria version ${baseline.kind}/${baseline.standardKey}/${baseline.version} disappeared during seeding`,
      );
    }
    if (!latest.publishedAt) {
      try {
        await this.criteria.publishVersion(latest.id);
      } catch (error) {
        // Published concurrently; a later read proves the published row exists.
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    this.seededFamilies.add(seedKey);
  }

  private findVersion(kind: string, standardKey: string, version: string) {
    return this.prisma.evaluationRuleSetVersion.findFirst({ where: { subjectKind: kind, standardKey, version } });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}
