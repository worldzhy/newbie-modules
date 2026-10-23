import { spawn } from "node:child_process";
import type { EvidenceSourceType } from "./people-evidence-source-type";

/**
 * Generic evidence collector contract (ADR-021).
 *
 * Collectors run on a collection window (a date range inside one
 * COLLECTION period) and produce evidence rows that host code then
 * writes through PeopleEvaluationService.recordEvidence(). The collector
 * layer is intentionally free of any FK relation to host-side entities —
 * it emits generic payload blobs and attribute results to evaluateeUserId
 * via whatever attribution map the host supplies (git email → userId,
 * incident → application → project → member, etc.).
 *
 * Collectors are idempotent: the same collector + same window must emit
 * the same evidence rows on re-run so re-collection after mid-window data
 * changes converges.
 */
export interface EvidenceCollector {
  /** Source type tag. Must match EvidenceSourceType enum. */
  readonly sourceType: EvidenceSourceType;

  /** Collect evidence for the given window and return batch-ready rows. */
  collect(window: EvidenceWindow): Promise<EvidenceRow[]>;
}

export interface EvidenceWindow {
  /** Inclusive start of the collection window. */
  windowStart: Date;
  /** Exclusive end of the collection window. */
  windowEnd: Date;
}

/** One evidence row ready for PeopleEvaluationService.recordEvidence(). */
export interface EvidenceRow {
  /** Subject this evidence belongs to. */
  evaluateeUserId: string;
  /** Source reference opaque to consumers — e.g. "git:nightwatch-backend:abc1234". */
  sourceRef?: string;
  /** Which evaluation dimension this evidence feeds (null if multi-purpose). */
  dimensionKey?: string;
  /** Signed weighted contribution. Negative for evaluatee-caused incidents. */
  contribution?: number;
  /** Free-form JSON payload specific to the source type. */
  payload: Record<string, unknown>;
  /** Timestamp of the source event (e.g. git commit date), NOT the collection-run time. */
  eventAt: Date;
}

/**
 * Collects commit-level evidence from one or more local git repos.
 *
 * Generic: takes repo paths + email→userId map. Works for any host that
 * mounts its repos where the backend can see them. Attribution is purely
 * by commit author email matching — no ProjectMember FK walk.
 *
 * Dimension attribution is host vocabulary and therefore injected: the
 * host passes a `classifyDimension` callback (or nothing, leaving commits
 * uncategorized so scoring spreads them evenly).
 *
 * Dedupe key: `${repoPath}:${commitHash}`. Running the collector twice on
 * the same window produces identical rows.
 */
export class GitEvidenceCollector implements EvidenceCollector {
  readonly sourceType: EvidenceSourceType = "GIT";

  constructor(
    private readonly repoConfigs: { path: string; repoName: string }[],
    /** Lowercased email → evaluateeUserId. Host supplies the mapping. */
    private readonly emailToUserId: Record<string, string>,
    /** Host-supplied dimension classifier; omit to leave commits uncategorized. */
    private readonly options: { classifyDimension?: (subject: string) => string | undefined } = {},
  ) {}

  async collect(window: EvidenceWindow): Promise<EvidenceRow[]> {
    const rows: EvidenceRow[] = [];
    for (const repo of this.repoConfigs) {
      const commits = await this.runGitLog(repo.path, repo.repoName, window);
      rows.push(...commits);
    }
    return rows;
  }

  private runGitLog(repoPath: string, repoName: string, window: EvidenceWindow): Promise<EvidenceRow[]> {
    return new Promise((resolve) => {
      const startIso = window.windowStart.toISOString();
      const endIso = window.windowEnd.toISOString();
      const proc = spawn(
        "git",
        ["log", "--format=%H%x1f%ae%x1f%s%x1f%ad", "--date=iso-strict", `--after=${startIso}`, `--before=${endIso}`],
        { cwd: repoPath },
      );

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => (stdout += d));
      proc.stderr.on("data", (d) => (stderr += d));
      proc.on("close", (code) => {
        if (code !== 0) {
          console.warn(`[GitEvidenceCollector] git log failed for ${repoPath}: ${stderr}`);
          resolve([]);
          return;
        }
        const lines = stdout
          .trim()
          .split("\n")
          .filter((l) => l.length > 0);
        const rows: EvidenceRow[] = [];
        for (const line of lines) {
          const [hash, email, subject, dateStr] = line.split("\x1f");
          const userId = this.emailToUserId[email.toLowerCase()];
          if (!userId) continue; // skip commits from unknown authors
          rows.push({
            evaluateeUserId: userId,
            sourceRef: `git:${repoName}:${hash.slice(0, 8)}`,
            dimensionKey: this.options.classifyDimension?.(subject),
            payload: { hash, subject, repoName, authorEmail: email },
            eventAt: new Date(dateStr),
          });
        }
        resolve(rows);
      });
    });
  }
}
