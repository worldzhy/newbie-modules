import { createDecipheriv, createHash } from "crypto";

/**
 * Decrypt an encrypted Lark/Feishu webhook callback body.
 *
 * When an Encrypt Key is configured in the Lark app settings, every callback
 * arrives as `{ encrypt: "<base64>" }` encrypted with AES-256-CBC:
 *   key        = SHA-256 digest of the Encrypt Key (32 bytes)
 *   iv         = first 16 bytes of the base64-decoded payload
 *   ciphertext = remaining bytes (PKCS#7 padded)
 * The decrypted payload is JSON: either `{ "challenge": "..." }` for URL
 * verification, or the plaintext event / card-action object.
 *
 * Reference:
 * https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/encrypt-key-encryption-parameter-within
 */
export function decryptLarkEvent(encryptKey: string, encryptedText: string): unknown {
  const key = createHash("sha256").update(encryptKey).digest();
  const payload = Buffer.from(encryptedText, "base64");
  const iv = payload.subarray(0, 16);
  const ciphertext = payload.subarray(16);

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}
