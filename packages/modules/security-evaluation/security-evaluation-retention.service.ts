import { Injectable } from "@nestjs/common";

import { SecurityEvaluationCodeScanExcerptService } from "./evidence/security-evaluation-code-scan-excerpt.service";
import { SecurityEvaluationCodeScanVerdictCacheRepository } from "./persistence/security-evaluation-code-scan-verdict-cache.repository";

export interface SecurityEvaluationRetentionResult {
  verdictCacheDeleted: number;
  excerptsDeleted: number;
}

/**
 * Physical deletion of the CODE_SCAN derived stores (ADR-054 clauses 6 and 7).
 *
 * Both stores are bounded by declarative windows — the verdict cache by
 * `codeScanVerdictCacheTtlDays`, the excerpts by the retention constant — and
 * both were previously only filtered on read, so expired rows accumulated
 * forever. This is the single call site a host schedules; neither window is a
 * read-side filter over an unbounded table anymore.
 *
 * Losing an expired excerpt is safe by design: the finding detail read falls
 * back to the content hash and the truncated flag the manifest keeps.
 */
@Injectable()
export class SecurityEvaluationRetentionService {
  constructor(
    private readonly verdictCache: SecurityEvaluationCodeScanVerdictCacheRepository,
    private readonly excerpts: SecurityEvaluationCodeScanExcerptService,
  ) {}

  async pruneExpired(): Promise<SecurityEvaluationRetentionResult> {
    const verdictCache = await this.verdictCache.pruneExpired();
    const excerpts = await this.excerpts.pruneExpired();
    return { verdictCacheDeleted: verdictCache.deleted, excerptsDeleted: excerpts.deleted };
  }
}
