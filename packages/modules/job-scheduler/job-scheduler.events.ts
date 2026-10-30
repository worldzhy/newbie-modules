import { defineEvent } from "@modules/event-emitter/event-definition";
import type { JobTrigger } from "./scheduler/job-scheduler.service";

/// Emitted after a job run is persisted with status "failed". The scheduler
/// stays decoupled from notification-center; application-layer listeners turn
/// this event into notifications.
export const JOB_RUN_FAILED_EVENT = "job-scheduler.run-failed";

export interface JobRunFailedEvent {
  runId: number;
  scheduleId: number;
  scheduleKey: string;
  handlerKey: string;
  trigger: JobTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error: string;
}

const JOB_RUN_FAILED = defineEvent<JobRunFailedEvent>({
  key: JOB_RUN_FAILED_EVENT,
  name: "Job run failed",
  description: "Emitted after a scheduled or manual job run is persisted with status failed.",
  payloadExample: {
    runId: 42,
    scheduleId: 7,
    scheduleKey: "report.daily",
    handlerKey: "report.run",
    trigger: "schedule",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:05.000Z",
    durationMs: 5000,
    error: "connect ETIMEDOUT 10.0.0.1:443",
  },
});

/// The module's full event contract, activated by the host's
/// event-declarations wiring (ADR-028). Never self-registered here.
export const jobSchedulerEventDeclarations = [JOB_RUN_FAILED];
