import { Injectable, OnModuleInit } from "@nestjs/common";
import { LlmScopeCatalog, type LlmScopeDefinition } from "@modules/llm/management/llm-scope-catalog.service";
import { DEFAULT_WORK_EVALUATION_SCOPE } from "./work-evaluation-judgment.prompt";

/** Catalog entry published to the llm module (ADR-043). */
export const WORK_EVALUATION_MODEL_SCOPE_DEFINITION: LlmScopeDefinition = {
  scope: DEFAULT_WORK_EVALUATION_SCOPE,
  label: "Work evaluation",
};

/** Publishes this consumer's scope to the llm catalog at startup. */
@Injectable()
export class WorkEvaluationModelScopeRegistration implements OnModuleInit {
  constructor(private readonly catalog: LlmScopeCatalog) {}

  onModuleInit(): void {
    this.catalog.register(WORK_EVALUATION_MODEL_SCOPE_DEFINITION);
  }
}
