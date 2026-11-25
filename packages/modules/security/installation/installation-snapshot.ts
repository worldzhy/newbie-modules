import { Installation } from "@generated/prisma/client";
import { InstallationKindDescriptor, InstallationKindValue, installationKindToWire } from "./installation-kind";

/**
 * What a reporter last said about itself (ADR-078). "degraded" carries its
 * indicators, so an illegal "healthy with indicators" value cannot be built.
 */
export type ReportedLiveness =
  { state: "healthy" } | { state: "degraded"; downIndicators: string[] } | { state: "offline" };

/**
 * Kind-agnostic lifecycle read model (ADR-078 decision 4). There is no
 * per-kind optional field: every collector renders the same four cases.
 */
export type InstallationSnapshot =
  | { lifecycle: "NOT_ENABLED" }
  | { lifecycle: "PENDING"; issuedAt: string }
  | { lifecycle: "ACTIVE"; firstSeenAt: string; lastSeenAt: string; liveness: ReportedLiveness }
  | { lifecycle: "DISABLED"; revokedAt: string; firstSeenAt?: string; lastSeenAt?: string };

/** Identity facts of one installation, safe to expose (no credential material). */
export interface InstallationIdentity {
  kind: InstallationKindValue;
  label: string;
  appKey?: string;
  tokenFingerprint: string;
}

export interface SnapshotOptions {
  descriptor: InstallationKindDescriptor;
  /** Dependency indicators currently down, when the collector reports them. */
  downIndicators?: string[];
  now?: number;
}

/**
 * Derive the lifecycle snapshot of an installation. `NOT_ENABLED` is returned
 * by the host when no row exists; this function never produces it.
 */
export function deriveInstallationSnapshot(
  installation: Installation,
  options: SnapshotOptions,
): Exclude<InstallationSnapshot, { lifecycle: "NOT_ENABLED" }> {
  if (installation.revokedAt) {
    const disabled: InstallationSnapshot = { lifecycle: "DISABLED", revokedAt: installation.revokedAt.toISOString() };
    if (installation.firstSeenAt) disabled.firstSeenAt = installation.firstSeenAt.toISOString();
    if (installation.lastSeenAt) disabled.lastSeenAt = installation.lastSeenAt.toISOString();
    return disabled as Exclude<InstallationSnapshot, { lifecycle: "NOT_ENABLED" }>;
  }

  if (!installation.lastSeenAt) {
    return { lifecycle: "PENDING", issuedAt: installation.issuedAt.toISOString() };
  }

  return {
    lifecycle: "ACTIVE",
    firstSeenAt: (installation.firstSeenAt ?? installation.lastSeenAt).toISOString(),
    lastSeenAt: installation.lastSeenAt.toISOString(),
    liveness: deriveReportedLiveness(installation.lastSeenAt, options),
  };
}

function deriveReportedLiveness(lastSeenAt: Date, options: SnapshotOptions): ReportedLiveness {
  const now = options.now ?? Date.now();
  const silentMs = now - lastSeenAt.getTime();
  if (silentMs > options.descriptor.offlineAfterSeconds * 1000) {
    return { state: "offline" };
  }
  if (options.downIndicators && options.downIndicators.length > 0) {
    return { state: "degraded", downIndicators: [...options.downIndicators] };
  }
  return { state: "healthy" };
}

/** Identity projection of an installation row. */
export function deriveInstallationIdentity(installation: Installation): InstallationIdentity {
  const identity: InstallationIdentity = {
    kind: installationKindToWire(installation.kind),
    label: installation.label,
    tokenFingerprint: installation.tokenFingerprint,
  };
  if (installation.appKey) identity.appKey = installation.appKey;
  return identity;
}
