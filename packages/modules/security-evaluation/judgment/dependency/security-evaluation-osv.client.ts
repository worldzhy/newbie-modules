import { Injectable, Logger } from "@nestjs/common";

import {
  SECURITY_EVALUATION_OSV_API_BASE_URL,
  SECURITY_EVALUATION_OSV_DETAIL_CONCURRENCY,
  SECURITY_EVALUATION_OSV_QUERY_BATCH_SIZE,
  SECURITY_EVALUATION_OSV_REQUEST_TIMEOUT_MS,
} from "../../security-evaluation.constants";
import type { LockedPackage } from "./security-evaluation-lockfile";

/** Identity of one vulnerability reference returned by querybatch. */
export interface OsvVulnerabilityReference {
  id: string;
  modified?: string;
}

/** The subset of an OSV vulnerability record this judgment consumes. */
export interface OsvVulnerability {
  aliases?: unknown;
  summary?: unknown;
  details?: unknown;
  database_specific?: { severity?: unknown } | null;
  affected?: unknown;
}

export interface OsvBatchOutcome {
  vulnerabilitiesByPackageKey: Map<string, OsvVulnerabilityReference[]>;
  /** Packages whose batch query failed; they were never judged. */
  failedPackageKeys: string[];
  failureNote?: string;
}

/** Key used to correlate a batch result with a package. */
export function osvPackageKey(packageName: string, version: string): string {
  return `${packageName}@${version}`;
}

/**
 * SecurityEvaluationOsvClient — the OSV.dev access layer of the DEPENDENCY
 * judgment. It owns transport and failure classification only; severity,
 * urgency and identity belong to the pure helpers.
 *
 * A failed batch chunk is reported to the caller as unjudged packages, never
 * thrown away silently: the coverage bucket has to name what was skipped.
 */
@Injectable()
export class SecurityEvaluationOsvClient {
  private readonly logger = new Logger(SecurityEvaluationOsvClient.name);

  async queryPackages(packages: readonly LockedPackage[]): Promise<OsvBatchOutcome> {
    const vulnerabilitiesByPackageKey = new Map<string, OsvVulnerabilityReference[]>();
    const failedPackageKeys: string[] = [];
    const failures: string[] = [];

    for (let index = 0; index < packages.length; index += SECURITY_EVALUATION_OSV_QUERY_BATCH_SIZE) {
      const chunk = packages.slice(index, index + SECURITY_EVALUATION_OSV_QUERY_BATCH_SIZE);
      try {
        const payload = await this.requestJson(`${SECURITY_EVALUATION_OSV_API_BASE_URL}/v1/querybatch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            queries: chunk.map((pkg) => ({ package: { name: pkg.name, ecosystem: "npm" }, version: pkg.version })),
          }),
        });
        const rawResults = payload.results;
        const results = (Array.isArray(rawResults) ? rawResults : []) as { vulns?: unknown }[];
        chunk.forEach((pkg, resultIndex) => {
          const rawVulns = results[resultIndex]?.vulns;
          const vulns = Array.isArray(rawVulns)
            ? rawVulns.filter(
                (vuln): vuln is OsvVulnerabilityReference =>
                  typeof vuln === "object" && vuln !== null && typeof (vuln as { id?: unknown }).id === "string",
              )
            : [];
          if (vulns.length > 0) {
            vulnerabilitiesByPackageKey.set(osvPackageKey(pkg.name, pkg.version), vulns);
          }
        });
      } catch (error) {
        const reason = describe(error);
        failures.push(reason);
        for (const pkg of chunk) failedPackageKeys.push(osvPackageKey(pkg.name, pkg.version));
        this.logger.warn(`OSV querybatch chunk of ${chunk.length} packages failed: ${reason}`);
      }
    }

    return {
      vulnerabilitiesByPackageKey,
      failedPackageKeys,
      failureNote: failures.length > 0 ? [...new Set(failures)].join("; ") : undefined,
    };
  }

  /**
   * Vulnerability details, best effort: a record that cannot be fetched still
   * yields its known id, so the finding is reported with unknown severity
   * instead of disappearing. Null marks the failed lookup.
   */
  async fetchDetails(vulnerabilityIds: readonly string[]): Promise<Map<string, OsvVulnerability | null>> {
    const details = new Map<string, OsvVulnerability | null>();
    for (let index = 0; index < vulnerabilityIds.length; index += SECURITY_EVALUATION_OSV_DETAIL_CONCURRENCY) {
      const chunk = vulnerabilityIds.slice(index, index + SECURITY_EVALUATION_OSV_DETAIL_CONCURRENCY);
      const fetched = await Promise.all(
        chunk.map(async (id) => {
          try {
            const payload = await this.requestJson(
              `${SECURITY_EVALUATION_OSV_API_BASE_URL}/v1/vulns/${encodeURIComponent(id)}`,
            );
            return [id, payload as OsvVulnerability] as const;
          } catch (error) {
            this.logger.warn(`OSV vulnerability ${id} could not be fetched: ${describe(error)}`);
            return [id, null] as const;
          }
        }),
      );
      for (const [id, payload] of fetched) details.set(id, payload);
    }
    return details;
  }

  private async requestJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SECURITY_EVALUATION_OSV_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`OSV request failed with HTTP ${response.status}.`);
      const payload = await response.json();
      if (!payload || typeof payload !== "object") throw new Error("OSV response was not a JSON object.");
      return payload as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "AbortError" ? "request timed out" : error.message;
  }
  return String(error);
}
