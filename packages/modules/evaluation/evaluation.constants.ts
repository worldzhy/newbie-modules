import { EvaluationRunStatus } from "@generated/prisma/client";

/**
 * Statuses that mean a run is still in flight. Shared by the run service and
 * the result service so both `in` filters and `includes` checks read the same
 * definition — the run lifecycle has exactly one set of open statuses.
 */
export const ACTIVE_RUN_STATUSES: EvaluationRunStatus[] = [EvaluationRunStatus.QUEUED, EvaluationRunStatus.RUNNING];
