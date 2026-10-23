import { BadRequestException } from "@nestjs/common";
import { promises as dns, type LookupAddress } from "node:dns";
import { isIP } from "node:net";

/**
 * SSRF guard for url-monitor probes (ADR-022 follow-up). Targets are
 * user-supplied URLs fetched server-side; without an address-family check the
 * probe becomes an internal network oracle (status + timing), and on cloud
 * hosts can reach the link-local metadata endpoint. The guard therefore only
 * allows http(s) URLs whose host is a public address.
 *
 * Two layers, applied at different moments:
 *
 * - assertPublicHttpUrl: synchronous, used when a target is written. Rejects
 *   non-http(s) protocols and literal IPs in blocked ranges. Hostnames pass
 *   here because their DNS answer can legitimately change over time.
 * - assertPubliclyResolvable: async, used at probe time (and once per redirect
 *   hop). Resolves the hostname and requires every returned address to be
 *   public. This is the security boundary; the write-time check is only early
 *   feedback.
 *
 * There is an inherent TOCTOU window between this lookup and the DNS lookup
 * performed by fetch itself (DNS rebinding). Closing it would require pinning
 * the connection to the validated address, which fetch cannot express for
 * https; the residual risk is accepted for an authenticated, project-scoped
 * feature.
 */

const BLOCKED_IPV4_RANGES: ReadonlyArray<{ base: number; prefix: number }> = [
  { base: 0x00000000, prefix: 8 }, // 0.0.0.0/8 "this network"
  { base: 0x0a000000, prefix: 8 }, // 10.0.0.0/8 private
  { base: 0x64400000, prefix: 10 }, // 100.64.0.0/10 shared address space
  { base: 0x7f000000, prefix: 8 }, // 127.0.0.0/8 loopback
  { base: 0xa9fe0000, prefix: 16 }, // 169.254.0.0/16 link-local (cloud metadata)
  { base: 0xac100000, prefix: 12 }, // 172.16.0.0/12 private
  { base: 0xc0a80000, prefix: 16 }, // 192.168.0.0/16 private
  { base: 0xe0000000, prefix: 4 }, // 224.0.0.0/4 multicast
  { base: 0xf0000000, prefix: 4 }, // 240.0.0.0/4 reserved
];

function parseIpv4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** True when the IPv4/IPv6 address (already parsed, brackets stripped) is not public. */
export function isBlockedAddress(rawAddress: string): boolean {
  const version = isIP(rawAddress);
  if (version === 4) {
    const value = parseIpv4(rawAddress);
    if (value === null) return true;
    return BLOCKED_IPV4_RANGES.some(({ base, prefix }) => {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return (value & mask) === (base & mask);
    });
  }
  if (version === 6) {
    const normalized = rawAddress.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    // IPv4-mapped IPv6 ("::ffff:127.0.0.1") is judged by the embedded IPv4.
    // Both the compressed and the expanded form occur in the wild.
    for (const prefix of ["::ffff:", "0:0:0:0:0:ffff:"]) {
      if (normalized.startsWith(prefix)) {
        return isBlockedAddress(normalized.slice(prefix.length));
      }
    }
    const firstHextet = parseInt(normalized.split(":")[0] || "0", 16);
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    return false;
  }
  return true;
}

/** Strips the brackets WHATWG URL keeps around IPv6 hostnames. */
function urlHost(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, "$1");
}

/** Write-time validation: http(s) only, literal IPs must be public. */
export function assertPublicHttpUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestException(`Only http(s) URLs can be monitored: ${rawUrl}`);
  }
  const host = urlHost(parsed);
  if (isIP(host) && isBlockedAddress(host)) {
    throw new BadRequestException(`URL host is not a public address: ${host}`);
  }
}

/**
 * Probe-time validation: every address the hostname resolves to must be
 * public. Throws Error (not BadRequestException): at probe time a blocked
 * resolution is a check failure, recorded like any other outage cause.
 */
export async function assertPubliclyResolvable(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  const host = urlHost(parsed);
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error(`Probe blocked: ${host} is not a public address`);
    }
    return;
  }
  const addresses = (await dns.lookup(host, { all: true })) as LookupAddress[];
  const blocked = addresses.find(({ address }) => isBlockedAddress(address));
  if (blocked) {
    throw new Error(`Probe blocked: ${host} resolves to non-public address ${blocked.address}`);
  }
}
