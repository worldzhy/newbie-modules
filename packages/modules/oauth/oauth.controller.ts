import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Post,
  Query,
  Req,
  Res,
  Headers,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { Prisma } from "@generated/prisma/client";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";
import { UserRequest } from "@modules/security/security.interface";
import {
  CreateOAuthClientDto,
  ExchangeCodeForTokenDto,
  OAuthClientResponseDto,
  OAuthTokenResponseDto,
  RevokeOAuthTokenDto,
} from "./oauth.dto";
import { OAuthService } from "./oauth.service";

/**
 * Two endpoint families:
 *
 * 1. Public OAuth protocol endpoints — `/oauth/*`. The authorize flow requires
 *    an existing web session (the caller is a logged-in browser user granting a
 *    client), but token exchange and revocation are public / bearer respectively.
 * 2. Admin client management — `/iam/oauth-clients`, gated by the standard
 *    IAM permission check, same as roles/permissions.
 *
 * NOTE: authorize currently returns the issued code as JSON for machine
 * testing; the HTML consent page is a follow-up front-end concern. The
 * redirect semantics (302 back to redirect_uri?code&state) are preserved for
 * the consent-approval path.
 */
@ApiTags("Account / OAuth")
@Controller()
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  // ---------------------------------------------------------------------------
  // Admin client management (IAM)
  // ---------------------------------------------------------------------------

  @ApiBearerAuth()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.OAuthClient)
  @Get("iam/oauth-clients")
  @ApiOperation({ summary: "List registered OAuth clients (admin)" })
  @ApiResponse({ type: OAuthClientResponseDto, isArray: true })
  async listClients(): Promise<OAuthClientResponseDto[]> {
    return (await this.oauthService.listClients()) as OAuthClientResponseDto[];
  }

  @ApiBearerAuth()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.OAuthClient)
  @Post("iam/oauth-clients")
  @ApiOperation({ summary: "Register an OAuth client (admin)" })
  @ApiResponse({ type: OAuthClientResponseDto })
  async createClient(
    @Req() req: UserRequest,
    @Body() data: CreateOAuthClientDto,
    @Ip() ipAddress: string,
    @Headers("user-agent") userAgent: string,
  ): Promise<OAuthClientResponseDto & { clientSecret?: string }> {
    return (await this.oauthService.createClient({
      actorId: req.user.userId,
      ipAddress,
      userAgent,
      data,
    })) as OAuthClientResponseDto & { clientSecret?: string };
  }

  @ApiBearerAuth()
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.OAuthClient)
  @Delete("iam/oauth-clients/:clientId")
  @ApiOperation({ summary: "Revoke an OAuth client (admin)" })
  @ApiResponse({ type: OAuthClientResponseDto })
  async revokeClient(
    @Req() req: UserRequest,
    @Param("clientId") clientId: string,
    @Ip() ipAddress: string,
    @Headers("user-agent") userAgent: string,
  ): Promise<OAuthClientResponseDto> {
    return (await this.oauthService.revokeClient({
      clientId,
      actorId: req.user.userId,
      ipAddress,
      userAgent,
    })) as OAuthClientResponseDto;
  }

  // ---------------------------------------------------------------------------
  // Public protocol endpoints
  // ---------------------------------------------------------------------------

  /**
   * Authorize entry point. The default session guard requires an authenticated
   * web session here (the browser user is granting a client). If a standing
   * consent already covers the scope, the controller 302-redirects immediately;
   * otherwise it returns the challenge so the front-end can render the consent
   * page.
   */
  @ApiBearerAuth()
  @Get("oauth/authorize")
  @ApiOperation({ summary: "Start the OAuth authorize flow" })
  @ApiResponse({ status: 302, description: "Redirect back to the client with code & state, or to the consent page" })
  async authorize(
    @Req() req: UserRequest,
    @Res() res: Response,
    @Query("client_id") clientId: string,
    @Query("redirect_uri") redirectUri: string,
    @Query("scope") scope: string,
    @Query("code_challenge") codeChallenge: string,
    @Query("code_challenge_method") codeChallengeMethod: string,
    @Query("state") state: string,
  ) {
    const result = await this.oauthService.authorize({
      userId: req.user.userId,
      clientId,
      redirectUri,
      scope,
      codeChallenge,
      codeChallengeMethod,
      state,
    });

    if (!result.requireConsent) {
      const separator = result.redirectUri.includes("?") ? "&" : "?";
      return res.redirect(
        302,
        `${result.redirectUri}${separator}code=${encodeURIComponent(result.code)}&state=${encodeURIComponent(result.state)}`,
      );
    }
    // Redirect to the front-end consent page with the challenge params.
    const frontendUrl = process.env.APP_FRONTEND_URL ?? "http://localhost:3001";
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      code_challenge: codeChallenge ?? "",
      code_challenge_method: codeChallengeMethod ?? "",
      state: state ?? "",
    });
    return res.redirect(302, `${frontendUrl}/oauth/consent?${params.toString()}`);
  }

  /**
   * Consent approval (called by the front-end consent page for the logged-in
   * user). Issues the code and 302-redirects back to the client.
   */
  @ApiBearerAuth()
  @Post("oauth/authorize/consent")
  @ApiOperation({ summary: "Approve the consent page and issue an authorization code" })
  @ApiResponse({ status: 302, description: "Redirect back to the client with code & state" })
  async approveConsent(
    @Req() req: UserRequest,
    @Res() res: Response,
    @Body()
    body: {
      clientId: string;
      scope: string;
      redirectUri: string;
      codeChallenge: string;
      state: string;
    },
  ) {
    const result = await this.oauthService.approveConsent({
      userId: req.user.userId,
      ...body,
    });
    const separator = result.redirectUri.includes("?") ? "&" : "?";
    return res.redirect(
      302,
      `${result.redirectUri}${separator}code=${encodeURIComponent(result.code)}&state=${encodeURIComponent(result.state)}`,
    );
  }

  /**
   * Public token endpoint (RFC 6749 §4.1.3). No guard: the one-time code +
   * PKCE verifier authenticate the caller.
   */
  @NoGuard()
  @Post("oauth/token")
  @ApiOperation({ summary: "Exchange an authorization code for an access token" })
  @ApiResponse({ type: OAuthTokenResponseDto })
  async exchangeCode(
    @Body() body: ExchangeCodeForTokenDto,
    @Ip() ipAddress: string,
    @Headers("user-agent") userAgent: string,
  ): Promise<OAuthTokenResponseDto> {
    if (body.grantType !== "authorization_code") {
      throw new BadRequestException({
        error: "unsupported_grant_type",
        error_description: 'only "authorization_code" is supported',
      });
    }
    const result = await this.oauthService.exchangeCodeForToken({
      code: body.code,
      redirectUri: body.redirectUri,
      clientId: body.clientId,
      codeVerifier: body.codeVerifier,
      ipAddress,
      userAgent,
    });
    return { tokenType: "Bearer", ...result };
  }

  /** RFC 7009 revoke. The bearer access token authenticates the caller. */
  @ApiBearerAuth()
  @Post("oauth/revoke")
  @ApiOperation({ summary: "Revoke a refresh token" })
  @ApiResponse({ status: 200, description: "Token revoked (or already unknown); always succeeds per RFC 7009" })
  async revoke(
    @Req() req: UserRequest,
    @Body() body: RevokeOAuthTokenDto,
    @Ip() ipAddress: string,
    @Headers("user-agent") userAgent: string,
  ) {
    return await this.oauthService.revokeToken({
      refreshToken: body.token,
      actorId: req.user.userId,
      ipAddress,
      userAgent,
    });
  }
}
