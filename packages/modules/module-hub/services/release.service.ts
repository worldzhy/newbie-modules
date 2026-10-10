import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";

/** Fallback registry sync cadence (design: every 10 minutes). */
const FALLBACK_SYNC_INTERVAL_MS = 10 * 60 * 1000;
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

/**
 * Registry catalog management: ingestion from the GitHub push webhook plus a
 * periodic fallback sync (local development / missed deliveries). The Prisma
 * `@@unique([moduleKey, sourceCommit])` makes both paths mutually idempotent.
 */
@Injectable()
export class ModuleHubReleaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModuleHubReleaseService.name);
  private fallbackTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {}

  onModuleInit(): void {
    // Periodic fallback so that a missing/misfired webhook never stalls the
    // catalog. Failures are logged, never thrown into the host process.
    this.fallbackTimer = setInterval(() => {
      void this.fallbackSync().catch((error: unknown) => {
        this.logger.warn(`registry fallback sync failed: ${(error as Error).message}`);
      });
    }, FALLBACK_SYNC_INTERVAL_MS);
    this.fallbackTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
  }

  private get registryRepo(): string {
    return this.config.get<string>("MODULE_HUB_REGISTRY_REPO") ?? "worldzhy/newbie-modules";
  }

  private githubHeaders(): Record<string, string> {
    const token = this.config.get<string>("MODULE_HUB_REGISTRY_REPO_TOKEN");
    return {
      accept: "application/vnd.github+json",
      "user-agent": "newbie-module-hub",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  /** Upsert one (moduleKey, sourceCommit) pair. */
  async ingestRelease(moduleKey: string, sourceCommit: string, manifest: ManifestShape, actor = "webhook") {
    const row = await this.prisma.hubModuleRelease.upsert({
      where: { moduleKey_sourceCommit: { moduleKey, sourceCommit } },
      update: {},
      create: { moduleKey, sourceCommit, manifest: manifest as any },
    });
    await this.auditLogService.record(RELEASE_INGEST_EVENT, {
      resourceType: RELEASE_RESOURCE_TYPE,
      resourceId: moduleKey,
      actorType: "system",
      actorId: actor,
      detail: { moduleKey, sourceCommit },
    });
    return row;
  }

  /** Latest release per module key. */
  async getCatalog() {
    return this.prisma.$queryRaw`
      SELECT DISTINCT ON ("moduleKey") *
      FROM "module/module-hub"."HubModuleRelease"
      ORDER BY "moduleKey", "publishedAt" DESC
    `;
  }

  /** Full release history of one module. */
  async getReleasesForModule(moduleKey: string) {
    return this.prisma.hubModuleRelease.findMany({
      where: { moduleKey },
      orderBy: { publishedAt: "desc" },
    });
  }

  /** Most recently ingested registry commit, surfaced in agent poll responses. */
  async getLatestRegistrySourceCommit(): Promise<string | null> {
    const rows = (await this.prisma.$queryRaw`
      SELECT "sourceCommit"
      FROM "module/module-hub"."HubModuleRelease"
      ORDER BY "publishedAt" DESC
      LIMIT 1
    `) as Array<{ sourceCommit: string }>;
    return rows[0]?.sourceCommit ?? null;
  }

  /**
   * GitHub push event: collect the modules touched under packages/modules/ at
   * the head commit and ingest each one's manifest at that commit.
   */
  async handleGithubPush(payload: any): Promise<{ ingested: string[] }> {
    const headCommit: string | undefined = payload?.after;
    if (!headCommit || !Array.isArray(payload?.commits)) return { ingested: [] };

    const keys = new Set<string>();
    for (const commit of payload.commits) {
      for (const file of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
        const match = /^packages\/modules\/([^/]+)\//.exec(file as string);
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
   * Fallback path: diff the registry HEAD tree against the catalog and ingest
   * any (module, headCommit) pairs we have not seen yet.
   */
  async fallbackSync(): Promise<void> {
    const repo = this.registryRepo;
    const heads = await this.githubJson<Array<{ sha: string }>>(`/repos/${repo}/commits?per_page=1`);
    const headSha = heads[0]?.sha;
    if (!headSha) {
      this.logger.warn(`registry fallback sync: no commits found for ${repo}`);
      return;
    }
    const tree = await this.githubJson<{ tree: Array<{ path: string }> }>(
      `/repos/${repo}/git/trees/${headSha}?recursive=1`,
    );

    const keys = new Set<string>();
    for (const node of tree.tree) {
      const match = /^packages\/modules\/([^/]+)\/newbie\.module\.json$/.exec(node.path);
      if (match) keys.add(match[1]);
    }

    for (const key of keys) {
      const existing = await this.prisma.hubModuleRelease.findUnique({
        where: { moduleKey_sourceCommit: { moduleKey: key, sourceCommit: headSha } },
        select: { id: true },
      });
      if (existing) continue;
      const manifest = await this.fetchManifestAtCommit(key, headSha);
      if (!manifest) continue;
      await this.ingestRelease(key, headSha, manifest, "fallback-sync");
    }
  }

  private async fetchManifestAtCommit(moduleKey: string, commit: string): Promise<ManifestShape | null> {
    const response = await fetch(
      `https://api.github.com/repos/${this.registryRepo}/contents/` +
        `${REGISTRY_MODULES_PREFIX}${moduleKey}/${MODULE_MANIFEST_FILE}?ref=${commit}`,
      { headers: { ...this.githubHeaders(), accept: "application/vnd.github.raw+json" } },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`GitHub contents API failed for ${moduleKey}@${commit}: HTTP ${response.status}`);
    }
    return (await response.json()) as ManifestShape;
  }

  private async githubJson<T>(path: string): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, { headers: this.githubHeaders() });
    if (!response.ok) {
      throw new Error(`GitHub API ${path} failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
