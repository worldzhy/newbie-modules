import { BlockList, isIP } from "node:net";

/**
 * API key network restrictions (R20-10). The columns were stored but never
 * checked, so a key marked "only from these addresses / origins" worked from
 * anywhere. Matching lives in this pure module so it is unit-testable without
 * Nest, Prisma or an HTTP request.
 */

/** Coerce a Prisma Json column into the string array the DTO declares. */
export function normalizeRestrictions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function buildIpList(entries: string[]): BlockList | null {
  const list = new BlockList();
  let added = 0;
  for (const raw of entries) {
    const [address, prefix] = raw.trim().split("/");
    const family = isIP(address);
    if (family === 0) continue;
    const familyName = family === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) {
      list.addAddress(address, familyName);
      added += 1;
      continue;
    }
    const bits = Number(prefix);
    const maxBits = family === 4 ? 32 : 128;
    if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) continue;
    list.addSubnet(address, bits, familyName);
    added += 1;
  }
  return added > 0 ? list : null;
}

/**
 * True when the client address falls inside any entry. Entries are exact IPs
 * or CIDR blocks; malformed entries are ignored (an empty effective list means
 * "no restriction", not "deny everyone").
 */
export function matchesIpRestriction(clientIp: string | undefined, entries: string[]): boolean {
  if (!clientIp) return false;
  const list = buildIpList(entries);
  if (!list) return false;
  // Express reports IPv4 peers as "::ffff:1.2.3.4" when the socket is IPv6.
  const normalized = clientIp.trim().replace(/^::ffff:/i, "");
  const family = isIP(normalized);
  if (family === 0) return false;
  return list.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

/**
 * True when the request origin/referrer matches any entry. An entry is either
 * a full origin ("https://app.example.com", compared exactly), a hostname
 * ("app.example.com"), or a wildcard hostname ("*.example.com", which matches
 * subdomains but not the bare domain).
 */
export function matchesReferrerRestriction(
  origin: string | undefined,
  referrer: string | undefined,
  entries: string[],
): boolean {
  const candidate = (origin || referrer || "").trim();
  if (!candidate) return false;
  let candidateHost: string;
  try {
    candidateHost = new URL(candidate).hostname.toLowerCase();
  } catch {
    return false;
  }
  const candidateOrigin = (() => {
    try {
      return new URL(candidate).origin.toLowerCase();
    } catch {
      return "";
    }
  })();

  return entries.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (entry.includes("://")) {
      try {
        return new URL(entry).origin.toLowerCase() === candidateOrigin;
      } catch {
        return false;
      }
    }
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1);
      return candidateHost.endsWith(suffix) && candidateHost !== suffix.slice(1);
    }
    return candidateHost === entry;
  });
}
