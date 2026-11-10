import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import cryptoRandomString from "crypto-random-string";
import { JwtPayload, sign, SignOptions, verify } from "jsonwebtoken";
import { v4 } from "uuid";
import { INVALID_TOKEN } from "@devbie/newbie/exceptions/errors.constants";
import { SECURITY_TOKEN_EXPIRES_IN } from "../security-config.constants";
import { TokenSubject } from "./token.constants";
import express from "express";

/** Shape of the `modules.security.token` configuration subtree. */
interface TokenModuleConfig {
  defaultSecret: string;
  userAccess: { secret: string };
  userRefresh: { secret: string };
}

/** Public literal that must never be accepted as a signing key. */
const KNOWN_PUBLIC_SECRET = "your-default-token-secret";

/** Prefix for sealed tokens, so a future key/algorithm change can rotate. */
const SEALED_TOKEN_PREFIX = "v1";
const SEALED_TOKEN_IV_BYTES = 12;
const SEALED_TOKEN_TAG_BYTES = 16;

/**
 * Key domain strings for sealed values: one per kind of secret, so the derived
 * keys never overlap even though they share the same source secret.
 */
type SealedDomain = "refresh-token" | "totp-secret";

/**
 * A signing secret is only usable when it is long enough to be unguessable.
 * Failing here stops the process at startup instead of letting every token be
 * forgeable with a value that ships in the source tree.
 */
function assertUsableSecret(secret: unknown, key: string, minimumLength = 32): asserts secret is string {
  if (typeof secret !== "string" || secret.length < minimumLength || secret === KNOWN_PUBLIC_SECRET) {
    throw new Error(
      `${key} must be a non-public secret of at least ${minimumLength} characters; refusing to sign tokens`,
    );
  }
}

@Injectable()
export class TokenService {
  private tokenConfig: TokenModuleConfig;

  constructor(private config: ConfigService) {
    this.tokenConfig = this.config.getOrThrow("modules.security.token");
    assertUsableSecret(this.tokenConfig.defaultSecret, "modules.security.token.defaultSecret");
  }

  /**
   * Sign a JWT
   */
  sign(params: { payload: number | string | object | Buffer; secret?: string | null; options: SignOptions }) {
    let { payload, secret } = params;
    const { options } = params;
    if (typeof payload === "number") payload = payload.toString();
    secret = secret ?? this.tokenConfig.defaultSecret;
    assertUsableSecret(secret, "token signing secret");
    return sign(payload, secret, options);
  }

