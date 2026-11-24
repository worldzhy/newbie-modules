import { Request } from "express";

/**
 * Source IP of a report request, for the per-IP installation budget (ADR-079).
 *
 * The headers are only trusted when the host sets
 * `security.installation.trustedProxy` (env SECURITY_INSTALLATION_TRUSTED_PROXY): the
 * deployment terminates client connections at a proxy that overwrites both
 * headers. When that guarantee is absent, reading them would let any caller
 * choose its own quota bucket, so the socket address is used instead. The
 * ownership of this parsing lives in security; collector modules do not
 * re-implement it.
 */
export function resolveInstallationSourceIp(req: Request, trustedProxy: boolean): string | undefined {
  if (trustedProxy) {
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.trim()) return realIp.trim();

    const forwarded = req.headers["x-forwarded-for"];
    const forwardedRaw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof forwardedRaw === "string") {
      const first = forwardedRaw.split(",")[0]?.trim();
      if (first) return first;
    }
  }

  return req.socket?.remoteAddress;
}
