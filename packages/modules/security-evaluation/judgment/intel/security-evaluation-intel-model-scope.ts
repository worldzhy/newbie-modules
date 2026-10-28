import { Injectable, OnModuleInit } from "@nestjs/common";
import { LlmScopeCatalog, type LlmScopeDefinition } from "@modules/llm/management/llm-scope-catalog.service";
import { SECURITY_EVALUATION_INTEL_LLM_SCOPE } from "./security-evaluation-intel-re-ranker";

/** Catalog entry published to the llm module (ADR-043). */
export const SECURITY_EVALUATION_INTEL_MODEL_SCOPE_DEFINITION: LlmScopeDefinition = {
  scope: SECURITY_EVALUATION_INTEL_LLM_SCOPE,
  label: "Security evaluation threat intel",
};

/** Publishes this consumer's scope to the llm catalog at startup. */
@Injectable()
export class SecurityEvaluationIntelModelScopeRegistration implements OnModuleInit {
  constructor(private readonly catalog: LlmScopeCatalog) {}

  onModuleInit(): void {
    this.catalog.register(SECURITY_EVALUATION_INTEL_MODEL_SCOPE_DEFINITION);
  }
}
