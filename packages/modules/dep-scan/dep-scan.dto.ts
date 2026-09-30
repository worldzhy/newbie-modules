import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Scan lifecycle status. */
export type DepScanStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

/** Finding severity level, normalized from the vulnerability record metadata. */
export type DepScanSeverity = "critical" | "high" | "medium" | "low" | "unknown";

/** Aggregated counts of open findings by severity. */
export class DepScanOpenSummaryDto {
  @ApiProperty({ description: "Total open findings" })
  total: number;

  @ApiProperty({ description: "Critical-severity open findings" })
  critical: number;

  @ApiProperty({ description: "High-severity open findings" })
  high: number;

  @ApiProperty({ description: "Medium-severity open findings" })
  medium: number;

  @ApiProperty({ description: "Low-severity open findings" })
  low: number;

  @ApiProperty({ description: "Open findings without severity metadata" })
  unknown: number;
}

/** Aggregated summary of a finished scan. */
export class DepScanScanSummaryDto extends DepScanOpenSummaryDto {
  @ApiProperty({ description: "Total locked packages matched against OSV" })
  packagesScanned: number;

  @ApiProperty({ description: "Packages with at least one finding" })
  vulnerablePackages: number;
}

/** A single persisted dep-scan record (serialized for the client). */
export class DepScanScanRecordDto {
  @ApiProperty({ description: "Scan record ID" })
  id: string;

  @ApiProperty({ description: "Application ID" })
  applicationId: string;

  @ApiProperty({ description: "Scan lifecycle status", example: "SUCCESS" })
  status: DepScanStatus;

  @ApiPropertyOptional({ description: "Error message when status is FAILED", type: String })
  errorMessage?: string | null;

  @ApiPropertyOptional({ description: "Aggregated summary counts, null until scan completes", type: DepScanScanSummaryDto })
  summary?: DepScanScanSummaryDto | null;

  @ApiPropertyOptional({ description: "Locked packages found in the lockfile", type: Number })
  packageCount?: number | null;

  @ApiPropertyOptional({ description: "Repository URL scanned", type: String })
  repositoryUrl?: string | null;

  @ApiPropertyOptional({ description: "Lockfile path fetched from the repository", type: String })
  lockfilePath?: string | null;

  @ApiProperty({ description: "Whether a full report is available for this scan" })
  hasReport: boolean;

  @ApiProperty({ description: "Creation timestamp", type: Date })
  createdAt: Date;

  @ApiProperty({ description: "Last update timestamp", type: Date })
  updatedAt: Date;

  @ApiPropertyOptional({ description: "Timestamp when the scan started", type: Date })
  startedAt?: Date | null;

  @ApiPropertyOptional({ description: "Timestamp when the scan finished", type: Date })
  finishedAt?: Date | null;
}

/** A persisted open vulnerability finding for an application dependency. */
export class DepScanFindingDto {
  @ApiProperty({ description: "Finding record ID" })
  id: string;

  @ApiProperty({ description: "Affected npm package name" })
  packageName: string;

  @ApiProperty({ description: "Installed package version from the lockfile" })
  packageVersion: string;

  @ApiProperty({ description: "Whether the package is a devDependency" })
  isDev: boolean;

  @ApiProperty({ description: "OSV vulnerability ID (e.g. GHSA-...)" })
  vulnId: string;

  @ApiProperty({ type: [String], description: "Vulnerability aliases (e.g. CVE IDs)" })
  aliases: string[];

  @ApiProperty({ description: "Severity level" })
  severity: DepScanSeverity;

  @ApiProperty({ description: "Short vulnerability title" })
  title: string;

  @ApiPropertyOptional({ description: "Detailed vulnerability description", type: String })
  detail?: string | null;

  @ApiPropertyOptional({ description: "First version containing the fix, when known", type: String })
  fixedVersion?: string | null;

  @ApiProperty({ description: "Finding lifecycle status (open/resolved)" })
  status: string;

  @ApiProperty({ description: "First scan that observed this finding", type: Date })
  firstSeenAt: Date;

  @ApiProperty({ description: "Most recent scan that observed this finding", type: Date })
  lastSeenAt: Date;

  @ApiPropertyOptional({ description: "Timestamp when the finding was resolved", type: Date })
  resolvedAt?: Date | null;
}

/** Per-application scan state and open findings within a project report. */
export class DepScanApplicationOverviewDto {
  @ApiProperty({ description: "Application ID" })
  applicationId: string;

  @ApiProperty({ description: "Application name" })
  applicationName: string;

  @ApiProperty({ description: "Application type (FRONTEND/BACKEND)" })
  applicationType: string;

  @ApiPropertyOptional({ description: "Git repository URL of the application", type: String })
  repositoryUrl?: string | null;

  @ApiProperty({ description: "Whether the application has a repository URL configured" })
  hasRepository: boolean;

  @ApiPropertyOptional({ description: "Currently running scan, or null", type: DepScanScanRecordDto })
  currentScan?: DepScanScanRecordDto | null;

  @ApiPropertyOptional({ description: "Most recent successful scan, or null", type: DepScanScanRecordDto })
  latestSuccessfulScan?: DepScanScanRecordDto | null;

  @ApiPropertyOptional({ description: "Most recent failed scan, or null", type: DepScanScanRecordDto })
  latestFailedScan?: DepScanScanRecordDto | null;

  @ApiProperty({ description: "Open findings counts by severity", type: DepScanOpenSummaryDto })
  openSummary: DepScanOpenSummaryDto;

  @ApiProperty({ type: [DepScanFindingDto], description: "Open findings sorted by severity" })
  findings: DepScanFindingDto[];
}

/** Project-level aggregated dep-scan report. */
export class DepScanProjectSummaryDto extends DepScanOpenSummaryDto {
  @ApiProperty({ description: "Total applications in the project" })
  applicationsTotal: number;

  @ApiProperty({ description: "Applications with at least one successful scan" })
  applicationsScanned: number;
}

/** Response for GET /dep-scan/projects/:projectId/report. */
export class DepScanProjectReportResponseDto {
  @ApiProperty({ description: "Project ID" })
  projectId: string;

  @ApiProperty({ description: "Project-level aggregated summary", type: DepScanProjectSummaryDto })
  summary: DepScanProjectSummaryDto;

  @ApiProperty({ type: [DepScanApplicationOverviewDto], description: "Per-application scan state and open findings" })
  applications: DepScanApplicationOverviewDto[];
}

/** Response for POST /dep-scan/applications/:applicationId/scan. */
export class DepScanScanStartResponseDto {
  @ApiProperty({ description: "Whether the scan request was accepted" })
  accepted: boolean;

  @ApiProperty({ description: "The scan record that was started (or the already-running one)", type: DepScanScanRecordDto })
  scan: DepScanScanRecordDto;
}
