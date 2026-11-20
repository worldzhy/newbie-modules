/**
 * Host-side half of gate 1 (ADR-054 D4): `designReference` resolvability and
 * relevance. The task record alone cannot answer whether a design document
 * exists, whether it was superseded, or which repositories it declares — those
 * facts live in the workspace, so the host supplies an adjudicator.
 *
 * Optional by design: a host that does not register one keeps the record-level
 * admission rules only. The token is a symbol so two hosts cannot accidentally
 * share a string identifier.
 */
export const TASK_PLAN_ADJUDICATOR = Symbol("TASK_PLAN_ADJUDICATOR");

export interface PlanAdjudicationInput {
  designReference?: string | null;
  /** Human explanation recorded when the mechanical check cannot decide. */
  designReferenceJustification?: string | null;
  /** `changeImpact.repos` of the task, already normalized to bare repository names. */
  changeImpactRepos: readonly string[];
}

export interface PlanAdjudicationVerdict {
  admitted: boolean;
  violations: string[];
}

export interface TaskPlanAdjudicator {
  adjudicate(input: PlanAdjudicationInput): Promise<PlanAdjudicationVerdict>;
}
