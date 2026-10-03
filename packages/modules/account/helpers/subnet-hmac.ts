import { createHmac } from "node:crypto";

/**
 * Deterministic keyed hash of an anonymized subnet.
 *
 * Unlike the bcrypt value stored in ApprovedSubnet.subnet — which is
 * randomized per write and only verifiable through a full scan — an HMAC is
 * comparable, so a login-time check resolves in one indexed lookup.
 */
export function computeSubnetHmac(params: { subnet: string; secret: string }): string {
  return createHmac("sha256", params.secret).update(params.subnet).digest("hex");
}
