import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for at-rest AWS secret access keys.
 *
 * The previous implementation used `JwtService.sign/decode`, which only
 * base64-encodes the payload — anyone holding the row (or a DB backup) could
 * read the decrypted key. AES-256-GCM provides real confidentiality plus
 * tamper detection; the key is derived from the module's configured secret.
 *
 * Payload format: `v1:` + base64(iv[12] || authTag[16] || ciphertext).
 */
const PREFIX = "v1:";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(secret: string): Buffer {
  if (!secret) {
    throw new Error("AWS CloudFormation secret-key token secret is not configured.");
  }
  // Fixed-length 32-byte key regardless of the configured passphrase length.
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(payload: string, secret: string): string {
  if (!payload.startsWith(PREFIX)) {
    throw new Error("Unsupported AWS secret-key token format; re-enter the environment credentials.");
  }
  const key = deriveKey(secret);
  const raw = Buffer.from(payload.slice(PREFIX.length), "base64");
  if (raw.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Corrupted AWS secret-key token.");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** True when the value already looks like a token produced by encryptSecret. */
export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}
