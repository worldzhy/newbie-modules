import { createHmac, timingSafeEqual } from "node:crypto";

import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import { NoGuard } from "@modules/account/security/passport/public/public.decorator";
import { Request } from "express";

import { ModuleHubReleaseService } from "../services/release.service";

/**
 * GitHub push webhook for the registry repository.
 *
 * Open route (no user JWT); authentication is the HMAC-SHA256 signature in
 * X-Hub-Signature-256, verified against MODULE_HUB_GITHUB_WEBHOOK_SECRET.
 * Requires the raw request body, enabled framework-side via rawBody: true.
 */
@ApiTags("Module Hub")
@Controller("module-hub/webhooks")
export class WebhookController {
  constructor(
    private readonly releases: ModuleHubReleaseService,
    private readonly config: ConfigService,
  ) {}

  @Post("registry")
  @HttpCode(HttpStatus.OK)
  @NoGuard()
  async registryPush(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers("x-hub-signature-256") signature: string,
    @Headers("x-github-event") event: string,
  ) {
    const secret = this.config.get<string>("MODULE_HUB_GITHUB_WEBHOOK_SECRET");
    if (!secret) {
      throw new ServiceUnavailableException(
        "Registry webhook is not configured (MODULE_HUB_GITHUB_WEBHOOK_SECRET missing); use the fallback sync instead.",
      );
    }
    if (event !== "push") {
      return { ignored: true, reason: `unsupported event '${event}'` };
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException("Raw body unavailable; cannot verify the webhook signature.");
    }
    if (!signature || !signature.startsWith("sha256=")) {
      throw new BadRequestException("Missing or malformed X-Hub-Signature-256 header.");
    }

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const received = signature.slice("sha256=".length);
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(received, "hex");
    if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
      throw new BadRequestException("Webhook signature mismatch.");
    }

    const result = await this.releases.handleGithubPush(req.body);
    return { accepted: true, ...result };
  }
}
