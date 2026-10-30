import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret-key-cipher";

/**
 * Encrypts the AWS secret access key before it is persisted. Backed by
 * AES-256-GCM (see secret-key-cipher.ts) rather than `JwtService.sign`, which
 * was only base64-encoding the value rather than protecting it.
 */
@Injectable()
export class AwsSecretKeyTokenService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>("modules.aws-cloudformation.token.secret");
  }

  sign(secretKey: string): string {
    // Idempotent: updating an environment must not double-encrypt a value that
    // was already stored encrypted.
    if (isEncryptedSecret(secretKey)) {
      return secretKey;
    }
    return encryptSecret(secretKey, this.secret);
  }

  decode(token: string): string {
    return decryptSecret(token, this.secret);
  }
}
