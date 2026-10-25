import { Controller, Get, Req } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { ModuleHubInstallation } from "@generated/prisma/client";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";

import { ModuleHubInstallationService } from "../services/installation.service";

/**
 * Caller-scoped read endpoint for the installation token itself (ADR-016).
 *
 * Same credential as `ReportController`: the token is resolved to one
 * installation by `InstallationAuth`, so `me` can only ever mean that
 * installation. It exists so operators and CI can compare a deployment
 * against the local `modules.json` (`newbie module-hub verify`) without a host
 * user session; listing any installation by id stays on the
 * host-authenticated `InstallationController`.
 *
 * Route shape mirrors `GET /module-hub/installations/:id/modules` — same tail,
 * different subject selector — so the admin and token-scoped views read as one
 * resource with two access paths.
 */
@ApiTags("Module Hub")
@Controller("module-hub")
export class MeController {
  constructor(private readonly installations: ModuleHubInstallationService) {}

  @Get("me/modules")
  @InstallationAuth("module-hub")
  @ApiOkResponse()
  async myModules(@Req() req: Request & { installation: ModuleHubInstallation }) {
    const { id } = req.installation;
    const installation = await this.installations.get(id);
    const modules = await this.installations.getModules(id);

    return {
      installation: {
        id: installation.id,
        label: installation.label,
        env: installation.env,
        appVersion: installation.appVersion,
        framework: installation.framework,
        frameworkVersion: installation.frameworkVersion,
        instanceId: installation.instanceId,
        lastSeenAt: installation.lastSeenAt,
        online: installation.online,
      },
      ...modules,
    };
  }
}
