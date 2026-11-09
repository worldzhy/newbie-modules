import { Injectable, OnModuleInit } from "@nestjs/common";
import { LlmScopeCatalog } from "@modules/llm/llm-scope.catalog";

import { SECURITY_EVALUATION_CODE_SCAN_LLM_SCOPE } from "./security-evaluation-code-scan-request";

/**
 * Declares the "security-evaluation-code-scan" LLM scope so the connection
 * management UI can bind a model to the CODE_SCAN judgment (ADR-054). The
 * feature itself is assembled; without a bound connection every file is an
 * unavailable verdict (never cached) and lands in the run's skipped bucket.
 */
@Injectable()
export class SecurityEvaluationCodeScanModelScopeRegistration implements OnModuleInit {
  constructor(private readonly catalog: LlmScopeCatalog) {}

  onModuleInit(): void {
    this.catalog.register({
      scope: SECURITY_EVALUATION_CODE_SCAN_LLM_SCOPE,
      label: "Security evaluation code scan",
      description:
        "LLM connection used by security-evaluation CODE_SCAN runs to judge source files against the five risk-category criteria. The feature works without it, but no file is judged while the scope is unbound.",
    });
  }
}
