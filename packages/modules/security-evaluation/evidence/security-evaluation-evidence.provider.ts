import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { EvidenceCollection, EvidenceProvider } from "@modules/evaluation/ports/evidence.provider";
import type {
  EvaluationCoverageBucket,
  EvaluationRuleSetVersionRef,
  EvaluationEvidenceItem,
  EvaluationSubjectRef,
} from "@modules/evaluation/ports/evaluation.contracts";

import { SecurityEvaluationAssetService } from "../assets/security-evaluation-asset.service";
import {
  SECURITY_EVALUATION_ECOSYSTEM_NPM,
  SECURITY_EVALUATION_INTEL_EVIDENCE_BUDGET,
  SECURITY_EVALUATION_INTEL_EVIDENCE_WINDOW_DAYS,
  SECURITY_EVALUATION_KNOWLEDGE_TYPE_PACKAGE,
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
  SECURITY_EVALUATION_LOCKFILE_CANDIDATES,
} from "../security-evaluation.constants";
import {
  dependencyEvidenceId,
  dependencyKnowledgeKey,
} from "../judgment/dependency/security-evaluation-dependency.identity";
import {
  parseDeclaredDependencies,
  parsePackageLock,
  type LockedPackage,
} from "../judgment/dependency/security-evaluation-lockfile";
import {
  SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER,
  SecurityEvaluationScopeEntitiesProvider,
} from "../judgment/intel/security-evaluation-scope-entities.port";
import {
  securityEvaluationIntelNegativeCacheToken,
  SecurityEvaluationIntelNegativeCachePort,
} from "../judgment/intel/security-evaluation-intel-negative-cache.port";
import { RepositoryAccess, securityEvaluationRepositoryAccessToken } from "../ports/repository-access.port";

interface ResolvedLockfile {
  path: string;
  content: string;
}

/**
 * SecurityEvaluationEvidenceProvider — evidence collection for subject kind
 * "repository" (ADR-022 D3, DEPENDENCY) and the run-scoped registration of
 * INTEL material (ADR-037 D9.4).
 *
 * For DEPENDENCY the lockfile is the knowledge layer: every installed package
 * becomes one knowledge item and one manifest item. A repository that cannot be
 * read is a failed run, not a clean one — an empty evaluated set would
 * otherwise claim "nothing found" for material nobody looked at.
 *
 * For INTEL the provider reads the world-scoped threat-knowledge store and
 * registers what the run considered: the subject's scope entities as declared
 * items and the recent knowledge candidates as knowledge items. The negative
 * cache is consulted through its port (ADR-045); candidates it filters out,
 * and candidates cut by the evidence budget, are accounted in the skipped
 * bucket rather than silently dropped.
 */
