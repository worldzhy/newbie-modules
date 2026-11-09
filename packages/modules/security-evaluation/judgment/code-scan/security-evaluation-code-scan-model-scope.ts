import { Injectable, OnModuleInit } from "@nestjs/common";
import { LlmScopeCatalog, type LlmScopeDefinition } from "@modules/llm/management/llm-scope-catalog.service";

import { SECURITY_EVALUATION_CODE_SCAN_LLM_SCOPE } from "./security-evaluation-code-scan-request";

/**
 * Catalog entry published to the llm catalog (ADR-054): the
 * "security-evaluation-code-scan" scope the CODE_SCAN judgment binds its
 * model to. Without a bound connection every file is an unavailable verdict
 * (never cached) and lands in the run's skipped bucket.
 */
export const SECURITY_EVALUATION_CODE_SCAN_MODEL_SCOPE_DEFINITION: LlmScopeDefinition = {
  scope: SECURITY_EVALUATION_CODE_SCAN_LLM_SCOPE,
  label: "Security evaluation code scan",
};

/** Publishes this consumer's scope to the llm catalog at startup. */
@Injectable()
export class SecurityEvaluationCodeScanModelScopeRegistration implements OnModuleInit {
  constructor(private readonly catalog: LlmScopeCatalog) {}

  onModuleInit(): void {
    this.catalog.register(SECURITY_EVALUATION_CODE_SCAN_MODEL_SCOPE_DEFINITION);
  }
}
