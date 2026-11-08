import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Octokit } from "@octokit/rest";
import { HubModuleRelease, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { decodeBase64Utf8, octokitStatus } from "@devbie/newbie/utilities/octokit.util";
import { AuditActorType, AuditLogService } from "@modules/audit/audit-log.service";

/** Registry module directory prefix inside the registry monorepo. */
const REGISTRY_MODULES_PREFIX = "packages/modules/";
const MODULE_MANIFEST_FILE = "newbie.module.json";

/** Audit event emitted when a registry release is ingested. */
const RELEASE_INGEST_EVENT = "release.ingest";
/** Resource type for release-ingest audit rows. */
const RELEASE_RESOURCE_TYPE = "module-hub-release";

interface ManifestShape {
  key?: string;
  module?: { file?: string; className?: string };
  schema?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [k: string]: unknown;
}

/** Subset of the GitHub push webhook payload consumed by this service. */
interface GithubPushPayload {
  after?: string;
  head_commit?: { timestamp?: string };
  commits?: { added?: string[]; modified?: string[] }[];
}

/** Who/what triggered an ingestion, recorded on the release.ingest audit row. */
interface IngestTrigger {
  actorType: string;
  actorId: string;
}

/** Default trigger for the webhook ingestion path. */
const WEBHOOK_TRIGGER: IngestTrigger = { actorType: AuditActorType.SYSTEM, actorId: "webhook" };

/** The subset of a release row the "latest per module" selection needs. */
export interface ReleaseOrderingRow {
  moduleKey: string;
  sourceCommit: string;
  committedAt: Date | null;
  publishedAt: Date;
}

/**
 * Pick one release per module: the newest commit wins, `publishedAt` breaks
 * ties between undated rows, and `sourceCommit` keeps the result deterministic
 * when both timestamps match.
 */
export function pickLatestReleases<T extends ReleaseOrderingRow>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const current = byKey.get(row.moduleKey);
    if (!current || isNewerRelease(row, current)) byKey.set(row.moduleKey, row);
  }
  return [...byKey.values()].sort((a, b) => a.moduleKey.localeCompare(b.moduleKey));
}

function isNewerRelease(candidate: ReleaseOrderingRow, current: ReleaseOrderingRow): boolean {
  if (candidate.committedAt && current.committedAt) {
    const delta = candidate.committedAt.getTime() - current.committedAt.getTime();
    if (delta !== 0) return delta > 0;
    return candidate.sourceCommit > current.sourceCommit;
  }
  // A dated row always beats a legacy row without a commit date.
  if (candidate.committedAt) return true;
  if (current.committedAt) return false;
  const delta = candidate.publishedAt.getTime() - current.publishedAt.getTime();
  if (delta !== 0) return delta > 0;
  return candidate.sourceCommit > current.sourceCommit;
}

/**
 * Registry catalog management: ingestion from the GitHub push webhook plus an
 * operator-triggered sync (local development / missed deliveries). The Prisma
 * `@@unique([moduleKey, sourceCommit])` makes both paths mutually idempotent.
 */
@Injectable()
export class ModuleHubReleaseService {
  private readonly logger = new Logger(ModuleHubReleaseService.name);
  private readonly octokit: Octokit;
  /** Commit sha -> commit date; null means "looked up and unavailable". */
  private readonly commitDates = new Map<string, Date | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {
    // The registry repository is public; a token only raises the GitHub rate
    // limit (or unlocks a private registry mirror). Fall back to the host's
    // existing GitHub credential so consumers do not configure the same PAT
    // twice; an unauthenticated client still works for a public registry.
    const auth = this.config.get<string>("MODULE_HUB_REGISTRY_REPO_TOKEN") || this.config.get<string>("GITHUB_AUTH");
    this.octokit = new Octokit({
      auth,
      userAgent: "newbie-module-hub",
    });
  }

  private get registryRepo(): { owner: string; repo: string } {
    const fullName = this.config.get<string>("MODULE_HUB_REGISTRY_REPO") ?? "worldzhy/newbie-modules";
    const [owner, repo] = fullName.split("/");
    return { owner, repo };
  }

