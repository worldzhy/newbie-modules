import { Controller, Get, Req } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { ModuleHubInstallation } from "@generated/prisma/client";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";

import { ModuleHubInstallationService } from "../services/installation.service";

/**
 * Self-inspection endpoint for the installation token itself (ADR-016).
 *
 * Same credential as `ReportController`: the token is resolved to one
 * installation by `InstallationAuth`, so this endpoint can only ever return
 * that installation's own facts. It exists so operators and CI can compare a
 * deployment against the local `modules.json` (`newbie module-hub verify`)
 * without a host user session; cross-installation listing stays on the
 * host-authenticated `InstallationController`.
 */
@ApiTags("Module Hub")
@Controller("module-hub")
export class SelfController {
  constructor(private readonly installations: ModuleHubInstallationService) {}

  @Get("self/modules")
  @InstallationAuth("module-hub")
  @ApiOkResponse()
  async selfModules(@Req() req: Request & { installation: ModuleHubInstallation }) {
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
