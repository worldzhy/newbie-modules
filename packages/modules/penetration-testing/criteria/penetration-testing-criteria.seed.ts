import { ConflictException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

import {
  PENETRATION_TESTING_CRITERIA_BY_KEY,
  PENETRATION_TESTING_CRITERION_BROKEN_ACCESS_CONTROL,
  PENETRATION_TESTING_CRITERION_CERTIFICATE_ISSUE,
  PENETRATION_TESTING_CRITERION_CONFIRMED_EXPLOIT,
  PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT,
  PENETRATION_TESTING_CRITERION_EXPOSED_SENSITIVE_FILE,
  PENETRATION_TESTING_CRITERION_EXPOSED_SERVICE,
  PENETRATION_TESTING_CRITERION_INJECTION,
  PENETRATION_TESTING_CRITERION_SECURITY_MISCONFIGURATION,
  PENETRATION_TESTING_CRITERION_TECHNOLOGY_DISCLOSURE,
  PENETRATION_TESTING_CRITERION_TLS_WEAKNESS,
  PENETRATION_TESTING_CRITERION_UNCLASSIFIED,
  PENETRATION_TESTING_CRITERION_VULNERABLE_COMPONENT,
  PENETRATION_TESTING_KEY_ATTACK_SURFACE,
  PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING,
  PENETRATION_TESTING_KEY_EXPLOIT_VERIFICATION,
  PENETRATION_TESTING_KEY_VULNERABILITY_SCAN,
  PENETRATION_TESTING_RULE_SET_VERSION,
  PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET,
} from "../penetration-testing.constants";

interface CriterionSeed {
  criterionKey: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
}

interface BaselineSeed {
  standardKey: string;
  version: string;
  description: string;
  metadata: Record<string, unknown>;
  criteria: CriterionSeed[];
}

const SEVERITY = {
  [PENETRATION_TESTING_CRITERION_EXPOSED_SERVICE]: "MEDIUM",
  [PENETRATION_TESTING_CRITERION_CERTIFICATE_ISSUE]: "HIGH",
  [PENETRATION_TESTING_CRITERION_TECHNOLOGY_DISCLOSURE]: "INFO",
  [PENETRATION_TESTING_CRITERION_TLS_WEAKNESS]: "MEDIUM",
  [PENETRATION_TESTING_CRITERION_SECURITY_MISCONFIGURATION]: "MEDIUM",
  [PENETRATION_TESTING_CRITERION_VULNERABLE_COMPONENT]: "HIGH",
  [PENETRATION_TESTING_CRITERION_INJECTION]: "HIGH",
  [PENETRATION_TESTING_CRITERION_BROKEN_ACCESS_CONTROL]: "HIGH",
  [PENETRATION_TESTING_CRITERION_EXPOSED_SENSITIVE_FILE]: "HIGH",
  [PENETRATION_TESTING_CRITERION_CONFIRMED_EXPLOIT]: "HIGH",
  [PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT]: "INFO",
  [PENETRATION_TESTING_CRITERION_UNCLASSIFIED]: "INFO",
} as const;

/**
 * PenetrationTestingCriteriaSeed — four published rule sets, one per level
 * (ADR-075 §2, §6). All criteria are ASSERTION: each fact becomes one finding;
 * there is no numeric score to game.
 *
 * Seeding mirrors the security-evaluation seed: code-defined content, idempotent
 * under concurrent starts, and retried lazily if the consumer schema was not
 * pushed yet.
 */
@Injectable()
export class PenetrationTestingCriteriaSeed implements OnModuleInit {
  private readonly logger = new Logger(PenetrationTestingCriteriaSeed.name);
  private readonly seededKeys = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly criteria: EvaluationCriteriaService,
  ) {}

  onModuleInit(): void {
    void this.seedAll().catch((error: unknown) => {
      this.logger.warn(`Penetration-testing criteria not seeded yet: ${getErrorMessage(error)}`);
    });
  }

  async seedAll(): Promise<void> {
    for (const baseline of this.baselines()) {
      await this.seedBaselineIfMissing(baseline);
    }
  }

  private baselines(): BaselineSeed[] {
    return [
      {
        standardKey: PENETRATION_TESTING_KEY_ATTACK_SURFACE,
        version: PENETRATION_TESTING_RULE_SET_VERSION,
        description:
          "Attack surface (L1): declared ports, service banners, certificate metadata and TLS posture observed by a bounded TCP connect and HTTP/TLS probe.",
        metadata: { level: "L1", mechanism: "attack-surface", criteriaKind: "ASSERTION" },
        criteria: [
          {
            criterionKey: PENETRATION_TESTING_CRITERION_EXPOSED_SERVICE,
            name: "Unexpected exposed service",
            description:
              "A declared port answers with a service or version banner that is not part of the declared contract.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_EXPOSED_SERVICE],
              mechanism: "engine",
              sourceKey: "connect-probe+httpx",
            },
          },
          {
            criterionKey: PENETRATION_TESTING_CRITERION_CERTIFICATE_ISSUE,
            name: "Certificate problem",
            description: "The TLS certificate is expired, self-signed, hostname-mismatched or uses a weak key.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_CERTIFICATE_ISSUE],
              mechanism: "deterministic",
              cwe: ["CWE-295"],
            },
          },
          {
            criterionKey: PENETRATION_TESTING_CRITERION_TECHNOLOGY_DISCLOSURE,
            name: "Technology disclosure",
            description: "Responses or error pages disclose the server, framework or component version.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_TECHNOLOGY_DISCLOSURE],
              mechanism: "deterministic",
              cwe: ["CWE-200"],
            },
          },
          {
            criterionKey: PENETRATION_TESTING_CRITERION_TLS_WEAKNESS,
            name: "Weak TLS posture",
            description: "The origin negotiates a deprecated protocol or offers a broken cipher suite.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_TLS_WEAKNESS],
              mechanism: "deterministic",
              cwe: ["CWE-326", "CWE-327"],
            },
          },
        ],
      },
      {
        standardKey: PENETRATION_TESTING_KEY_VULNERABILITY_SCAN,
        version: PENETRATION_TESTING_RULE_SET_VERSION,
        description:
          "Vulnerability scan (L2): non-destructive active rules from ZAP and a pinned nuclei template set; writes, DoS and brute-force tags are excluded.",
        metadata: { level: "L2", mechanism: "vulnerability-scan", criteriaKind: "ASSERTION" },
        criteria: [
          {
            criterionKey: PENETRATION_TESTING_CRITERION_SECURITY_MISCONFIGURATION,
            name: "Security misconfiguration",
            description: "A passive or safe-active rule found a configuration that weakens the target's defenses.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_SECURITY_MISCONFIGURATION],
              mechanism: "engine",
              sourceKey: "zap",
              cwe: ["CWE-16"],
            },
          },
          {
            criterionKey: PENETRATION_TESTING_CRITERION_VULNERABLE_COMPONENT,
            name: "Vulnerable component or CVE",
            description: "A component version or a nuclei CVE template matches a known vulnerability.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_VULNERABLE_COMPONENT],
              mechanism: "engine",
              sourceKey: "nuclei",
            },
          },
          {
            criterionKey: PENETRATION_TESTING_CRITERION_INJECTION,
            name: "Injection signal",
            description: "A scan rule reports a likely injection point (SQL, command, template or expression).",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_INJECTION],
              mechanism: "engine",
              sourceKey: "zap+nuclei",
              cwe: ["CWE-74", "CWE-89", "CWE-78"],
            },
          },
          {
            criterionKey: PENETRATION_TESTING_CRITERION_BROKEN_ACCESS_CONTROL,
            name: "Broken access control signal",
            description: "A scan rule reports a likely authorization or authentication bypass.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_BROKEN_ACCESS_CONTROL],
              mechanism: "engine",
              sourceKey: "zap+nuclei",
              cwe: ["CWE-284", "CWE-862"],
            },
          },
          {
            criterionKey: PENETRATION_TESTING_CRITERION_EXPOSED_SENSITIVE_FILE,
            name: "Exposed sensitive file or endpoint",
            description: "A backup, debug, metadata or configuration endpoint is reachable.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_EXPOSED_SENSITIVE_FILE],
              mechanism: "engine",
              sourceKey: "nuclei+zap",
              cwe: ["CWE-538"],
            },
          },
          {
            criterionKey: PENETRATION_TESTING_CRITERION_UNCLASSIFIED,
            name: "Unclassified engine finding",
            description: "An engine finding did not map to a named criterion; it is kept rather than silently dropped.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_UNCLASSIFIED],
              mechanism: "engine",
              catchAll: true,
            },
          },
        ],
      },
      {
        standardKey: PENETRATION_TESTING_KEY_EXPLOIT_VERIFICATION,
        version: PENETRATION_TESTING_RULE_SET_VERSION,
        description:
          "Exploit verification (L3): one approved finding and attack class are verified with a read-only technique; proving exploitability stops at read access.",
        metadata: { level: "L3", mechanism: "exploit-verification", criteriaKind: "ASSERTION" },
        criteria: [
          {
            criterionKey: PENETRATION_TESTING_CRITERION_CONFIRMED_EXPLOIT,
            name: "Confirmed exploit",
            description:
              "The approved attack class was successfully exercised against the approved finding with a read-only technique.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_CONFIRMED_EXPLOIT],
              severityPolicy: "E2: confirmed exploitation may raise a suspected E1 finding by one level",
              mechanism: "engine",
              sourceKey: "zap+nuclei+sqlmap-readonly",
            },
          },
        ],
      },
      {
        standardKey: PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING,
        version: PENETRATION_TESTING_RULE_SET_VERSION,
        description:
          "Destructive testing (L4): a fixed playbook performs one controlled write against an approved disposable object, verifies it, cleans up and verifies the cleanup.",
        metadata: { level: "L4", mechanism: "destructive-testing", criteriaKind: "ASSERTION" },
        criteria: [
          {
            criterionKey: PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT,
            name: "Confirmed destructive impact",
            description:
              "The playbook demonstrably changed the approved test object and cleaned up successfully; business impact is proven without raising the underlying finding's severity.",
            metadata: {
              severity: SEVERITY[PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT],
              severityPolicy: "E3: business impact only, never a severity uplift",
              mechanism: "playbook",
              cleanupRequired: true,
            },
          },
        ],
      },
    ];
  }

  private async seedBaselineIfMissing(baseline: BaselineSeed): Promise<void> {
    const seedKey = `${PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET}/${baseline.standardKey}/${baseline.version}`;
    if (this.seededKeys.has(seedKey)) return;

    let row = await this.findVersion(baseline.standardKey, baseline.version);
    if (!row) {
      try {
        row = await this.criteria.createVersion({
          subjectKind: PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET,
          standardKey: baseline.standardKey,
          version: baseline.version,
          description: baseline.description,
          metadata: baseline.metadata,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        row = await this.findVersion(baseline.standardKey, baseline.version);
        if (!row) throw error;
      }
    }

    const existing = await this.prisma.evaluationCriterion.findMany({
      where: { ruleSetVersionId: row.id },
      select: { criterionKey: true },
    });
    const existingKeys = new Set(existing.map((criterion) => criterion.criterionKey));
    const allowed = new Set(
      PENETRATION_TESTING_CRITERIA_BY_KEY[baseline.standardKey as keyof typeof PENETRATION_TESTING_CRITERIA_BY_KEY],
    );
    for (const criterion of baseline.criteria) {
      if (!allowed.has(criterion.criterionKey)) {
        throw new Error(`Criterion ${criterion.criterionKey} is not declared for ${baseline.standardKey}`);
      }
      if (existingKeys.has(criterion.criterionKey)) continue;
      try {
        await this.criteria.addCriterion(row.id, { kind: "ASSERTION", ...criterion });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }

    const latest = await this.findVersion(baseline.standardKey, baseline.version);
    if (!latest) {
      throw new Error(`Criteria version ${seedKey} disappeared during seeding`);
    }
    if (!latest.publishedAt) {
      try {
        await this.criteria.publishVersion(latest.id);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    this.seededKeys.add(seedKey);
  }

  private findVersion(standardKey: string, version: string) {
    return this.prisma.evaluationRuleSetVersion.findFirst({
      where: {
        subjectKind: PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET,
        standardKey,
        version,
      },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}
