import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InstallationAuditEvent, InstallationAuditParams } from "./installation-credential.audit";
import {
  INSTALLATION_TOKEN_PATTERN,
  InstallationCredentialStore,
  generateInstallationToken,
  hashInstallationToken,
  isInstallationTokenWellFormed,
  issueInstallationCredential,
  restoreInstallationCredential,
  revokeInstallationCredential,
  rotateInstallationCredential,
} from "./installation-credential";

interface FakeRow {
  id: string;
  label: string;
  tokenHash: string;
  revokedAt: Date | null;
}

class FakeStore implements InstallationCredentialStore<{ label: string }, FakeRow> {
  readonly rows: FakeRow[] = [];
  private nextId = 1;

  async create(draft: { label: string; tokenHash: string }): Promise<FakeRow> {
    const row: FakeRow = { id: `row-${this.nextId++}`, revokedAt: null, ...draft };
    this.rows.push(row);
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<FakeRow | null> {
    return this.rows.find((row) => row.tokenHash === tokenHash) ?? null;
  }

  async replaceTokenHash(id: string, tokenHash: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);
    assert.ok(row, `row ${id} missing`);
    row.tokenHash = tokenHash;
  }

  async setRevokedAt(id: string, revokedAt: Date | null): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);
    assert.ok(row, `row ${id} missing`);
    row.revokedAt = revokedAt;
  }
}

interface RecordedEvent {
  event: string;
  params: InstallationAuditParams;
}

class FakeAudit {
  readonly events: RecordedEvent[] = [];

  async record(event: string, params: InstallationAuditParams): Promise<void> {
    this.events.push({ event, params });
  }
}

function auditContext(audit: FakeAudit, actorId?: string) {
  return { recorder: audit, resourceType: "fake-installation", actorId, detail: { label: "fake" } };
}

describe("installation credential primitives (ADR-019)", () => {
  it("generates UUID-shaped, unique tokens", () => {
    const first = generateInstallationToken();
    const second = generateInstallationToken();
    assert.match(first, INSTALLATION_TOKEN_PATTERN);
    assert.notEqual(first, second);
  });

  it("accepts only UUID-shaped tokens", () => {
    assert.equal(isInstallationTokenWellFormed(generateInstallationToken()), true);
    assert.equal(isInstallationTokenWellFormed("not-a-token"), false);
    assert.equal(isInstallationTokenWellFormed(""), false);
    assert.equal(isInstallationTokenWellFormed("00000000-0000-0000-0000-00000000000z"), false);
  });

  it("hashes deterministically to a SHA-256 hex digest", () => {
    const token = generateInstallationToken();
    const hash = hashInstallationToken(token);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashInstallationToken(token));
    assert.notEqual(hash, hashInstallationToken(generateInstallationToken()));
  });

  it("issues a credential: stores only the hash and audits the enrollment", async () => {
    const store = new FakeStore();
    const audit = new FakeAudit();

    const { record, token } = await issueInstallationCredential(store, { label: "api" }, auditContext(audit, "user-1"));

    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].tokenHash, hashInstallationToken(token));
    assert.notEqual(store.rows[0].tokenHash, token);
    assert.equal(record.id, store.rows[0].id);
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0].event, InstallationAuditEvent.ENROLL);
    assert.equal(audit.events[0].params.resourceId, record.id);
    assert.equal(audit.events[0].params.resourceType, "fake-installation");
    assert.equal(audit.events[0].params.actorId, "user-1");
    assert.deepEqual(audit.events[0].params.detail, { label: "fake" });
  });

  it("leaves the actor id empty when none is supplied", async () => {
    const store = new FakeStore();
    const audit = new FakeAudit();

    await issueInstallationCredential(store, { label: "api" }, auditContext(audit));

    assert.equal(audit.events[0].params.actorId, null);
    assert.equal(audit.events[0].params.actorType, "host");
  });

  it("rotates a token: the old hash stops resolving immediately", async () => {
    const store = new FakeStore();
    const audit = new FakeAudit();
    const { record, token: firstToken } = await issueInstallationCredential(
      store,
      { label: "api" },
      auditContext(audit),
    );

    const { token: secondToken } = await rotateInstallationCredential(store, record.id, auditContext(audit));

    assert.notEqual(secondToken, firstToken);
    assert.equal(await store.findByTokenHash(hashInstallationToken(firstToken)), null);
    assert.equal((await store.findByTokenHash(hashInstallationToken(secondToken)))?.id, record.id);
    assert.deepEqual(
      audit.events.map((event) => event.event),
      [InstallationAuditEvent.ENROLL, InstallationAuditEvent.ROTATE],
    );
    assert.equal(audit.events[1].params.resourceId, record.id);
  });

  it("revokes like a soft delete: the row survives and is audited", async () => {
    const store = new FakeStore();
    const audit = new FakeAudit();
    const { record, token } = await issueInstallationCredential(store, { label: "api" }, auditContext(audit));

    const result = await revokeInstallationCredential(store, record.id, auditContext(audit));

    assert.deepEqual(result, { id: record.id, revoked: true });
    assert.equal(store.rows.length, 1);
    assert.notEqual(store.rows[0].revokedAt, null);
    assert.equal(store.rows[0].tokenHash, hashInstallationToken(token));
    assert.equal(audit.events[1].event, InstallationAuditEvent.REVOKE);
  });

  it("restores a revoked installation and audits it", async () => {
    const store = new FakeStore();
    const audit = new FakeAudit();
    const { record } = await issueInstallationCredential(store, { label: "api" }, auditContext(audit));
    await revokeInstallationCredential(store, record.id, auditContext(audit));

    const result = await restoreInstallationCredential(store, record.id, auditContext(audit));

    assert.deepEqual(result, { id: record.id, revoked: false });
    assert.equal(store.rows[0].revokedAt, null);
    assert.equal(audit.events[2].event, InstallationAuditEvent.RESTORE);
  });
});
