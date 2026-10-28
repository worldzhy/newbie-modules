import { Injectable } from "@nestjs/common";

/**
 * A consumer-declared LLM scope (ADR-043). The consumer that resolves its chat
 * model under a scope owns the declaration, so the admin page and the binding
 * API always see the same catalog as the code that actually calls the model.
 */
export interface LlmScopeDefinition {
  /** Opaque scope string passed to ChatModelResolver.resolve(). */
  scope: string;
  /** Human-readable name shown on the admin page. */
  label: string;
}

/**
 * Registry of consumer scopes, populated at startup. Consumers register from
 * `onModuleInit`, so the catalog is complete before the first request is
 * served; the llm module itself never hardcodes the scopes it serves.
 */
@Injectable()
export class LlmScopeCatalog {
  private readonly definitions = new Map<string, LlmScopeDefinition>();

  register(definition: LlmScopeDefinition): void {
    const existing = this.definitions.get(definition.scope);
    if (existing) {
      throw new Error(
        `LLM scope "${definition.scope}" is already registered as "${existing.label}"; ` +
          "two consumers cannot share one scope.",
      );
    }
    this.definitions.set(definition.scope, definition);
  }

  /** Every registered scope, ordered by scope for stable API and UI output. */
  list(): LlmScopeDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.scope.localeCompare(b.scope));
  }

  has(scope: string): boolean {
    return this.definitions.has(scope);
  }

  /** Catalog label, or the raw scope for rows left behind by a removed consumer. */
  labelOf(scope: string): string {
    return this.definitions.get(scope)?.label ?? scope;
  }
}
