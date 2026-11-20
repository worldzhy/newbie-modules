import type { PenetrationTestingScanRequest, PenetrationTestingScanResult } from "./penetration-testing.contracts";

/**
 * PenetrationScannerAccess — the host-provided executor of L1–L3 scans
 * (ADR-075 §5).
 *
 * The module states only the target semantics and the budget; it performs no
 * network I/O, holds no URL allowlist and resolves no DNS. The host owns the
 * temporary container, the egress proxy, the engine set and the kill switch.
 *
 * L4 never calls this port: destructive actions have their own single-action
 * port, so a bulk scan cannot reach a write path by type.
 */
export const PENETRATION_TESTING_SCANNER_ACCESS = "PENETRATION_TESTING_SCANNER_ACCESS";

export interface PenetrationTestingScannerAccess {
  scan(request: PenetrationTestingScanRequest): Promise<PenetrationTestingScanResult>;
}
