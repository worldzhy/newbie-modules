import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import type { EvidenceCollection, EvidenceProvider } from "@modules/evaluation/ports/evidence.provider";
import type {
  EvaluationCriteriaVersionRef,
  EvaluationEvidenceItem,
  EvaluationSubjectRef,
} from "@modules/evaluation/ports/evaluation.contracts";

import { SecurityEvaluationAssetService } from "../assets/security-evaluation-asset.service";
import {
  SECURITY_EVALUATION_ECOSYSTEM_NPM,
  SECURITY_EVALUATION_FACT_TYPE_PACKAGE,
  SECURITY_EVALUATION_FAMILY_INTELLIGENCE,
  SECURITY_EVALUATION_LOCKFILE_CANDIDATES,
} from "../security-evaluation.constants";
import {
  dependencyEvidenceId,
  dependencyFactKey,
} from "../judgment/dependency/security-evaluation-dependency.identity";
import {
  parseDeclaredDependencies,
  parsePackageLock,
  type LockedPackage,
} from "../judgment/dependency/security-evaluation-lockfile";
import { RepositoryAccess, securityEvaluationRepositoryAccessToken } from "../ports/repository-access.port";

interface ResolvedLockfile {
  path: string;
  content: string;
}

/**
 * SecurityEvaluationEvidenceProvider — evidence collection for subject kind
 * "repository" (ADR-022 D3, DEPENDENCY).
 *
 * The lockfile is the fact layer: every installed package becomes one fact and
 * one manifest item. A repository that cannot be read is a failed run, not a
 * clean one — an empty evaluated set would otherwise claim "nothing found" for
 * material nobody looked at.
 */
@Injectable()
export class SecurityEvaluationEvidenceProvider implements EvidenceProvider {
  constructor(
    private readonly assets: SecurityEvaluationAssetService,
    @Optional()
    @Inject(securityEvaluationRepositoryAccessToken)
    private readonly repositoryAccess?: RepositoryAccess,
  ) {}

  async collect(
    subject: EvaluationSubjectRef,
    criteriaVersion: EvaluationCriteriaVersionRef,
  ): Promise<EvidenceCollection> {
    // INTEL judgment does not consume lockfile evidence; it matches knowledge
    // items against the subject's scope entity set directly (ADR-039).
    if (criteriaVersion.evaluationKey === SECURITY_EVALUATION_FAMILY_INTELLIGENCE) {
      return { items: [], declaredUnlinked: { total: 0 }, skipped: { total: 0 } };
    }

    const asset = await this.assets.ensureAsset(subject);
    const observedAt = new Date();
    const lockfile = await this.resolveLockfile(subject);
    const packages = this.readPackages(lockfile);
    const items = this.buildItems(packages, observedAt);

    await this.assets.upsertFacts(
      asset.id,
      packages.map((pkg) => ({
        factType: SECURITY_EVALUATION_FACT_TYPE_PACKAGE,
        factKey: dependencyFactKey(pkg.name, pkg.version),
        value: { version: pkg.version, isDev: pkg.dev, ecosystem: SECURITY_EVALUATION_ECOSYSTEM_NPM },
      })),
      observedAt,
    );
    await this.assets.touchObserved(asset.id, observedAt);

    return {
      items,
      declaredUnlinked: await this.computeDeclaredUnlinked(subject, lockfile, packages),
      skipped: { total: 0 },
    };
  }

  private async resolveLockfile(subject: EvaluationSubjectRef): Promise<ResolvedLockfile> {
    const access = this.repositoryAccess;
    if (!access) {
      throw new Error(
        "No RepositoryAccess is bound to SECURITY_EVALUATION_REPOSITORY_ACCESS; the host must bind the port before running repository evaluations.",
      );
    }
    for (const candidate of SECURITY_EVALUATION_LOCKFILE_CANDIDATES) {
      const content = await access.getFile(subject, candidate);
      if (content) return { path: candidate, content };
    }
    throw new BadRequestException(
      `No supported lockfile (${SECURITY_EVALUATION_LOCKFILE_CANDIDATES.join(", ")}) found at the repository root of ${subject.displayName}.`,
    );
  }

  private readPackages(lockfile: ResolvedLockfile): LockedPackage[] {
    let packages: LockedPackage[];
    try {
      packages = parsePackageLock(lockfile.content);
    } catch (error) {
      throw new BadRequestException(
        `${lockfile.path} could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (packages.length === 0) {
      throw new BadRequestException(
        `${lockfile.path} resolved no packages; a run over nothing would report a vacuous clean result.`,
      );
    }
    return packages;
  }

  private buildItems(packages: readonly LockedPackage[], observedAt: Date): EvaluationEvidenceItem[] {
    return packages.map((pkg) => ({
      id: dependencyEvidenceId(pkg.name, pkg.version),
      layer: "fact",
      source: "lockfile",
      summary: `${pkg.name}@${pkg.version}`,
      observedAt,
      payload: {
        name: pkg.name,
        version: pkg.version,
        ecosystem: SECURITY_EVALUATION_ECOSYSTEM_NPM,
        isDev: pkg.dev,
      },
    }));
  }

  /**
   * Direct dependencies declared in package.json but absent from the lockfile.
   * This is the "declared but unlinkable" gap of ADR-020 D5.2 — a declared
   * dependency without an installed fact was not judged, and saying so beats
   * counting it as clean.
   */
  private async computeDeclaredUnlinked(
    subject: EvaluationSubjectRef,
    lockfile: ResolvedLockfile,
    packages: readonly LockedPackage[],
  ): Promise<EvidenceCollection["declaredUnlinked"]> {
    const access = this.repositoryAccess;
    if (!access) return { total: 0 };
    const manifestContent = await access.getFile(subject, "package.json");
    if (!manifestContent) return { total: 0 };

    let declared: string[];
    try {
      declared = parseDeclaredDependencies(manifestContent);
    } catch {
      return { total: 0 };
    }
    const resolved = new Set(packages.map((pkg) => pkg.name));
    const unlinked = declared.filter((name) => !resolved.has(name));
    if (unlinked.length === 0) return { total: 0 };
    return {
      total: unlinked.length,
      items: unlinked,
      note: `Declared dependencies without a resolved package in ${lockfile.path}: ${unlinked.join(", ")}.`,
    };
  }
}
