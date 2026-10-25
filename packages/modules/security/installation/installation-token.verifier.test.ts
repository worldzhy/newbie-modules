import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InstallationCredentialLookup,
  generateInstallationToken,
  hashInstallationToken,
} from "./installation-credential";
import { InstallationTokenVerifier } from "./installation-token.verifier";

interface FakeRow {
  id: string;
  revokedAt: Date | null;
}

/** Lookup-only fake that records every storage hit. */
class FakeLookup implements InstallationCredentialLookup<FakeRow> {
  readonly rows: Array<FakeRow & { tokenHash: string }> = [];
  lookups = 0;

  async findByTokenHash(tokenHash: string): Promise<FakeRow | null> {
    this.lookups++;
    return this.rows.find((row) => row.tokenHash === tokenHash) ?? null;
  }

  enroll(token: string): FakeRow & { tokenHash: string } {
    const row: FakeRow & { tokenHash: string } = {
      id: `row-${this.rows.length + 1}`,
      tokenHash: hashInstallationToken(token),
      revokedAt: null,
    };
    this.rows.push(row);
    return row;
  }
}

describe("installation token verifier (ADR-019)", () => {
  it("returns the row for a valid token", async () => {
    const lookup = new FakeLookup();
    const token = generateInstallationToken();
    const row = lookup.enroll(token);

    const verifier = new InstallationTokenVerifier(lookup);
    const resolved = await verifier.verify(token);

    assert.equal(resolved?.id, row.id);
  });

  it("rejects malformed tokens and keeps them out of the rejection cache", async () => {
    const lookup = new FakeLookup();
    const verifier = new InstallationTokenVerifier(lookup, { maxCacheEntries: 1 });
    const unknown = generateInstallationToken();

    assert.equal(await verifier.verify(unknown), null);
    assert.equal(lookup.lookups, 1);

    // Malformed tokens never reach storage, so they must not evict remembered
    // unknowns either: otherwise garbage traffic turns the cache into a dump.
    for (let index = 0; index < 3; index++) {
      assert.equal(await verifier.verify(`bad-token-${index}`), null);
    }

    assert.equal(await verifier.verify(unknown), null);
    assert.equal(lookup.lookups, 1);
  });

  it("rejects unknown tokens and remembers them until the TTL expires", async () => {
    const lookup = new FakeLookup();
    let now = 1_000;
    const verifier = new InstallationTokenVerifier(lookup, { now: () => now });
    const unknown = generateInstallationToken();

    assert.equal(await verifier.verify(unknown), null);
    assert.equal(lookup.lookups, 1);

    // Cached rejection: no second storage hit.
    assert.equal(await verifier.verify(unknown), null);
    assert.equal(lookup.lookups, 1);

    // After the TTL the rejection is re-evaluated against storage.
    now += 10_001;
    assert.equal(await verifier.verify(unknown), null);
    assert.equal(lookup.lookups, 2);
  });

  it("never caches revoked tokens, so restore takes effect immediately", async () => {
    const lookup = new FakeLookup();
    const verifier = new InstallationTokenVerifier(lookup);
    const token = generateInstallationToken();
    const row = lookup.enroll(token);
    row.revokedAt = new Date();

    assert.equal(await verifier.verify(token), null);
    assert.equal(await verifier.verify(token), null);
    // One storage hit per request: revocation/restore are never delayed.
    assert.equal(lookup.lookups, 2);

    row.revokedAt = null;
    assert.equal((await verifier.verify(token))?.id, row.id);
  });

  it("never caches valid tokens, so rotation takes effect immediately", async () => {
    const lookup = new FakeLookup();
    const verifier = new InstallationTokenVerifier(lookup);
    const token = generateInstallationToken();
    const row = lookup.enroll(token);
    assert.equal((await verifier.verify(token))?.id, row.id);

    // Simulate a rotation performed out of process.
    row.tokenHash = hashInstallationToken(generateInstallationToken());

    assert.equal(await verifier.verify(token), null);
    assert.equal(lookup.lookups, 2);
  });

  it("caps the rejection cache, evicting the oldest entry first", async () => {
    const lookup = new FakeLookup();
    const verifier = new InstallationTokenVerifier(lookup, { maxCacheEntries: 2 });
    const tokens = [generateInstallationToken(), generateInstallationToken(), generateInstallationToken()];

    for (const token of tokens) {
      assert.equal(await verifier.verify(token), null);
    }
    assert.equal(lookup.lookups, 3);

    // The first token was evicted and is looked up again; the third is cached.
    assert.equal(await verifier.verify(tokens[0]), null);
    assert.equal(lookup.lookups, 4);
    assert.equal(await verifier.verify(tokens[2]), null);
    assert.equal(lookup.lookups, 4);
  });
});