  /**
   * Verify and decode a JWT
   */
  verify<T extends JwtPayload | string>(params: {
    token: string;
    secret?: string | null;
    options: { subject: string };
  }) {
    const { token, options } = params;
    let { secret } = params;
    secret = secret ?? this.tokenConfig.defaultSecret;
    // Verification also fails closed: a missing secret must not degrade into an
    // implicit "any token signed with the literal" acceptance path.
    assertUsableSecret(secret, "token verification secret");

    try {
      return verify(token, secret, options) as T;
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN);
    }
  }

  /**
   * Generate a UUID
   */
  generateUuid() {
    return v4();
  }

  /**
   * Generate a cryptographically strong random string
   * @param length - Length of returned string
   * @param charactersOrType - Characters or one of the supported types
   */
  async generateRandomString(length = 32, charactersOrType = "alphanumeric"): Promise<string> {
    if (
      ["hex", "base64", "url-safe", "numeric", "distinguishable", "ascii-printable", "alphanumeric"].includes(
        charactersOrType,
      )
    )
      return cryptoRandomString({
        length,
        type: charactersOrType as
          "hex" | "base64" | "url-safe" | "numeric" | "distinguishable" | "ascii-printable" | "alphanumeric",
      });
    return cryptoRandomString({ length, characters: charactersOrType });
  }

  /**
   * Sign user access token
   */
  signUserAccessToken(payload: { userId: string }) {
    return this.sign({
      payload,
      secret: this.tokenConfig.userAccess.secret || this.tokenConfig.defaultSecret,
      options: {
        subject: TokenSubject.USER_ACCESS_TOKEN,
        expiresIn: SECURITY_TOKEN_EXPIRES_IN.userAccess,
        // Unique per issuance so repeated signings in the same second still
        // produce distinct tokens (sessions are keyed by the token string).
        jwtid: this.generateUuid(),
      },
    });
  }

  /**
   * Verify user access token
   * Returns an object with userId, iat (issued at), and exp (expiration)
   * If the token is invalid, it throws an UnauthorizedException
   */
  verifyUserAccessToken(token: string) {
    return this.verify<{ userId: string; iat: number; exp: number }>({
      token,
      secret: this.tokenConfig.userAccess.secret || this.tokenConfig.defaultSecret,
      options: {
        subject: TokenSubject.USER_ACCESS_TOKEN,
      },
    });
  }

  /**
   * Sign user refresh token
   */
  signUserRefreshToken(payload: { userId: string }, options?: { expiresIn: SignOptions["expiresIn"] }) {
    return this.sign({
      payload,
      secret: this.tokenConfig.userRefresh.secret || this.tokenConfig.defaultSecret,
      options: {
        subject: TokenSubject.USER_REFRESH_TOKEN,
        expiresIn: options ? options.expiresIn : SECURITY_TOKEN_EXPIRES_IN.userRefresh,
        // Unique per issuance: within the same second, iat/exp would otherwise
        // be identical and rotation would store the same token string, which
        // makes reuse detection impossible.
        jwtid: this.generateUuid(),
      },
    });
  }

  /**
   * Verify user refresh token
   * Returns an object with userId, iat (issued at), and exp (expiration)
   * If the token is invalid, it throws an UnauthorizedException
   */
  verifyUserRefreshToken(token: string) {
    return this.verify<{ userId: string; iat: number; exp: number }>({
      token,
      secret: this.tokenConfig.userRefresh.secret || this.tokenConfig.defaultSecret,
      options: {
        subject: TokenSubject.USER_REFRESH_TOKEN,
      },
    });
  }

  /**
   * Deterministic SHA-256 hex digest of a token. Used to store refresh tokens
   * as hashes at rest (nightwatch-backend ADR-034): lookup and rotation match by hash, and a
   * database read never yields a usable credential.
   */
  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * Reversibly seal a credential that must remain usable for a short window
   * (the refresh-token idempotency replay). AES-256-GCM with a key derived
   * from the refresh-token signing secret and a distinct domain string, so a
   * database read yields ciphertext rather than a live token (R20-11).
   */
  sealToken(token: string): string {
    return this.seal(token, "refresh-token");
  }

  /**
   * Open a value produced by sealToken(). A malformed or tampered value is
   * rejected as an invalid token — never partially decoded.
   */
  openSealedToken(sealed: string): string {
    return this.openSealed(sealed, "refresh-token");
  }

  /**
   * Seal a TOTP shared secret before it is persisted (R33-04). The domain
   * string is distinct from the refresh-token one, so the two ciphertext
   * families are not interchangeable: a sealed refresh token can never be
   * opened as an authenticator secret, or the reverse.
   */
  sealTotpSecret(secret: string): string {
    return this.seal(secret, "totp-secret");
  }

  /**
   * Open a value produced by sealTotpSecret(). A damaged stored secret is a
   * credential failure, not a plaintext fallback: the caller must not proceed
   * with an unreadable authenticator secret.
   */
  openTotpSecret(sealed: string): string {
    return this.openSealed(sealed, "totp-secret");
  }

  private seal(value: string, domain: SealedDomain): string {
    const iv = randomBytes(SEALED_TOKEN_IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.sealedKey(domain), iv);
    const payload = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [
      SEALED_TOKEN_PREFIX,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      payload.toString("base64url"),
    ].join(".");
  }

  private openSealed(sealed: string, domain: SealedDomain): string {
    const [version, iv, tag, payload] = sealed.split(".");
    if (version !== SEALED_TOKEN_PREFIX || !iv || !tag || !payload) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.sealedKey(domain), Buffer.from(iv, "base64url"));
      const tagBytes = Buffer.from(tag, "base64url");
      if (tagBytes.length !== SEALED_TOKEN_TAG_BYTES) {
        throw new Error("invalid tag length");
      }
      decipher.setAuthTag(tagBytes);
      return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN);
    }
  }

  private sealedKey(domain: SealedDomain): Buffer {
    const secret = this.tokenConfig.userRefresh.secret || this.tokenConfig.defaultSecret;
    assertUsableSecret(secret, "sealing secret");
    return createHash("sha256").update(`${secret}:${domain}-next`).digest();
  }

  /**
   * Get token from HTTP request
   * @param request - Express request object
   * @returns The token if present, otherwise undefined
   */
  getTokenFromHttpRequest(request: express.Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
