import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret-key-cipher";

const SECRET = "unit-test-token-secret";

test("encrypt/decrypt round-trips the secret access key", () => {
  const token = encryptSecret("fakeSecretAccessKey0123456789", SECRET);
  assert.equal(isEncryptedSecret(token), true);
  assert.equal(decryptSecret(token, SECRET), "fakeSecretAccessKey0123456789");
});

test("ciphertext is opaque and non-deterministic", () => {
  const first = encryptSecret("same-input", SECRET);
  const second = encryptSecret("same-input", SECRET);
  assert.notEqual(first, second);
  assert.equal(first.includes("same-input"), false);
});

test("a wrong key fails authentication instead of returning plaintext", () => {
  const token = encryptSecret("top-secret", SECRET);
  assert.throws(() => decryptSecret(token, "another-secret"));
});

test("a tampered payload fails authentication", () => {
  const token = encryptSecret("top-secret", SECRET);
  const body = token.slice(3);
  // Flip one base64 character in the ciphertext body.
  const flipped = body.slice(0, 4) + (body[4] === "A" ? "B" : "A") + body.slice(5);
  assert.throws(() => decryptSecret("v1:" + flipped, SECRET));
});

test("legacy JWT-style tokens are rejected, not silently decoded", () => {
  assert.throws(() => decryptSecret("eyJhbGciOiJIUzI1NiJ9.eyJzZWNyZXRLZXkiOiJ4In0.sig", SECRET));
});
