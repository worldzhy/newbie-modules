import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PrismaInstallationDelegate, prismaInstallationCredentialStore } from "./prisma-installation-credential-store";

interface FakeRow {
  id: string;
  tokenHash: string;
  revokedAt: Date | null;
}

/** Mimics a Prisma model delegate over an in-memory table. */
class FakeDelegate implements PrismaInstallationDelegate<FakeRow> {
  readonly rows: FakeRow[] = [];
  private sequence = 0;

  async create({ data }: { data: unknown }): Promise<FakeRow> {
    const row = { ...(data as Omit<FakeRow, "id">), id: `row-${++this.sequence}` };
    this.rows.push(row);
    return row;
  }

  async findUnique({ where }: { where: { tokenHash: string } }): Promise<FakeRow | null> {
    return this.rows.find((row) => row.tokenHash === where.tokenHash) ?? null;
  }

  async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown> {
    const row = this.rows.find((candidate) => candidate.id === where.id);
    if (!row) throw new Error("row not found");
    Object.assign(row, data);
    return row;
  }
}

describe("prismaInstallationCredentialStore", () => {
  it("forwards the four credential operations to the delegate", async () => {
    const delegate = new FakeDelegate();
    const store = prismaInstallationCredentialStore<{ label: string }, FakeRow>(delegate);

    const created = await store.create({ label: "agent", tokenHash: "hash-1" });
    assert.equal(created.id, "row-1");
    assert.deepEqual(delegate.rows[0], { id: "row-1", label: "agent", tokenHash: "hash-1" });

    assert.equal(await store.findByTokenHash("hash-1"), created);
    assert.equal(await store.findByTokenHash("missing"), null);

    await store.replaceTokenHash("row-1", "hash-2");
    assert.equal(delegate.rows[0].tokenHash, "hash-2");

    const revokedAt = new Date();
    await store.setRevokedAt("row-1", revokedAt);
    assert.equal(delegate.rows[0].revokedAt, revokedAt);
    await store.setRevokedAt("row-1", null);
    assert.equal(delegate.rows[0].revokedAt, null);
  });
});
