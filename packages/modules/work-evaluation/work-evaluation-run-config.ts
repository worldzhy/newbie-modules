import { WorkEvaluationPhaseBudget } from "./work-evaluation-judgment.prompt";

/**
 * Config contract violation on a runConfig key this feature owns. The
 * readers run inside the detached judgment execution, so the error surfaces
 * as a FAILED run row rather than an HTTP status; keeping the class local
 * also keeps this module free of runtime dependencies.
 */
export class WorkEvaluationRunConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkEvaluationRunConfigError";
  }
}

/**
 * runConfig.periodId — the collection period a work-evaluation run judges
 * (ADR-026). The skeleton threads run config verbatim; this feature owns the
 * `periodId` key. Missing periodId fails fast rather than silently judging
 * against no window.
 */
export function readPeriodId(runConfig: Record<string, unknown> | null | undefined): string | null {
  const periodId = runConfig?.periodId;
  if (periodId === undefined || periodId === null) return null;
  if (typeof periodId !== "string" || !periodId.trim()) {
    throw new WorkEvaluationRunConfigError('run config "periodId" must be a non-empty string');
  }
  return periodId;
}

export function requirePeriodId(runConfig: Record<string, unknown> | null | undefined): string {
  const periodId = readPeriodId(runConfig);
  if (!periodId) {
    throw new WorkEvaluationRunConfigError(
      'run config "periodId" is required: open work-evaluation runs with a period',
    );
  }
  return periodId;
}

/**
 * runConfig.modelScope picks the llm scope this run judges with (ADR-023).
 * Absent key falls back to the feature default; a present key with a wrong
 * type fails fast — config errors must fail the run loudly on the run row
 * instead of silently judging with defaults (ADR-029).
 */
export function readScopeOverride(runConfig: Record<string, unknown> | null): string | undefined {
  const scope = runConfig?.modelScope;
  if (scope === undefined || scope === null) return undefined;
  if (typeof scope !== "string" || !scope.trim()) {
    throw new WorkEvaluationRunConfigError('run config "modelScope" must be a non-empty string');
  }
  return scope;
}

/**
 * runConfig.budget overrides per-phase token budgets (small knobs only).
 * Per-phase values follow the same contract as modelScope: absent falls back
 * to the phase default, present-but-invalid fails fast.
 */
export function readBudgetOverride(runConfig: Record<string, unknown> | null): Partial<WorkEvaluationPhaseBudget> {
  const budget = runConfig?.budget;
  if (budget === undefined || budget === null) return {};
  if (typeof budget !== "object" || Array.isArray(budget)) {
    throw new WorkEvaluationRunConfigError('run config "budget" must be an object keyed by phase');
  }
  const record = budget as Record<string, unknown>;
  const override: Partial<WorkEvaluationPhaseBudget> = {};
  for (const phase of ["advocate", "skeptic", "synthesis"] as const) {
    const value = record[phase];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new WorkEvaluationRunConfigError(`run config "budget.${phase}" must be a positive finite number`);
    }
    override[phase] = value;
  }
  return override;
}
