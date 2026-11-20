import type {
  PenetrationTestingBudget,
  PenetrationTestingEnvironment,
  PenetrationTestingExecutionOutcome,
  PenetrationTestingLevel,
  PenetrationTestingTestObjectKind,
} from "../penetration-testing.constants";

/**
 * Value shapes shared by the three host ports of penetration-testing
 * (ADR-075 §5). They describe target semantics and engine-neutral observations
 * only: no engine name, image, proxy address or credential ever crosses this
 * boundary. The host owns resolution, SSRF checks, containers and egress.
 */

/** The normalized target a run may touch. */
export interface PenetrationTestingTargetDescriptor {
  /** Canonical origin (`scheme://host[:port]`), same normalization as web-origin. */
  origin: string;
  /** Ports the authorization declares; empty means the scheme default. */
  ports: number[];
  /** Role → relative path, resolved from the asset material. */
  pathRoles: Record<string, string>;
  environment: PenetrationTestingEnvironment;
}

/** What the host actually resolved and ran, captured before execution starts. */
export interface PenetrationTestingExecutionSnapshot {
  host: string;
  resolvedIps: string[];
  ports: number[];
  resolvedAt: string;
  proxyPolicyId: string;
  engineVersions: Record<string, string>;
}

/** One raw engine finding, before criterion mapping and severity normalization. */
export interface PenetrationTestingEngineFinding {
  engine: string;
  engineVersion: string;
  ruleId: string;
  ruleName?: string;
  /** Engine-native severity label (e.g. "medium", "High", "3"). */
  severityRaw: string;
  /** CVSS base score when the engine provides one. */
  cvssScore?: number;
  title: string;
  detail?: string;
  /** Stable location inside the target, e.g. "https://host/login?q=". */
  location: string;
  evidenceRefs?: string[];
  /** Engine tags, used by the deterministic criterion mapping. */
  tags?: string[];
}

/** One engine-neutral observation the judgment may consume as evidence. */
export interface PenetrationTestingObservation {
  id: string;
  summary: string;
  payload?: Record<string, unknown>;
}

export interface PenetrationTestingExecutionFacts {
  snapshot: PenetrationTestingExecutionSnapshot;
  engineVersions: Record<string, string>;
  requestCount: number;
  outcome: PenetrationTestingExecutionOutcome;
}

/** A scan request for L1–L3; L4 uses the destructive-action port instead. */
export interface PenetrationTestingScanRequest {
  target: PenetrationTestingTargetDescriptor;
  level: PenetrationTestingLevel;
  standardKey: string;
  /** Approved authorization row id; the host records it in the snapshot. */
  authorizationRef: string;
  budget: PenetrationTestingBudget;
}

export interface PenetrationTestingScanResult {
  execution: PenetrationTestingExecutionFacts;
  observations: PenetrationTestingObservation[];
  findings: PenetrationTestingEngineFinding[];
}

/** The L4 object a playbook may destroy; approved and disposable by contract. */
export interface PenetrationTestingTestObjectDescriptor {
  kind: PenetrationTestingTestObjectKind;
  locator: Record<string, unknown>;
  cleanupLocator?: Record<string, unknown> | null;
}

export interface PenetrationTestingDestructiveActionRequest {
  target: PenetrationTestingTargetDescriptor;
  playbookId: string;
  playbookVersion: string;
  testObject: PenetrationTestingTestObjectDescriptor;
  /** Approved authorization row id; re-read by the module before execution. */
  authorizationRef: string;
  /** Unique marker of this action, used to locate and clean up its effects. */
  marker: string;
  budget: PenetrationTestingBudget;
}

export interface PenetrationTestingDestructiveActionResult {
  execution: PenetrationTestingExecutionFacts;
  /** State observed before the action, as the host recorded it. */
  before: string;
  /** State observed after the action. */
  after: string;
  cleanup: { attempted: boolean; succeeded: boolean; detail?: string };
  evidenceRefs: string[];
  outcome: "SUCCEEDED" | "FAILED" | "KILLED" | "CLEANUP_FAILED";
  /** Raw engine findings produced while proving the impact, if any. */
  findings?: PenetrationTestingEngineFinding[];
}
