import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  EvaluationEvidenceItem,
  EvaluationFindingCandidate,
} from "@modules/evaluation/ports/evaluation.contracts";
import type { EvaluationJudgment, JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import {
  SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY,
  SECURITY_EVALUATION_ECOSYSTEM_NPM,
} from "../../security-evaluation.constants";
import { mapOsvSeverity } from "../security-evaluation-severity";
import { deriveExposure, deriveUrgency } from "../security-evaluation-urgency";
import { dependencyFingerprint } from "./security-evaluation-dependency.identity";
import { SecurityEvaluationOsvClient, osvPackageKey, type OsvVulnerability } from "./security-evaluation-osv.client";

interface JudgedPackage {
  itemId: string;
  name: string;
  version: string;
  isDev: boolean;
}

const MAX_TITLE_LENGTH = 500;
const MAX_DETAIL_LENGTH = 4000;
const MAX_ALIASES = 10;

/**
 * DEPENDENCY judgment — installed npm packages against OSV (ADR-022 D3).
 *
 * Deterministic by construction: no model, no prompt, no scoring. The only
 * external dependency is the OSV database, and every package the batch query
 * could not reach is reported as skipped rather than assumed clean.
 */
@Injectable()
export class SecurityEvaluationDependencyJudgment {
  constructor(private readonly osv: SecurityEvaluationOsvClient) {}

  async judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    const packages = this.readPackages(input.evidence);
    if (packages.length === 0) {
      throw new BadRequestException("Dependency judgment received no package evidence items.");
    }

    const outcome = await this.osv.queryPackages(
      packages.map((pkg) => ({ name: pkg.name, version: pkg.version, dev: pkg.isDev })),
    );
    const failedKeys = new Set(outcome.failedPackageKeys);
    const evaluated = packages.filter((pkg) => !failedKeys.has(osvPackageKey(pkg.name, pkg.version)));
    if (evaluated.length === 0) {
      throw new BadRequestException(
        `Every OSV batch query failed${outcome.failureNote ? ` (${outcome.failureNote})` : ""}; nothing was judged.`,
      );
    }

    const vulnerabilityIds = [
      ...new Set(
        evaluated.flatMap((pkg) =>
          (outcome.vulnerabilitiesByPackageKey.get(osvPackageKey(pkg.name, pkg.version)) ?? []).map(
            (reference) => reference.id,
          ),
        ),
      ),
    ];
    const details = await this.osv.fetchDetails(vulnerabilityIds);

    const findings = new Map<string, EvaluationFindingCandidate>();
    for (const pkg of evaluated) {
      const references = outcome.vulnerabilitiesByPackageKey.get(osvPackageKey(pkg.name, pkg.version)) ?? [];
      for (const reference of references) {
        const detail = details.get(reference.id) ?? null;
        const candidate = this.buildFinding(pkg, reference.id, detail);
        findings.set(candidate.fingerprint, candidate);
      }
    }

    const skippedIds = packages
      .filter((pkg) => failedKeys.has(osvPackageKey(pkg.name, pkg.version)))
      .map((pkg) => pkg.itemId);
    const skipped =
      skippedIds.length > 0
        ? {
            total: skippedIds.length,
            items: skippedIds,
            note: `OSV batch query failed for these packages: ${outcome.failureNote ?? "unknown transport error"}.`,
          }
        : undefined;

    const vulnerablePackages = new Set([...findings.values()].map((finding) => finding.metadata?.packageName));
    const detailFailures = vulnerabilityIds.filter((id) => details.get(id) === null).length;

    return {
      verdicts: [],
      findings: [...findings.values()],
      evaluatedRefs: evaluated.map((pkg) => pkg.itemId),
      skipped,
      summary: `Judged ${evaluated.length} ${SECURITY_EVALUATION_ECOSYSTEM_NPM} packages against OSV: ${vulnerablePackages.size} vulnerable packages, ${findings.size} findings${
        skippedIds.length > 0 ? `, ${skippedIds.length} skipped after query failures` : ""
      }.`,
      metadata: {
        osvQueriedAt: new Date().toISOString(),
        ecosystem: SECURITY_EVALUATION_ECOSYSTEM_NPM,
        packagesQueried: evaluated.length,
        packagesSkipped: skippedIds.length,
        vulnerabilityLookupFailures: detailFailures,
      },
    };
  }

  private readPackages(evidence: readonly EvaluationEvidenceItem[]): JudgedPackage[] {
    const packages: JudgedPackage[] = [];
    for (const item of evidence) {
      if (item.layer !== "knowledge" || item.source !== "lockfile") continue;
      const payload = item.payload ?? {};
      const name = typeof payload.name === "string" ? payload.name : null;
      const version = typeof payload.version === "string" ? payload.version : null;
      if (!name || !version) continue;
      packages.push({ itemId: item.id, name, version, isDev: payload.isDev === true });
    }
    return packages;
  }

  private buildFinding(
    pkg: JudgedPackage,
    vulnerabilityId: string,
    detail: OsvVulnerability | null,
  ): EvaluationFindingCandidate {
    const severityMapping = mapOsvSeverity(detail?.database_specific?.severity);
    const urgency = deriveUrgency(severityMapping.severity, deriveExposure(pkg.isDev));
    const aliases = Array.isArray(detail?.aliases)
      ? detail.aliases.filter((alias): alias is string => typeof alias === "string").slice(0, MAX_ALIASES)
      : [];
    const fixedVersion = extractFixedVersion(detail, pkg.name);
    const summary =
      typeof detail?.summary === "string" && detail.summary
        ? detail.summary.slice(0, MAX_TITLE_LENGTH)
        : `Vulnerability ${vulnerabilityId}`;

    return {
      criterionKey: SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY,
      fingerprint: dependencyFingerprint(pkg.name, vulnerabilityId),
      severity: severityMapping.severity,
      title: `${pkg.name}: ${summary}`.slice(0, MAX_TITLE_LENGTH),
      detail: typeof detail?.details === "string" ? detail.details.slice(0, MAX_DETAIL_LENGTH) : undefined,
      evidenceRefs: [pkg.itemId],
      metadata: {
        packageName: pkg.name,
        packageVersion: pkg.version,
        ecosystem: SECURITY_EVALUATION_ECOSYSTEM_NPM,
        vulnerabilityId,
        isDev: pkg.isDev,
        aliases,
        fixedVersion,
        urgency,
        severitySource: severityMapping.source,
        detailAvailable: detail !== null,
      },
    };
  }
}

/** First fixed version this record lists for the affected package, if any. */
function extractFixedVersion(detail: OsvVulnerability | null, packageName: string): string | null {
  if (!Array.isArray(detail?.affected)) return null;
  for (const entry of detail.affected) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { package?: { name?: unknown }; ranges?: unknown };
    const affectedName = record.package?.name;
    if (typeof affectedName === "string" && affectedName !== packageName) continue;
    if (!Array.isArray(record.ranges)) continue;
    for (const range of record.ranges) {
      if (!range || typeof range !== "object") continue;
      const events = (range as { events?: unknown }).events;
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        if (!event || typeof event !== "object") continue;
        const fixed = (event as { fixed?: unknown }).fixed;
        if (typeof fixed === "string" && fixed) return fixed;
      }
    }
  }
  return null;
}
