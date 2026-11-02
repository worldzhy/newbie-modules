import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decryptApiKey, encryptApiKey, fingerprintApiKey, isEncryptedApiKey } from "./llm-api-key";

/**
 * At-rest contract for LLM API keys (R3-17): every written value is
 * ciphertext, the plaintext round-trips with the configured secret, and any
 * tampering, wrong secret or malformed payload fails closed instead of
 * returning garbage as a usable credential.
 */

const SECRET = "unit-test-secret-that-is-long-enough";
const PLAINTEXT = "sk-live-0123456789abcdef";

describe("llm api key encryption", () => {
  it("round-trips a plaintext key", () => {
    const stored = encryptApiKey(SECRET, PLAINTEXT);

    assert.equal(isEncryptedApiKey(stored), true);
    assert.equal(decryptApiKey(stored, SECRET), PLAINTEXT);
  });

  it("never stores the plaintext and never repeats a ciphertext", () => {
    const first = encryptApiKey(SECRET, PLAINTEXT);
    const second = encryptApiKey(SECRET, PLAINTEXT);

    assert.equal(first.includes(PLAINTEXT), false);
    assert.notEqual(first, second);
    assert.equal(decryptApiKey(second, SECRET), PLAINTEXT);
  });

  it("rejects a tampered payload", () => {
    const stored = encryptApiKey(SECRET, PLAINTEXT);
    // Flip a ciphertext bit (not a base64 padding bit, which can decode to the
    // same bytes and make this test vacuous).
    const payload = Buffer.from(stored.slice("enc:v1:".length), "base64");
    payload[payload.length - 1] ^= 0x01;

    assert.throws(() => decryptApiKey(`enc:v1:${payload.toString("base64")}`, SECRET));
  });

  it("rejects the wrong secret", () => {
    const stored = encryptApiKey(SECRET, PLAINTEXT);

    assert.throws(() => decryptApiKey(stored, `${SECRET}-other`));
  });

  it("rejects malformed ciphertext", () => {
    assert.throws(() => decryptApiKey("enc:v1:AAAA", SECRET));
  });

  it("passes legacy plaintext rows through", () => {
    assert.equal(decryptApiKey(PLAINTEXT, SECRET), PLAINTEXT);
    assert.equal(isEncryptedApiKey(PLAINTEXT), false);
  });
});

describe("llm api key fingerprint", () => {
  it("is deterministic and keyed by plaintext alone", () => {
    assert.equal(fingerprintApiKey(PLAINTEXT), fingerprintApiKey(PLAINTEXT));
    assert.notEqual(fingerprintApiKey(PLAINTEXT), fingerprintApiKey(`${PLAINTEXT}-other`));
    assert.equal(fingerprintApiKey(PLAINTEXT).length, 64);
  });
});
