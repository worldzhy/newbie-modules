import { BadRequestException } from "@nestjs/common";

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
    throw new BadRequestException('run config "periodId" must be a non-empty string');
  }
  return periodId;
}

export function requirePeriodId(runConfig: Record<string, unknown> | null | undefined): string {
  const periodId = readPeriodId(runConfig);
  if (!periodId) {
    throw new BadRequestException('run config "periodId" is required: open work-evaluation runs with a period');
  }
  return periodId;
}
