import { createHash, randomUUID } from "node:crypto";

import { InstallationAuditEvent, InstallationAuditRecorder } from "./installation-credential.audit";

/**
 * Canonical UUID format of installation tokens. Enforced before any storage
 * lookup so malformed traffic against the open report endpoints never reaches
 * the database.
 */
export const INSTALLATION_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generate a fresh plaintext installation token. This is the only token
 * generator in the registry (ADR-019): collectors must not mint their own, so
 * format, entropy and hashing stay in one place.
 */
export function generateInstallationToken(): string {
  return randomUUID();
}

/** SHA-256 hex digest stored in the collector's `tokenHash` column. */
export function hashInstallationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** True when the value can be an installation token at all. */
export function isInstallationTokenWellFormed(token: string): boolean {
  return INSTALLATION_TOKEN_PATTERN.test(token);
}

/** Columns every installation credential row exposes. */
export interface InstallationCredentialRecord {
  id: string;
  revokedAt: Date | null;
}

/** Read side of the collector's installation table. */
export interface InstallationCredentialLookup<TRow extends InstallationCredentialRecord> {
  findByTokenHash(tokenHash: string): Promise<TRow | null>;
}

/** Write side of the collector's installation table. */
export interface InstallationCredentialLifecycle {
  replaceTokenHash(id: string, tokenHash: string): Promise<void>;
  setRevokedAt(id: string, revokedAt: Date | null): Promise<void>;
}

/**
 * The four-method adapter each collector implements over its own installation
 * table (ADR-019). Domain columns live in the draft type; the credential
 * mechanism (generation, hashing, lifecycle, audit) lives here.
 */
export interface InstallationCredentialStore<TDraft, TRow extends InstallationCredentialRecord>
  extends InstallationCredentialLookup<TRow>, InstallationCredentialLifecycle {
  create(draft: TDraft & { tokenHash: string }): Promise<TRow>;
}

/** Who triggered a lifecycle change, and which resource it applies to. */
export interface InstallationCredentialAudit {
  readonly recorder: InstallationAuditRecorder;
  /** Audit resource type, e.g. "heartbeat-installation". */
  readonly resourceType: string;
  /** Acting user id; omitted for provisioning/system-originated changes. */
  readonly actorId?: string | null;
}

/** Enrollment additionally records the draft context (e.g. label, externalRef). */
export interface InstallationEnrollAudit extends InstallationCredentialAudit {
  readonly detail?: Record<string, unknown>;
}

/** Actor type used for host-triggered installation lifecycle rows. */
const INSTALLATION_ACTOR_TYPE = "host";

/**
 * Enroll a new installation: generate a token, persist only its hash, and
 * audit the enrollment. The plaintext token is returned once.
 */
export async function issueInstallationCredential<TDraft, TRow extends InstallationCredentialRecord>(
  store: InstallationCredentialStore<TDraft, TRow>,
  draft: TDraft,
  audit: InstallationEnrollAudit,
): Promise<{ record: TRow; token: string }> {
  const token = generateInstallationToken();
  const record = await store.create({ ...draft, tokenHash: hashInstallationToken(token) });
  await audit.recorder.record(InstallationAuditEvent.ENROLL, {
    resourceType: audit.resourceType,
    resourceId: record.id,
    actorType: INSTALLATION_ACTOR_TYPE,
    actorId: audit.actorId ?? null,
    detail: audit.detail,
  });
  return { record, token };
}

/**
 * Rotate a token: the previous hash stops working on the next request (no
 * positive caches anywhere, ADR-019 decision 2). The plaintext token is
 * returned once.
 */
export async function rotateInstallationCredential(
  store: InstallationCredentialLifecycle,
  id: string,
  audit: InstallationCredentialAudit,
): Promise<{ id: string; token: string }> {
  const token = generateInstallationToken();
  await store.replaceTokenHash(id, hashInstallationToken(token));
  await audit.recorder.record(InstallationAuditEvent.ROTATE, {
    resourceType: audit.resourceType,
    resourceId: id,
    actorType: INSTALLATION_ACTOR_TYPE,
    actorId: audit.actorId ?? null,
  });
  return { id, token };
}

/**
 * Soft-revoke: the row is retained (audit trail) and every subsequent request
 * presenting the token is rejected.
 */
export async function revokeInstallationCredential(
  store: InstallationCredentialLifecycle,
  id: string,
  audit: InstallationCredentialAudit,
): Promise<{ id: string; revoked: true }> {
  await store.setRevokedAt(id, new Date());
  await audit.recorder.record(InstallationAuditEvent.REVOKE, {
    resourceType: audit.resourceType,
    resourceId: id,
    actorType: INSTALLATION_ACTOR_TYPE,
    actorId: audit.actorId ?? null,
  });
  return { id, revoked: true };
}

/**
 * Clear the revocation marker (re-enable a soft-revoked installation). The
 * token itself is unchanged, so the previously distributed plaintext becomes
 * valid again on the next request.
 */
export async function restoreInstallationCredential(
  store: InstallationCredentialLifecycle,
  id: string,
  audit: InstallationCredentialAudit,
): Promise<{ id: string; revoked: false }> {
  await store.setRevokedAt(id, null);
  await audit.recorder.record(InstallationAuditEvent.RESTORE, {
    resourceType: audit.resourceType,
    resourceId: id,
    actorType: INSTALLATION_ACTOR_TYPE,
    actorId: audit.actorId ?? null,
  });
  return { id, revoked: false };
}
