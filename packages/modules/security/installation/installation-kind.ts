import { Injectable, InternalServerErrorException, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InstallationKind } from "@generated/prisma/client";

/**
 * Collector keys that may present an installation token (ADR-078).
 *
 * The values match the `InstallationKind` wire spellings, which are also the
 * database values of `Installation.kind`.
 */
export const InstallationKindWire = {
  HEARTBEAT: "heartbeat",
  HEALTH: "health",
  MODULE_HUB: "module-hub",
  BACKEND_MONITOR: "backend-monitor",
  FRONTEND_MONITOR: "frontend-monitor",
  WORK_EVALUATION: "work-evaluation",
} as const;

export type InstallationKindValue = (typeof InstallationKindWire)[keyof typeof InstallationKindWire];

/**
 * Prisma enum member -> wire value. The enum keeps a typed column in the
 * database while the wire form keeps the established collector keys; this is
 * the one place the two spellings meet.
 */
const PRISMA_ENUM_TO_WIRE: Record<string, InstallationKindValue> = {
  HEARTBEAT: InstallationKindWire.HEARTBEAT,
  HEALTH: InstallationKindWire.HEALTH,
  MODULE_HUB: InstallationKindWire.MODULE_HUB,
  BACKEND_MONITOR: InstallationKindWire.BACKEND_MONITOR,
  FRONTEND_MONITOR: InstallationKindWire.FRONTEND_MONITOR,
  WORK_EVALUATION: InstallationKindWire.WORK_EVALUATION,
};

/** Wire spelling of a Prisma enum value, e.g. MODULE_HUB -> "module-hub". */
export function installationKindToWire(kind: string): InstallationKindValue {
  return PRISMA_ENUM_TO_WIRE[kind] ?? (kind.toLowerCase().replace(/_/g, "-") as InstallationKindValue);
}

/** Prisma enum member for a wire spelling, or undefined for an unknown value. */
export function installationKindFromWire(kind: string): InstallationKind | undefined {
  return (Object.keys(PRISMA_ENUM_TO_WIRE) as InstallationKind[]).find(
    (candidate) => PRISMA_ENUM_TO_WIRE[candidate] === kind,
  );
}

/** One rate-limit window: points allowed per duration. */
export interface InstallationBudgetWindow {
  points: number;
  durationSeconds: number;
}

/**
 * Declaration a collector registers at startup (ADR-078 decision 3, ADR-079).
 *
 * Everything that differs between collectors lives here, so security only has
 * to execute the declaration and never holds a per-kind exception. The
 * collector keeps ownership of its own values; security does not depend on
 * the collector module.
 */
export interface InstallationKindDescriptor {
  readonly kind: InstallationKindValue;
  /** Report endpoint path, e.g. "/heartbeat/ping". Exposed to the host UI. */
  readonly endpoint: string;
  /** Expected interval between reports, in seconds. */
  readonly reportIntervalSeconds: number;
  /** Silence after which the installation is considered offline, in seconds. */
  readonly offlineAfterSeconds: number;
  /** True for frontend-monitor: the installation carries an appKey. */
  readonly requiresAppKey: boolean;
  readonly budget: {
    /** First layer, evaluated before the credential is resolved. */
    readonly perKey: InstallationBudgetWindow;
    /**
     * What identifies the quota subject in the first layer. "token" keys by
     * token hash; "token-and-ip" also keys by source IP, for browser tokens
     * that are public by nature.
     */
    readonly scope: "token" | "token-and-ip";
    /** Second layer, evaluated after the installation is resolved. */
    readonly perInstallationTotal?: InstallationBudgetWindow;
  };
  /** Legacy private header accepted during the SDK migration window. */
  readonly legacyHeader?: string;
  /** Body field carrying the token for sendBeacon-only browser SDKs. */
  readonly bodyTokenField?: string;
}

/**
 * Single registry of kind declarations (ADR-078).
 *
 * Duplicate registration is a programming error and fails startup: letting the
 * last registration win would silently swap a kind's budget or endpoint.
 */
@Injectable()
export class InstallationKindRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger(InstallationKindRegistry.name);
  private readonly descriptors = new Map<string, InstallationKindDescriptor>();

  /**
   * Whether the deployment guarantees that x-real-ip / x-forwarded-for are
   * overwritten by a trusted proxy (ADR-079). False elsewhere, where the
   * socket peer is the only IP the server can believe.
   */
  readonly trustedProxy: boolean;

  constructor(config: ConfigService) {
    this.trustedProxy = config.get<string>("security.installation.trustedProxy") === "true";
  }

  register(descriptor: InstallationKindDescriptor): void {
    const existing = this.descriptors.get(descriptor.kind);
    if (existing) {
      throw new Error(`Installation kind "${descriptor.kind}" is already registered.`);
    }
    this.descriptors.set(descriptor.kind, descriptor);
  }

  /**
   * Descriptor for a kind, or a 500 when the collector module did not load.
   * Failing closed is deliberate: without a descriptor there is no budget and
   * no kind check, so the endpoint must not run unprotected.
   */
  require(kind: string): InstallationKindDescriptor {
    const descriptor = this.descriptors.get(kind);
    if (!descriptor) {
      throw new InternalServerErrorException(
        `@InstallationAuth("${kind}") is active but no kind descriptor is registered. Did the collector module load?`,
      );
    }
    return descriptor;
  }

  get(kind: string): InstallationKindDescriptor | undefined {
    return this.descriptors.get(kind);
  }

  list(): InstallationKindDescriptor[] {
    return [...this.descriptors.values()];
  }

  onApplicationBootstrap(): void {
    const perIpKinds = this.list().filter((descriptor) => descriptor.budget.scope === "token-and-ip");
    if (perIpKinds.length === 0) return;

    // ADR-079: a per-IP budget is only as trustworthy as the source IP. With a
    // trusted proxy the headers are used; without one the socket peer is the
    // only believable address, which is correct for direct connections but
    // collapses every client behind an unconfigured proxy into one bucket.
    if (this.trustedProxy) {
      this.logger.log(`Per-IP installation budget enabled for: ${perIpKinds.map((d) => d.kind).join(", ")}.`);
      return;
    }
    this.logger.warn(
      `Installation kinds ${perIpKinds.map((d) => d.kind).join(", ")} use a per-IP budget with ` +
        "SECURITY_INSTALLATION_TRUSTED_PROXY disabled: x-real-ip / x-forwarded-for are ignored and the socket peer is used. " +
        "Behind a reverse proxy, terminate client connections there and set SECURITY_INSTALLATION_TRUSTED_PROXY=true.",
    );
  }
}
