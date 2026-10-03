import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  AWS_AUDIT_MODULE,
  DEPENDENCY_SCAN_MODULE,
  NOTIFICATION_TYPE,
  SEVERITIES,
  SEVERITY_LEVEL,
  TOP_FINDINGS_IN_DIGEST,
} from "./notification-center.constants";
import { NotificationCenterService } from "./notification-center.service";
import { MessagePushService } from "./services/message-push.service";

interface ScanCompletedScope {
  sourceModule: string;
  projectId: string;
  applicationId: string | null;
  scanId: string;
}

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  total: number;
}

interface TopFinding {
  severity: string;
  title: string;
  service: string | null;
  resourceType: string | null;
  resourceId: string | null;
  ruleId: string | null;
  packageName: string | null;
  packageVersion: string | null;
  vulnId: string | null;
  fixedVersion: string | null;
}

interface SpikeStats {
  current: number;
  averageDaily: number;
  threshold: number;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, total: 0 };
}

function addFinding(counts: SeverityCounts, severity: string, amount = 1): void {
  if (severity === "critical" || severity === "high" || severity === "medium" || severity === "low") {
    counts[severity] += amount;
  } else {
    counts.unknown += amount;
  }
  counts.total += amount;
}

function highestSeverityOf(counts: SeverityCounts): string {
  for (const severity of SEVERITIES) {
    if (counts[severity] > 0) {
      return severity;
    }
  }
  return "unknown";
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Turns scan-completed events into deduplicated digest notifications and
 * optional Lark/Slack pushes.
 *
 * Noise control: one notification per (module, scan); only findings whose
 * firstSeenAt falls inside the scan window count as "new", so a finding that
 * reappears in later scans never alerts again until it is resolved and
 * reintroduced. Scans without qualifying new findings stay silent.
 */
@Injectable()
export class SecurityAlertService {
  private readonly logger = new Logger(SecurityAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationCenter: NotificationCenterService,
    private readonly messagePush: MessagePushService,
  ) {}

  @OnEvent("aws-audit.scan-completed")
  async onAwsAuditScanCompleted(payload: { projectId: string; scanId: string }): Promise<void> {
    await this.handleScanCompleted({
      sourceModule: AWS_AUDIT_MODULE,
      projectId: payload.projectId,
      applicationId: null,
      scanId: payload.scanId,
    });
  }

  @OnEvent("dependency-scan.scan-completed")
  async onDependencyScanCompleted(payload: {
    applicationId: string;
    projectId: string;
    scanId: string;
  }): Promise<void> {
    await this.handleScanCompleted({
      sourceModule: DEPENDENCY_SCAN_MODULE,
      projectId: payload.projectId,
      applicationId: payload.applicationId,
      scanId: payload.scanId,
    });
  }

  private async handleScanCompleted(scope: ScanCompletedScope): Promise<void> {
    try {
      const settings = await this.notificationCenter.getSettings();
      if (!settings.inAppEnabled && !settings.pushEnabled) {
        return;
      }

      const { project, scan, application } = await this.loadScope(scope);
      if (!project || !scan || scan.status !== "SUCCESS") {
        return;
      }

      const windowStart = scan.startedAt ?? scan.createdAt;
      const newFindings = await this.loadNewFindings(scope, windowStart);
      if (newFindings.length === 0) {
        return;
      }

      const newCounts = emptyCounts();
      for (const finding of newFindings) {
        addFinding(newCounts, finding.severity);
      }
      const highestSeverity = highestSeverityOf(newCounts);
      if (SEVERITY_LEVEL[highestSeverity] < (SEVERITY_LEVEL[settings.minimumSeverity] ?? SEVERITY_LEVEL.high)) {
        return;
      }

      const openCounts = await this.loadOpenCounts(scope);
      const spike = settings.spikeEnabled
        ? await this.detectSpike(scope, windowStart, newCounts, settings.spikeThreshold, settings.spikeBaselineDays)
        : null;

      // Idempotency guard in addition to the DB unique constraint: a re-fired
      // event for the same scan must never duplicate a notification.
      const existing = await this.prisma.notification.findFirst({
        where: { sourceModule: scope.sourceModule, scanId: scope.scanId },
        select: { id: true },
      });
      if (existing) {
        return;
      }

      const scopeLabel = application?.name ?? null;
      const sourceLabel = scope.sourceModule === AWS_AUDIT_MODULE ? "AWS 安全审计" : "依赖漏洞扫描";
      const highPlus = newCounts.critical + newCounts.high;
      const subject = scopeLabel ? `${project.name} / ${scopeLabel}` : project.name;
      const title = spike
        ? `安全告警突增：${subject} 本次新增 ${highPlus} 个高危风险`
        : `${subject} ${sourceLabel}新增 ${newCounts.total} 个风险`;
      const detail = this.buildDetail(newCounts, openCounts, spike);
      const topFindings = this.pickTopFindings(newFindings);
      const link = `/projects/${scope.projectId}/security`;

      let notificationId: string;
      try {
        const notification = await this.prisma.notification.create({
          data: {
            type: spike ? NOTIFICATION_TYPE.SECURITY_SPIKE : NOTIFICATION_TYPE.SECURITY_SCAN_DIGEST,
            severity: highestSeverity,
            title,
            detail,
            payload: {
              new: newCounts,
              open: openCounts,
              topFindings,
              spike,
              scopeLabel,
              sourceLabel,
            } as unknown as Prisma.InputJsonValue,
            sourceModule: scope.sourceModule,
            scanId: scope.scanId,
            projectId: scope.projectId,
            applicationId: scope.applicationId,
            link,
          },
          select: { id: true },
        });
        notificationId = notification.id;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return;
        }
        throw error;
      }

      if (settings.pushEnabled && settings.channelGroupId) {
        const text = this.buildPushText({ title, newCounts, spike, link, subject, sourceLabel });
        const pushResult = await this.messagePush.dispatchToGroup(settings.channelGroupId, text);
        if (pushResult.failed > 0) {
          this.logger.warn(
            `Push for notification ${notificationId} failed on ${pushResult.failed} channel(s), ${pushResult.succeeded} succeeded`,
          );
        }
      }
    } catch (error) {
      // Alerting must never break or retry the scan pipeline; the snapshot
      // listener and the scan itself already committed before this event.
      this.logger.error(
        `Failed to build security alert for ${scope.sourceModule} scan ${scope.scanId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // --- Scope loading -------------------------------------------------------

  private async loadScope(scope: ScanCompletedScope) {
    const project = this.prisma.project.findUnique({
      where: { id: scope.projectId },
      select: { id: true, name: true },
    });

    if (scope.sourceModule === AWS_AUDIT_MODULE) {
      const [projectRow, scanRow] = await Promise.all([
        project,
        this.prisma.awsAuditScan.findUnique({
          where: { id: scope.scanId },
          select: { id: true, status: true, startedAt: true, createdAt: true },
        }),
      ]);
      return { project: projectRow, scan: scanRow, application: null };
    }

    const [projectRow, scanRow, applicationRow] = await Promise.all([
      project,
      this.prisma.dependencyScan.findUnique({
        where: { id: scope.scanId },
        select: { id: true, status: true, startedAt: true, createdAt: true },
      }),
      scope.applicationId
        ? this.prisma.application.findUnique({ where: { id: scope.applicationId }, select: { id: true, name: true } })
        : Promise.resolve(null),
    ]);
    return { project: projectRow, scan: scanRow, application: applicationRow };
  }

  private async loadNewFindings(scope: ScanCompletedScope, windowStart: Date): Promise<TopFinding[]> {
    if (scope.sourceModule === AWS_AUDIT_MODULE) {
      const rows = await this.prisma.awsAuditFinding.findMany({
        where: { projectId: scope.projectId, status: "open", firstSeenAt: { gte: windowStart } },
        select: {
          severity: true,
          title: true,
          service: true,
          resourceType: true,
          resourceId: true,
          ruleId: true,
        },
      });
      return rows.map((row) => ({
        severity: row.severity,
        title: row.title,
        service: row.service,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        ruleId: row.ruleId,
        packageName: null,
        packageVersion: null,
        vulnId: null,
        fixedVersion: null,
      }));
    }

    const rows = await this.prisma.dependencyScanFinding.findMany({
      where: { applicationId: scope.applicationId ?? undefined, status: "open", firstSeenAt: { gte: windowStart } },
      select: {
        severity: true,
        title: true,
        packageName: true,
        packageVersion: true,
        vulnId: true,
        fixedVersion: true,
      },
    });
    return rows.map((row) => ({
      severity: row.severity,
      title: row.title,
      service: null,
      resourceType: null,
      resourceId: null,
      ruleId: null,
      packageName: row.packageName,
      packageVersion: row.packageVersion,
      vulnId: row.vulnId,
      fixedVersion: row.fixedVersion,
    }));
  }

  private async loadOpenCounts(scope: ScanCompletedScope): Promise<SeverityCounts> {
    const counts = emptyCounts();
    const groups =
      scope.sourceModule === AWS_AUDIT_MODULE
        ? await this.prisma.awsAuditFinding.groupBy({
            by: ["severity"],
            where: { projectId: scope.projectId, status: "open" },
            _count: { _all: true },
          })
        : await this.prisma.dependencyScanFinding.groupBy({
            by: ["severity"],
            where: { applicationId: scope.applicationId ?? undefined, status: "open" },
            _count: { _all: true },
          });
    for (const group of groups) {
      addFinding(counts, group.severity, group._count._all);
    }
    return counts;
  }

  // --- Spike detection -----------------------------------------------------

  private async detectSpike(
    scope: ScanCompletedScope,
    windowStart: Date,
    newCounts: SeverityCounts,
    configuredThreshold: number,
    baselineDays: number,
  ): Promise<SpikeStats | null> {
    const current = newCounts.critical + newCounts.high;
    const baselineStart = new Date(windowStart.getTime() - baselineDays * DAY_IN_MS);

    const where = {
      status: "open" as const,
      severity: { in: ["critical", "high"] },
      firstSeenAt: { gte: baselineStart, lt: windowStart },
      ...(scope.sourceModule === AWS_AUDIT_MODULE
        ? { projectId: scope.projectId }
        : { applicationId: scope.applicationId ?? undefined }),
    };
    const baselineCount =
      scope.sourceModule === AWS_AUDIT_MODULE
        ? await this.prisma.awsAuditFinding.count({ where })
        : await this.prisma.dependencyScanFinding.count({ where });

    const averageDaily = baselineCount / baselineDays;
    const threshold = Math.max(configuredThreshold, Math.ceil(averageDaily * 2));
    if (current >= threshold && current > averageDaily) {
      return { current, averageDaily: roundToOneDecimal(averageDaily), threshold };
    }
    return null;
  }

  // --- Formatting ----------------------------------------------------------

  private pickTopFindings(findings: TopFinding[]): TopFinding[] {
    return [...findings]
      .sort((left, right) => SEVERITY_LEVEL[right.severity] - SEVERITY_LEVEL[left.severity])
      .slice(0, TOP_FINDINGS_IN_DIGEST);
  }

  private buildDetail(newCounts: SeverityCounts, openCounts: SeverityCounts, spike: SpikeStats | null): string {
    const lines = [
      `本次新增：critical ${newCounts.critical}、high ${newCounts.high}、medium ${newCounts.medium}、low ${newCounts.low}`,
      `当前未解决：${openCounts.total} 个`,
    ];
    if (spike) {
      lines.push(
        `突增检测：近期待测日均新增高危 ${spike.averageDaily} 个，本次 ${spike.current} 个，达到突增阈值 ${spike.threshold}`,
      );
    }
    return lines.join("\n");
  }

  private buildPushText(args: {
    title: string;
    newCounts: SeverityCounts;
    spike: SpikeStats | null;
    link: string;
    subject: string;
    sourceLabel: string;
  }): string {
    const baseUrl = (process.env.APP_FRONTEND_URL ?? "").replace(/\/+$/, "");
    const lines = [
      args.spike ? "⚠️ Nightwatch 安全告警突增" : "🔔 Nightwatch 安全告警",
      `范围：${args.subject}（${args.sourceLabel}）`,
      `本次新增：critical ${args.newCounts.critical}、high ${args.newCounts.high}、medium ${args.newCounts.medium}、low ${args.newCounts.low}`,
    ];
    if (args.spike) {
      lines.push(
        `突增：近 ${args.spike.averageDaily} 个/日 → 本次 ${args.spike.current} 个（阈值 ${args.spike.threshold}）`,
      );
    }
    lines.push(`查看详情：${baseUrl}${args.link}`);
    return lines.join("\n");
  }
}