@Injectable()
export class SecurityEvaluationEvidenceProvider implements EvidenceProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: SecurityEvaluationAssetService,
    @Inject(securityEvaluationIntelNegativeCacheToken)
    private readonly negativeCache: SecurityEvaluationIntelNegativeCachePort,
    @Optional()
    @Inject(securityEvaluationRepositoryAccessToken)
    private readonly repositoryAccess?: RepositoryAccess,
    @Optional()
    @Inject(SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER)
    private readonly scopeEntitiesProvider?: SecurityEvaluationScopeEntitiesProvider,
  ) {}

  async collect(
    subject: EvaluationSubjectRef,
    ruleSetVersion: EvaluationRuleSetVersionRef,
  ): Promise<EvidenceCollection> {
    if (ruleSetVersion.evaluationKey === SECURITY_EVALUATION_KEY_THREAT_INTEL) {
      return this.collectIntel(subject);
    }

    const asset = await this.assets.ensureAsset(subject);
    const observedAt = new Date();
    const lockfile = await this.resolveLockfile(subject);
    const packages = this.readPackages(lockfile);
    const items = this.buildItems(packages, observedAt);

    await this.assets.upsertNpmPackageKnowledgeItems(
      asset.id,
      packages.map((pkg) => ({
        type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_PACKAGE,
        key: dependencyKnowledgeKey(pkg.name, pkg.version),
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

  private emptyCollection(): EvidenceCollection {
    return { items: [], declaredUnlinked: { total: 0 }, skipped: { total: 0 } };
  }

  /**
   * INTEL evidence: the scope entity set plus the threat-knowledge candidates
   * in the match window, both registered as manifest items so the judgment has
   * no reason to read the database itself (ADR-037 D9.4).
   */
  private async collectIntel(subject: EvaluationSubjectRef): Promise<EvidenceCollection> {
    const scopeEntitiesProvider = this.scopeEntitiesProvider;
    if (!scopeEntitiesProvider) {
      throw new Error(
        "No SecurityEvaluationScopeEntitiesProvider is bound to SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER; the host must bind the port before running threat-intel evaluations.",
      );
    }

    const scopes = await scopeEntitiesProvider.listScopeEntities();
    const scope = scopes.find(
      (candidate) => candidate.scopeType === subject.scopeType && candidate.scopeId === subject.scopeId,
    );
    if (!scope) {
      throw new BadRequestException(
        `No scope "${subject.scopeType}:${subject.scopeId}" is registered with the host; a run over an unknown scope would report a vacuous clean result.`,
      );
    }
    if (scope.entities.length === 0) return this.emptyCollection();

    const observedAt = new Date();
    const scopeKey = `${subject.scopeType}:${subject.scopeId}`;
    const declaredItems = scope.entities.map((entity, index): EvaluationEvidenceItem => ({
      id: `scope-entity:${index}`,
      layer: "declared",
      source: "project-profile",
      summary: entity.value,
      observedAt,
      payload: { scopeType: subject.scopeType, scopeId: subject.scopeId, entity: entity.value },
    }));

    const since = new Date(observedAt.getTime() - SECURITY_EVALUATION_INTEL_EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.securityEvaluationThreatKnowledgeItem.findMany({
      where: { fetchedAt: { gte: since } },
      orderBy: [{ fetchedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        source: true,
        title: true,
        summary: true,
        severity: true,
        signalTags: true,
        fetchedAt: true,
      },
    });

    // The negative cache decides which pairs a previous run already judged
    // not relevant; the port keeps the store's shape out of this layer.
    const uncached = new Set(
      await this.negativeCache.filterUncached(
        scopeKey,
        candidates.map((candidate) => candidate.id),
      ),
    );
    const cachedIds = candidates.filter((candidate) => !uncached.has(candidate.id)).map((candidate) => candidate.id);
    const eligible = candidates.filter((candidate) => uncached.has(candidate.id));

    const budget = SECURITY_EVALUATION_INTEL_EVIDENCE_BUDGET;
    const withinBudget = eligible.slice(0, budget);
    const overBudgetIds = eligible.slice(budget).map((candidate) => candidate.id);

    const knowledgeItems = withinBudget.map((candidate): EvaluationEvidenceItem => ({
      id: `threat-knowledge:${candidate.id}`,
      layer: "knowledge",
      source: candidate.source,
      summary: candidate.title,
      observedAt: candidate.fetchedAt,
      refs: [candidate.id],
      payload: {
        knowledgeItemId: candidate.id,
        summary: candidate.summary,
        severity: candidate.severity,
        signalTags: candidate.signalTags,
      },
    }));

    return {
      items: [...declaredItems, ...knowledgeItems],
      declaredUnlinked: { total: 0 },
      skipped: this.buildIntelSkippedBucket(cachedIds, overBudgetIds, budget),
    };
  }

  /**
   * The negative-cache and budget cut-offs share the contract's single skipped
   * bucket: totals summed, ids listed and one note covering both reasons.
   */
  private buildIntelSkippedBucket(
    cachedIds: string[],
    overBudgetIds: string[],
    budget: number,
  ): EvaluationCoverageBucket {
    const items = [...cachedIds, ...overBudgetIds];
    if (items.length === 0) return { total: 0 };
    const notes: string[] = [];
    if (cachedIds.length > 0) {
      notes.push(`${cachedIds.length} knowledge item(s) are skipped by the ADR-018 negative cache for this scope.`);
    }
    if (overBudgetIds.length > 0) {
      notes.push(
        `${overBudgetIds.length} knowledge item(s) exceed the evidence budget of ${budget} and were not registered.`,
      );
    }
    return { total: items.length, items, note: notes.join(" ") };
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
      layer: "knowledge",
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
   * dependency without an installed knowledge item was not judged, and saying
   * so beats counting it as clean.
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