  /** Upsert one (moduleKey, sourceCommit) pair. */
  async ingestRelease(
    moduleKey: string,
    sourceCommit: string,
    manifest: ManifestShape,
    trigger: IngestTrigger = WEBHOOK_TRIGGER,
    committedAt?: Date | null,
  ): Promise<HubModuleRelease> {
    const row = await this.prisma.hubModuleRelease.upsert({
      where: { moduleKey_sourceCommit: { moduleKey, sourceCommit } },
      // Backfill the commit date on rows ingested before it was recorded.
      update: committedAt ? { committedAt } : {},
      create: {
        moduleKey,
        sourceCommit,
        manifest: manifest as Prisma.InputJsonValue,
        committedAt: committedAt ?? null,
      },
    });
    await this.auditLogService.record(RELEASE_INGEST_EVENT, {
      resourceType: RELEASE_RESOURCE_TYPE,
      resourceId: moduleKey,
      actorType: trigger.actorType,
      actorId: trigger.actorId,
      detail: { moduleKey, sourceCommit },
    });
    return row;
  }

  /**
   * Latest release per module key, chosen by commit date.
   *
   * The selection happens in memory on purpose: `distinct` + `publishedAt`
   * ordering would let a late-arriving older webhook delivery (retry, manual
   * replay) shadow a newer release and silently suppress upgrade hints
   * (R23-04). `publishedAt` stays the fallback for rows ingested before
   * `committedAt` existed.
   */
  async getCatalog(): Promise<HubModuleRelease[]> {
    const rows = await this.prisma.hubModuleRelease.findMany({ orderBy: { moduleKey: "asc" } });
    return pickLatestReleases(rows);
  }

  /** Full release history of one module. */
  async getReleasesForModule(moduleKey: string): Promise<HubModuleRelease[]> {
    return this.prisma.hubModuleRelease.findMany({
      where: { moduleKey },
      orderBy: { publishedAt: "desc" },
    });
  }

  /** Most recently ingested registry commit, surfaced in agent poll responses. */
  async getLatestRegistrySourceCommit(): Promise<string | null> {
    const row = await this.prisma.hubModuleRelease.findFirst({
      orderBy: { publishedAt: "desc" },
      select: { sourceCommit: true },
    });
    return row?.sourceCommit ?? null;
  }

  /**
   * GitHub push event: collect the modules touched under packages/modules/ at
   * the head commit and ingest each one's manifest at that commit.
   */
  async handleGithubPush(payload: GithubPushPayload): Promise<{ ingested: string[] }> {
    const headCommit = payload?.after;
    if (!headCommit || !Array.isArray(payload?.commits)) return { ingested: [] };

    const keys = new Set<string>();
    for (const commit of payload.commits) {
      for (const file of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
        const match = /^packages\/modules\/([^/]+)\//.exec(file);
        if (match) keys.add(match[1]);
      }
    }

    const ingested: string[] = [];
    const headCommittedAt = payload.head_commit?.timestamp ? new Date(payload.head_commit.timestamp) : null;
    for (const key of keys) {
      const manifest = await this.fetchManifestAtCommit(key, headCommit);
      if (!manifest) continue; // module directory removed at this commit
      await this.ingestRelease(key, headCommit, manifest, WEBHOOK_TRIGGER, headCommittedAt);
      ingested.push(key);
    }
    return { ingested };
  }

