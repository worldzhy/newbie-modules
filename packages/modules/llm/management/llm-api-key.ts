import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * At-rest protection for upstream LLM API keys (ADR-006 connection registry).
 *
 * Stored form is `enc:v1:<base64(iv | tag | ciphertext)>` under AES-256-GCM.
 * Values without the prefix are legacy plaintext rows written before encryption
 * shipped; they stay readable so a rollout does not require a data migration.
 * Every write now produces the encrypted form, so the plaintext population
 * shrinks as admins touch connections.
 */
const ENCRYPTED_PREFIX = "enc:v1:";
const KEY_LABEL = "llm-api-key-v1:";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function isEncryptedApiKey(stored: string): boolean {
  return stored.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Deterministic plaintext digest used as the credential identity. Ciphertext
 * is non-deterministic (random IV), so the (baseUrl, apiKey) uniqueness
 * invariant and duplicate pre-checks compare fingerprints instead.
 */
export function fingerprintApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function encryptApiKey(secret: string, plaintext: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  return `${ENCRYPTED_PREFIX}${payload.toString("base64")}`;
}

/**
 * Decrypts a stored key. Plaintext legacy values pass through unchanged; a
 * malformed or tampered ciphertext throws instead of silently returning it.
 */
export function decryptApiKey(stored: string, secret: string): string {
  if (!isEncryptedApiKey(stored)) {
    return stored;
  }
  const payload = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64");
  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Stored LLM API key is malformed.");
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Domain-separated key: the configured secret is shared with other purposes
 * (token signing), and a bare digest keeps the two uses from ever colliding.
 */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(KEY_LABEL).update(secret).digest();
}
