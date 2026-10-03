import { Inject, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { Optional } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-custom";
import { Request } from "express";
import { API_KEY_NOT_FOUND } from "@devbie/newbie/exceptions/errors.constants";
import { API_KEY_VERIFIER, ApiKeyVerifier } from "../../ports/api-key.verifier";

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, "custom.api-key") {
  constructor(
    @Optional()
    @Inject(API_KEY_VERIFIER)
    private readonly apiKeyVerifier?: ApiKeyVerifier,
  ) {
    super();
  }

  /**
   * 'validate' function must be implemented.
   *
   * Credential lookup and secret comparison belong to the identity provider
   * (ApiKeyVerifier port); security only handles the HTTP transport.
   */
  async validate(req: Request): Promise<boolean> {
    const key = req.headers["key"] as string;
    const secret = req.headers["secret"] as string;
    if (!key || !secret) {
      throw new UnauthorizedException(API_KEY_NOT_FOUND);
    }

    if (!this.apiKeyVerifier) {
      throw new InternalServerErrorException(
        "API key authentication is active but no API_KEY_VERIFIER is bound. Did the identity provider module load?",
      );
    }

    return this.apiKeyVerifier.verify(key, secret);
  }
}
