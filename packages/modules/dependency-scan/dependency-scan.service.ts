import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { GitHubService } from "@modules/github/github.service";

type Severity = "critical" | "high" | "medium" | "low" | "unknown";

interface LockedPackage {
  name: string;
  version: string;
  dev: boolean;
}

interface DependencyScanFindingInput {
  packageName: string;
  packageVersion: string;
  isDev: boolean;
  vulnId: string;
  aliases: string[];
  severity: Severity;
  title: string;
  detail?: string;
  fixedVersion?: string | null;
}

const OSV_API_BASE = "https://api.osv.dev";
const OSV_ECOSYSTEM = "npm";
// No official cap on queries per batch, but response-side pagination kicks in
// at ~3000 total vulns; 500 queries per request keeps responses well below it.
const QUERY_BATCH_SIZE = 500;
const VULN_DETAIL_CONCURRENCY = 10;
const LOCKFILE_CANDIDATES = ["package-lock.json"];

@Injectable()
export class DependencyScanService {
  private readonly logger = new Logger(DependencyScanService.name);
  private readonly severityRank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };
  private readonly activeScans = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitHubService: GitHubService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async startApplicationScan(applicationId: string) {
    const application = await this.ensureApplicationExists(applicationId);
    if (!application.repositoryUrl) {
      throw new BadRequestException(
        `Application ${application.name} does not have a repository URL configured. Set it up in the application settings first.`,
      );
    }
    if (!this.gitHubService.isConfigured()) {
      throw new BadRequestException("GitHub credentials are not configured on the server.");
    }

    const latestRunningScan = await this.prisma.dependencyScan.findFirst({
      where: { applicationId, status: { in: ["PENDING", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
    });

    if (latestRunningScan && this.activeScans.has(applicationId)) {
      return { accepted: true, scan: this.serializeScan(latestRunningScan) };
    }

    if (latestRunningScan && !this.activeScans.has(applicationId)) {
      await this.prisma.dependencyScan.update({
        where: { id: latestRunningScan.id },
        data: {
          status: "FAILED",
          errorMessage: latestRunningScan.errorMessage || "Scan was interrupted before completion.",
          finishedAt: new Date(),
        },
      });
      await this.pruneFailedScans(applicationId, latestRunningScan.id);
    }

    const scan = await this.prisma.dependencyScan.create({
      data: { applicationId, status: "PENDING", repositoryUrl: application.repositoryUrl },
    });

    this.activeScans.add(applicationId);
    this.runScanInBackground(applicationId, scan.id).catch(() => {});

    return { accepted: true, scan: this.serializeScan(scan) };
  }

  async getProjectReport(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project not found: ${projectId}`);
    }

    const applications = await this.prisma.application.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
    });
    const applicationIds = applications.map((application) => application.id);

    const [scans, openFindings] = await Promise.all([
      this.prisma.dependencyScan.findMany({
        where: { applicationId: { in: applicationIds } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.dependencyScanFinding.findMany({
        where: { projectId, status: "open" },
        orderBy: { lastSeenAt: "desc" },
      }),
    ]);

    const scansByApplication = new Map<string, typeof scans>();
    for (const scan of scans) {
      const list = scansByApplication.get(scan.applicationId) ?? [];
      list.push(scan);
      scansByApplication.set(scan.applicationId, list);
    }

    const findingsByApplication = new Map<string, typeof openFindings>();
    for (const finding of openFindings) {
      const list = findingsByApplication.get(finding.applicationId) ?? [];
      list.push(finding);
      findingsByApplication.set(finding.applicationId, list);
    }

    const applicationOverviews = applications.map((application) => {
      const applicationScans = scansByApplication.get(application.id) ?? [];
      const applicationFindings = (findingsByApplication.get(application.id) ?? []).sort(
        (left, right) => this.severityRank[right.severity as Severity] - this.severityRank[left.severity as Severity],
      );
      const currentScan = applicationScans.find((scan) => scan.status === "PENDING" || scan.status === "RUNNING");
      const latestSuccessfulScan = applicationScans.find((scan) => scan.status === "SUCCESS");
      const latestFailedScan = applicationScans.find((scan) => scan.status === "FAILED");

      return {
        applicationId: application.id,
        applicationName: application.name,
        applicationType: application.type,
        repositoryUrl: application.repositoryUrl,
        hasRepository: Boolean(application.repositoryUrl),
        currentScan: currentScan ? this.serializeScan(currentScan) : null,
        latestSuccessfulScan: latestSuccessfulScan ? this.serializeScan(latestSuccessfulScan) : null,
        latestFailedScan: latestFailedScan ? this.serializeScan(latestFailedScan) : null,
        openSummary: this.summarizeFindings(applicationFindings),
        findings: applicationFindings.map((finding) => this.serializeFinding(finding)),
      };
    });

    const totalOpenSummary = this.summarizeFindings(openFindings);

    return {
      projectId,
      summary: {
        applicationsTotal: applications.length,
        applicationsScanned: applicationOverviews.filter((overview) => overview.latestSuccessfulScan).length,
        ...totalOpenSummary,
      },
      applications: applicationOverviews,
    };
  }

  private summarizeFindings(findings: { severity: string }[]) {
    return {
      total: findings.length,
      critical: findings.filter((finding) => finding.severity === "critical").length,
      high: findings.filter((finding) => finding.severity === "high").length,
      medium: findings.filter((finding) => finding.severity === "medium").length,
      low: findings.filter((finding) => finding.severity === "low").length,
      unknown: findings.filter((finding) => finding.severity === "unknown").length,
    };
  }

  private serializeScan(scan: any) {
    return {
      id: scan.id,
      applicationId: scan.applicationId,
      status: scan.status,
      errorMessage: scan.errorMessage,
      summary: scan.summary,
      packageCount: scan.packageCount,
      repositoryUrl: scan.repositoryUrl,
      lockfilePath: scan.lockfilePath,
      hasReport: Boolean(scan.report),
      createdAt: scan.createdAt,
      updatedAt: scan.updatedAt,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
    };
  }

  private serializeFinding(finding: any) {
    return {
      id: finding.id,
      packageName: finding.packageName,
      packageVersion: finding.packageVersion,
      isDev: finding.isDev,
      vulnId: finding.vulnId,
      aliases: finding.aliases,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      fixedVersion: finding.fixedVersion,
      status: finding.status,
      firstSeenAt: finding.firstSeenAt,
      lastSeenAt: finding.lastSeenAt,
      resolvedAt: finding.resolvedAt,
    };
  }

  private async ensureApplicationExists(applicationId: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new NotFoundException(`Application not found: ${applicationId}`);
    }
    return application;
  }

  private async runScanInBackground(applicationId: string, scanId: string) {
    try {
      await this.prisma.dependencyScan.update({
        where: { id: scanId },
        data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
      });

      const application = await this.ensureApplicationExists(applicationId);
      const result = await this.scanApplicationLockfile(application);

      await this.prisma.dependencyScan.update({
        where: { id: scanId },
        data: {
          status: "SUCCESS",
          summary: result.report.summary as any,
          report: result.report as any,
          lockfilePath: result.lockfilePath,
          packageCount: result.packageCount,
          finishedAt: new Date(),
          errorMessage: null,
        },
      });

      await this.upsertFindings(application, scanId, result.findings);
      this.eventEmitter.emit("dependency-scan.scan-completed", {
        applicationId,
        projectId: application.projectId,
        scanId,
      });
      this.logger.log(
        `Dependency scan ${scanId} finished for application ${application.name}: ${result.findings.length} findings across ${result.packageCount} packages`,
      );
    } catch (error: any) {
      const errorMessage = this.getErrorMessage(error);
      await this.prisma.dependencyScan.update({
        where: { id: scanId },
        data: { status: "FAILED", errorMessage, finishedAt: new Date() },
      });
      await this.pruneFailedScans(applicationId, scanId);
      const application = await this.prisma.application.findUnique({
        where: { id: applicationId },
        select: { projectId: true },
      });
      if (application) {
        this.eventEmitter.emit("dependency-scan.scan-failed", {
          applicationId,
          projectId: application.projectId,
          scanId,
          error: errorMessage,
        });
      }
    } finally {
      this.activeScans.delete(applicationId);
    }
  }

  private async pruneFailedScans(applicationId: string, keepId: string) {
    await this.prisma.dependencyScan.deleteMany({
      where: { applicationId, status: "FAILED", id: { not: keepId } },
    });
  }

  /**
   * Fetch the repository lockfile via the GitHub API, parse every locked
   * package version, and match them against the OSV vulnerability database.
   */
  private async scanApplicationLockfile(application: {
    id: string;
    name: string;
    projectId: string;
    repositoryUrl: string | null;
  }) {
    const repository = this.parseGitHubRepo(application.repositoryUrl!);
    if (!repository) {
      throw new Error(`Repository URL is not a supported GitHub URL: ${application.repositoryUrl}`);
    }

    let lockfileContent: string | null = null;
    let lockfilePath: string | null = null;
    for (const candidate of LOCKFILE_CANDIDATES) {
      lockfileContent = await this.gitHubService.getFileContent(repository.owner, repository.repo, candidate);
      if (lockfileContent) {
        lockfilePath = candidate;
        break;
      }
    }
    if (!lockfileContent || !lockfilePath) {
      throw new Error(
        `No supported lockfile (${LOCKFILE_CANDIDATES.join(", ")}) found at the repository root of ${repository.owner}/${repository.repo}.`,
      );
    }

    const packages = this.parsePackageLock(lockfileContent);
    const vulnsByPackage = await this.queryOsvBatch(packages);

    const vulnIds = [...new Set([...vulnsByPackage.values()].flat().map((vuln) => vuln.id))];
    const vulnDetails = await this.fetchVulnDetails(vulnIds);

    const findings: DependencyScanFindingInput[] = [];
    for (const pkg of packages) {
      const vulns = vulnsByPackage.get(this.packageKey(pkg)) ?? [];
      for (const vuln of vulns) {
        findings.push(this.buildFinding(pkg, vuln.id, vulnDetails.get(vuln.id)));
      }
    }
    findings.sort(
      (left, right) =>
        this.severityRank[right.severity] - this.severityRank[left.severity] ||
        left.packageName.localeCompare(right.packageName),
    );

    const summary = {
      packagesScanned: packages.length,
      vulnerablePackages: new Set(findings.map((finding) => finding.packageName)).size,
      totalFindings: findings.length,
      critical: findings.filter((finding) => finding.severity === "critical").length,
      high: findings.filter((finding) => finding.severity === "high").length,
      medium: findings.filter((finding) => finding.severity === "medium").length,
      low: findings.filter((finding) => finding.severity === "low").length,
      unknown: findings.filter((finding) => finding.severity === "unknown").length,
    };

    const report = {
      applicationId: application.id,
      applicationName: application.name,
      projectId: application.projectId,
      repositoryUrl: application.repositoryUrl,
      lockfilePath,
      scannedAt: new Date().toISOString(),
      summary,
      limitations: [
        "Only package-lock.json (lockfileVersion 2+) at the repository root is parsed in this version.",
        "Severity comes from the vulnerability record database metadata; records without severity metadata are reported as unknown.",
        "Vulnerability data is provided by the OSV database (https://osv.dev).",
      ],
      findings,
    };

    return { report, findings, packageCount: packages.length, lockfilePath };
  }

  /**
   * Parse package-lock.json v2/v3. The `packages` map is a flat map from
   * node_modules paths to resolved metadata, covering the full transitive
   * tree with exact versions — package.json alone only carries ranges and is
   * not usable for precise vulnerability matching.
   */
  private parsePackageLock(content: string): LockedPackage[] {
    const lock = JSON.parse(content);
    const packages = lock?.packages;
    if (!packages || typeof packages !== "object") {
      throw new Error("Unsupported package-lock.json format: missing packages map (lockfileVersion 2+ required).");
    }

    const result = new Map<string, LockedPackage>();
    for (const [path, meta] of Object.entries(packages) as [string, any][]) {
      if (!path) continue; // root entry
      const marker = "node_modules/";
      const index = path.lastIndexOf(marker);
      if (index === -1 || !meta?.version) continue;
      const name = path.slice(index + marker.length);
      const key = `${name}@${meta.version}`;
      if (result.has(key)) continue;
      result.set(key, { name, version: meta.version, dev: Boolean(meta.dev) });
    }
    return [...result.values()];
  }

  private async queryOsvBatch(packages: LockedPackage[]): Promise<Map<string, { id: string; modified: string }[]>> {
    const results = new Map<string, { id: string; modified: string }[]>();
    for (let index = 0; index < packages.length; index += QUERY_BATCH_SIZE) {
      const chunk = packages.slice(index, index + QUERY_BATCH_SIZE);
      const response = await fetch(`${OSV_API_BASE}/v1/querybatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          queries: chunk.map((pkg) => ({
            package: { name: pkg.name, ecosystem: OSV_ECOSYSTEM },
            version: pkg.version,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(`OSV querybatch request failed with HTTP ${response.status}.`);
      }
      const payload = await response.json();
      const batchResults = Array.isArray(payload?.results) ? payload.results : [];
      chunk.forEach((pkg, resultIndex) => {
        const vulns = Array.isArray(batchResults[resultIndex]?.vulns) ? batchResults[resultIndex].vulns : [];
        if (vulns.length) {
          results.set(this.packageKey(pkg), vulns);
        }
      });
    }
    return results;
  }

  private async fetchVulnDetails(vulnIds: string[]): Promise<Map<string, any>> {
    const details = new Map<string, any>();
    for (let index = 0; index < vulnIds.length; index += VULN_DETAIL_CONCURRENCY) {
      const chunk = vulnIds.slice(index, index + VULN_DETAIL_CONCURRENCY);
      const responses = await Promise.all(
        chunk.map(async (id) => {
          const response = await fetch(`${OSV_API_BASE}/v1/vulns/${encodeURIComponent(id)}`);
          if (!response.ok) {
            throw new Error(`OSV vulnerability lookup failed for ${id} (HTTP ${response.status}).`);
          }
          return [id, await response.json()] as const;
        }),
      );
      for (const [id, body] of responses) {
        details.set(id, body);
      }
    }
    return details;
  }

  private buildFinding(pkg: LockedPackage, vulnId: string, vuln: any): DependencyScanFindingInput {
    return {
      packageName: pkg.name,
      packageVersion: pkg.version,
      isDev: pkg.dev,
      vulnId,
      aliases: Array.isArray(vuln?.aliases) ? vuln.aliases.slice(0, 10) : [],
      severity: this.extractSeverity(vuln),
      title: (typeof vuln?.summary === "string" && vuln.summary ? vuln.summary : `Vulnerability ${vulnId}`).slice(
        0,
        500,
      ),
      detail: typeof vuln?.details === "string" ? vuln.details.slice(0, 4000) : undefined,
      fixedVersion: this.extractFixedVersion(vuln, pkg.name),
    };
  }

  private extractSeverity(vuln: any): Severity {
    const raw = vuln?.database_specific?.severity;
    if (typeof raw === "string") {
      const value = raw.toLowerCase();
      if (value === "critical" || value === "high" || value === "low") {
        return value;
      }
      if (value === "moderate" || value === "medium") {
        return "medium";
      }
    }
    return "unknown";
  }

  private extractFixedVersion(vuln: any, packageName: string): string | null {
    const affected = Array.isArray(vuln?.affected) ? vuln.affected : [];
    for (const entry of affected) {
      const affectedName = entry?.package?.name;
      if (affectedName && affectedName !== packageName) {
        continue;
      }
      for (const range of entry?.ranges ?? []) {
        for (const event of range?.events ?? []) {
          if (typeof event?.fixed === "string" && event.fixed) {
            return event.fixed;
          }
        }
      }
    }
    return null;
  }

  /**
   * Persist the findings from a successful scan into the DependencyScanFinding table.
   * Each finding is identified by a stable fingerprint so repeated scans update
   * the same row (lastSeenAt refresh) instead of creating duplicates. Findings
   * that were open in a previous scan but did not recur are marked resolved.
   */
  private async upsertFindings(
    application: { id: string; projectId: string },
    scanId: string,
    findings: DependencyScanFindingInput[],
  ) {
    const seenFingerprints = new Set<string>();
    const now = new Date();

    for (const finding of findings) {
      const fingerprint = this.findingFingerprint(application.id, finding);
      seenFingerprints.add(fingerprint);

      await this.prisma.dependencyScanFinding.upsert({
        where: { fingerprint },
        create: {
          applicationId: application.id,
          projectId: application.projectId,
          scanId,
          fingerprint,
          ecosystem: OSV_ECOSYSTEM,
          packageName: finding.packageName,
          packageVersion: finding.packageVersion,
          isDev: finding.isDev,
          vulnId: finding.vulnId,
          aliases: finding.aliases,
          severity: finding.severity,
          title: finding.title,
          detail: finding.detail,
          fixedVersion: finding.fixedVersion ?? null,
          status: "open",
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          scanId,
          packageVersion: finding.packageVersion,
          isDev: finding.isDev,
          aliases: finding.aliases,
          severity: finding.severity,
          title: finding.title,
          detail: finding.detail,
          fixedVersion: finding.fixedVersion ?? null,
          status: "open",
          lastSeenAt: now,
          resolvedAt: null,
        },
      });
    }

    // Findings that were open before but did not recur in this scan are resolved.
    await this.prisma.dependencyScanFinding.updateMany({
      where: {
        applicationId: application.id,
        status: "open",
        fingerprint: { notIn: [...seenFingerprints] },
      },
      data: { status: "resolved", resolvedAt: now },
    });
  }

  private findingFingerprint(applicationId: string, finding: DependencyScanFindingInput) {
    return `${applicationId}:${finding.packageName}:${finding.vulnId}`;
  }

  private packageKey(pkg: LockedPackage) {
    return `${pkg.name}@${pkg.version}`;
  }

  private parseGitHubRepo(repositoryUrl: string): { owner: string; repo: string } | null {
    const match = repositoryUrl.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    if (!match) {
      return null;
    }
    return { owner: match[1], repo: match[2] };
  }

  private getErrorMessage(error: any) {
    return error?.message || error?.name || "Unknown dependency scan error";
  }
}
