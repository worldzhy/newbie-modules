import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Octokit } from "@octokit/rest";
import { HubModuleRelease, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
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
  commits?: { added?: string[]; modified?: string[] }[];
}

/** Who/what triggered an ingestion, recorded on the release.ingest audit row. */
interface IngestTrigger {
  actorType: string;
  actorId: string;
}

/** Default trigger for the webhook ingestion path. */
const WEBHOOK_TRIGGER: IngestTrigger = { actorType: AuditActorType.SYSTEM, actorId: "webhook" };

// Octokit request errors carry a numeric `status`.
function octokitStatus(error: unknown): number | undefined {
  return (error as { status?: number }).status;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {
    // The registry repository is public; the optional token only raises the
    // GitHub rate limit (or unlocks a private registry mirror).
    this.octokit = new Octokit({
      auth: this.config.get<string>("MODULE_HUB_REGISTRY_REPO_TOKEN"),
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
  ): Promise<HubModuleRelease> {
    const row = await this.prisma.hubModuleRelease.upsert({
      where: { moduleKey_sourceCommit: { moduleKey, sourceCommit } },
      update: {},
      create: { moduleKey, sourceCommit, manifest: manifest as Prisma.InputJsonValue },
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

  /** Latest release per module key. */
  async getCatalog(): Promise<HubModuleRelease[]> {
    return this.prisma.hubModuleRelease.findMany({
      distinct: ["moduleKey"],
      orderBy: [{ moduleKey: "asc" }, { publishedAt: "desc" }],
    });
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
    for (const key of keys) {
      const manifest = await this.fetchManifestAtCommit(key, headCommit);
      if (!manifest) continue; // module directory removed at this commit
      await this.ingestRelease(key, headCommit, manifest);
      ingested.push(key);
    }
    return { ingested };
  }

  /**
   * Operator-triggered sync: diff the registry HEAD tree against the catalog
   * and ingest any (module, headCommit) pairs not seen yet. Repairs a missed
   * webhook delivery through the same idempotent upsert.
   */
  async syncCatalogFromRegistry(trigger: IngestTrigger): Promise<{ headCommit: string; ingested: string[] }> {
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
    for (const key of keys) {
      const existing = await this.prisma.hubModuleRelease.findUnique({
        where: { moduleKey_sourceCommit: { moduleKey: key, sourceCommit: headCommit } },
        select: { id: true },
      });
      if (existing) continue;
      const manifest = await this.fetchManifestAtCommit(key, headCommit);
      if (!manifest) continue;
      await this.ingestRelease(key, headCommit, manifest, trigger);
      ingested.push(key);
    }
    return { headCommit, ingested };
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
      return JSON.parse(Buffer.from(data.content, "base64").toString("utf-8")) as ManifestShape;
    } catch (error: unknown) {
      if (octokitStatus(error) === 404) return null;
      throw error;
    }
  }
}
