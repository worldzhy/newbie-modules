import { BadRequestException } from "@nestjs/common";
import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

/**
 * SSRF guard for administrator-supplied LLM endpoints (R20-37). The base URL
 * is fetched server-side, so a value pointing at loopback, a private network or
 * the cloud metadata address turns the LLM client into an internal request
 * proxy. Admin-only write access lowers the severity but not the blast radius.
 *
 * The check resolves every address the hostname returns and requires all of
 * them to be public. Residual DNS-rebinding TOCTOU remains (the HTTP client
 * resolves again), matching the accepted trade-off documented for url-monitor.
 */

const BLOCKED = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(address, prefix, "ipv4");
}
BLOCKED.addAddress("::", "ipv6");
BLOCKED.addAddress("::1", "ipv6");
BLOCKED.addSubnet("fe80::", 10, "ipv6");
BLOCKED.addSubnet("fc00::", 7, "ipv6");
// IPv4-compatible (::/96) and NAT64 (64:ff9b::/96) forms embed an IPv4
// address the ::ffff: strip above does not reach, e.g. ::7f00:1.
BLOCKED.addSubnet("::", 96, "ipv6");
BLOCKED.addSubnet("64:ff9b::", 96, "ipv6");

function isPublicAddress(rawAddress: string): boolean {
  const address = rawAddress.trim().replace(/^::ffff:/i, "");
  const family = isIP(address);
  if (family === 0) return false;
  return !BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Validates an LLM base URL before it is persisted or probed. Rejects
 * non-http(s) protocols, internal hostnames and literal/resolved addresses in
 * blocked ranges.
 */
export async function assertSafeBaseUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException(`Invalid LLM base URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestException(`LLM base URL must use http(s): ${rawUrl}`);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new BadRequestException(`LLM base URL host is internal: ${hostname}`);
  }
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new BadRequestException(`LLM base URL host is not public: ${hostname}`);
    }
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (error) {
    throw new BadRequestException(`LLM base URL host cannot be resolved: ${hostname} (${getErrorMessage(error)})`);
  }
  const blocked = addresses.find(({ address }) => !isPublicAddress(address));
  if (blocked) {
    throw new BadRequestException(`LLM base URL host ${hostname} resolves to non-public address ${blocked.address}`);
  }
}
