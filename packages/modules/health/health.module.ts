import { Global, Module } from "@nestjs/common";

import { InstallationKindRegistry, InstallationKindWire } from "@modules/security/installation/installation-kind";
import { InstallationController } from "./controllers/installation.controller";
import { SnapshotController } from "./controllers/snapshot.controller";
import {
  HealthInstallationService,
  ONLINE_THRESHOLD_SECONDS,
  SNAPSHOT_INTERVAL_SECONDS,
} from "./services/installation.service";

/**
 * Health — dependency health plane for deployment endpoints.
 *
 * - InstallationController: host integration (installation lifecycle).
 *   Protected by the host's own auth.
 * - SnapshotController: token-only open endpoint where running processes
 *   report dependency health snapshots (aggregated status + per-indicator
 *   results).
 *
 * Cross-cutting by design: a newbie backend, a fewbie SSR process, or any
 * other node service can each hold a health token independently of
 * backend-monitor / module-hub.
 */
@Global()
@Module({
  controllers: [InstallationController, SnapshotController],
  providers: [HealthInstallationService],
  exports: [HealthInstallationService],
})
export class HealthModule {
  constructor(registry: InstallationKindRegistry) {
    // Declare this collector's kind once (ADR-078 decision 3). Security
    // executes the declaration and holds no health-specific constant.
    registry.register({
      kind: InstallationKindWire.HEALTH,
      endpoint: "/health/snapshot",
      reportIntervalSeconds: SNAPSHOT_INTERVAL_SECONDS,
      offlineAfterSeconds: ONLINE_THRESHOLD_SECONDS,
      requiresAppKey: false,
      budget: { perKey: { points: 120, durationSeconds: 60 }, scope: "token" },
      legacyHeader: "x-health-token",
    });
  }
}
