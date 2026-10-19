import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import cryptoRandomString from "crypto-random-string";
import { JwtPayload, sign, SignOptions, verify } from "jsonwebtoken";
import { v4 } from "uuid";
import { INVALID_TOKEN } from "@devbie/newbie/exceptions/errors.constants";
import { TokenSubject } from "./token.constants";
import express from "express";

/** Shape of the `modules.security.token` configuration subtree. */
interface TokenModuleConfig {
  defaultSecret: string;
  userAccess: { secret: string; expiresIn: SignOptions["expiresIn"] };
  userRefresh: { secret: string; expiresIn: SignOptions["expiresIn"] };
}

@Injectable()
export class TokenService {
  private tokenConfig: TokenModuleConfig;

  constructor(private config: ConfigService) {
    this.tokenConfig = this.config.getOrThrow("modules.security.token");
  }

  /**
   * Sign a JWT
   */
  sign(params: { payload: number | string | object | Buffer; secret?: string | null; options: SignOptions }) {
    let { payload, secret } = params;
    const { options } = params;
    if (typeof payload === "number") payload = payload.toString();
    secret = secret ?? this.tokenConfig.defaultSecret;
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
        expiresIn: this.tokenConfig.userAccess.expiresIn,
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
        expiresIn: options ? options.expiresIn : this.tokenConfig.userRefresh.expiresIn,
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
   * Get token from HTTP request
   * @param request - Express request object
   * @returns The token if present, otherwise undefined
   */
  getTokenFromHttpRequest(request: express.Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