  /**
   * Operator-triggered sync: ingest the latest release of every registry
   * module. "Latest" is the last commit that touched the module directory
   * (not the branch HEAD) so the catalog stays a per-module release history:
   * a module is only recorded again when its own files change.
   *
   * A cold catalog costs two GitHub calls per module, so a single transient
   * failure — or the anonymous rate limit — must not abort the whole run: each
   * module is isolated, failures are reported back, and the idempotent upsert
   * makes the next run fill the gaps (R23-02).
   */
  async syncCatalogFromRegistry(
    trigger: IngestTrigger,
  ): Promise<{ headCommit: string; ingested: string[]; failed: string[] }> {
    const { owner, repo } = this.registryRepo;
    const { data: commits } = await this.octokit.repos.listCommits({ owner, repo, per_page: 1 });
    const headCommit = commits[0]?.sha;
    if (!headCommit) {
      throw new Error(`registry catalog sync: no commits found for ${owner}/${repo}`);
    }
    const { data: tree } = await this.octokit.git.getTree({
      owner,
      repo,
      tree_sha: headCommit,
      recursive: "true",
    });
    if (tree.truncated) {
      this.logger.warn(`registry tree ${owner}/${repo}@${headCommit} is truncated; some modules may be missed`);
    }

    const keys = new Set<string>();
    for (const node of tree.tree) {
      const match = node.path ? /^packages\/modules\/([^/]+)\/newbie\.module\.json$/.exec(node.path) : null;
      if (match) keys.add(match[1]);
    }

    const ingested: string[] = [];
    const failed: string[] = [];
    for (const key of keys) {
      try {
        const last = await this.getLastCommitForModule(key);
        if (!last) continue;
        const existing = await this.prisma.hubModuleRelease.findUnique({
          where: { moduleKey_sourceCommit: { moduleKey: key, sourceCommit: last.sha } },
          select: { id: true, committedAt: true },
        });
        if (existing?.committedAt) continue;
        const manifest = await this.fetchManifestAtCommit(key, last.sha);
        if (!manifest) continue;
        await this.ingestRelease(key, last.sha, manifest, trigger, last.committedAt);
        ingested.push(key);
      } catch (error: unknown) {
        failed.push(key);
        this.logger.warn(`registry catalog sync failed for ${key}: ${(error as Error).message}`);
      }
    }
    return { headCommit, ingested, failed };
  }

  /** Last commit touching one module directory, with its commit date. */
  private async getLastCommitForModule(moduleKey: string): Promise<{ sha: string; committedAt: Date } | null> {
    const { owner, repo } = this.registryRepo;
    const { data } = await this.octokit.repos.listCommits({
      owner,
      repo,
      path: `${REGISTRY_MODULES_PREFIX}${moduleKey}`,
      per_page: 1,
    });
    const commit = data[0];
    const sha = commit?.sha;
    if (!sha) return null;
    // The list response always carries the commit metadata; fall back to a
    // dedicated lookup only for malformed payloads.
    const rawDate = commit?.commit?.committer?.date ?? commit?.commit?.author?.date;
    const committedAt = rawDate ? new Date(rawDate) : await this.resolveCommitDate(sha);
    return committedAt ? { sha, committedAt } : null;
  }

  /**
   * Commit date for an arbitrary registry commit (per-process cache). Used to
   * stamp the pin dates carried by an installation's report; a missing date
   * simply disables the upgrade check for that module.
   */
  async resolveCommitDate(sha: string): Promise<Date | null> {
    const cached = this.commitDates.get(sha);
    if (cached !== undefined) return cached;
    const { owner, repo } = this.registryRepo;
    let resolved: Date | null = null;
    try {
      const { data } = await this.octokit.repos.getCommit({ owner, repo, ref: sha });
      const rawDate = data.commit.committer?.date ?? data.commit.author?.date;
      resolved = rawDate ? new Date(rawDate) : null;
    } catch (error: unknown) {
      const status = octokitStatus(error);
      if (status !== 404 && status !== 422) {
        this.logger.warn(`registry commit ${sha} lookup failed: ${(error as Error).message}`);
      }
    }
    this.commitDates.set(sha, resolved);
    return resolved;
  }

  private async fetchManifestAtCommit(moduleKey: string, commit: string): Promise<ManifestShape | null> {
    const { owner, repo } = this.registryRepo;
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: `${REGISTRY_MODULES_PREFIX}${moduleKey}/${MODULE_MANIFEST_FILE}`,
        ref: commit,
      });
      // The contents API returns an array for directories; we only read files.
      if (Array.isArray(data) || data.type !== "file") return null;
      return JSON.parse(decodeBase64Utf8(data.content)) as ManifestShape;
    } catch (error: unknown) {
      if (octokitStatus(error) === 404) return null;
      throw error;
    }
  }
}
