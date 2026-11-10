import { UnauthorizedException } from "@nestjs/common";
import { InstallationCredentialRecord } from "./installation-credential";
import { InstallationTokenVerifier } from "./installation-token.verifier";

/**
 * Shared base for installation services that authenticate report tokens
 * (ADR-042). Holds the two copy-paste methods every collector had to write:
 *
 *   - resolveByToken(token): null when unknown or revoked (indistinguishable)
 *   - resolve(token):          throws UnauthorizedException on unknown/revoked
 *
 * The subclass only has to declare a protected tokenVerifier field with the
 * module's installation generic. The verifier is already the single source for
 * token format + SHA-256 + revocation semantics (ADR-019).
 *
 * Only A-layer concrete installation services use this. B-layer resolver
 * classes (FrontendMonitorTokenResolver, MonitorTokenResolver, ...) still own their own
 * resolve() because they return trimmed DTOs with module-specific fields.
 */
export abstract class BaseInstallationService<Installation extends InstallationCredentialRecord> {
  protected abstract readonly tokenVerifier: InstallationTokenVerifier<Installation>;

  constructor() {}

  /** Look up a non-revoked installation by plaintext token. Unknown and revoked both return null. */
  async resolveByToken(token: string): Promise<Installation | null> {
    return this.tokenVerifier.verify(token);
  }

  /**
   * Port contract (ADR-016): authenticate a report token for
   * InstallationAuthGuard. Unknown and revoked stay indistinguishable to the
   * caller so it cannot probe which case happened.
   */
  async resolve(token: string): Promise<Installation> {
    const installation = await this.resolveByToken(token);
    if (!installation) {
      throw new UnauthorizedException("Invalid or revoked installation token.");
    }
    return installation;
  }
}
