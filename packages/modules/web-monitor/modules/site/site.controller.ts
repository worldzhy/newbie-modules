import { BadRequestException, Controller, Get, Post, Body, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { SiteService } from "./site.service";
import { func, pickRequestId } from "../../shared/utils";
import { WebMonitorSiteResponseDto } from "./site.dto";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "../web/web-monitor-access.service";

@ApiTags("Frontend Monitor / System")
@Controller("/web-monitor/system")
export class SiteController {
  constructor(
    private readonly site: SiteService,
    private readonly access: WebMonitorAccessService,
  ) {}

  @Post("/add")
  @RequirePermission(PermissionAction.Create, "WebMonitorSite")
  @ApiOperation({ summary: "Add a new monitoring system" })
  @ApiResponse({ type: Object })
  async addNewSite(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const projectId = pickRequestId(req, "projectId");
    if (!projectId) {
      throw new BadRequestException("projectId is required");
    }
    const res = await this.site.saveSiteData({ ...body, projectId });
    return res;
  }

  @Post("/update")
  @RequirePermission(PermissionAction.Update, "WebMonitorSite")
  @ApiOperation({ summary: "Update a monitoring system (with project membership gate)" })
  @ApiResponse({ type: Object })
  async updateSite(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const projectId = pickRequestId(req, "projectId");
    const applicationId = pickRequestId(req, "applicationId");
    if (!projectId || !applicationId) {
      throw new BadRequestException("projectId and applicationId are required");
    }
    // The partition key must never come from the request body: derive it from
    // the installation registered for this project/application pair so a
    // caller cannot target another tenant's site by supplying their appKey.
    const appKey = await this.access.resolveAppKey(projectId, applicationId, req.user.userId);
    const res = await this.site.updateSiteData(appKey, body);
    return res;
  }

  @Get("/getSysForUserId")
  @RequirePermission(PermissionAction.List, "WebMonitorSite", { scope: "self" })
  @ApiOperation({ summary: "Get systems for a user" })
  @ApiResponse({ type: WebMonitorSiteResponseDto, isArray: true })
  async getSitesForUserId(@Query() query: Record<string, unknown>, @Req() req: UserRequest) {
    const result = await this.site.getSitesForUserId(query, req.user.userId);
    return func.result({ data: result });
  }

  @Get("/getSystemForId")
  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @ApiOperation({ summary: "Get system by applicationId (with project membership gate)" })
  @ApiResponse({ type: WebMonitorSiteResponseDto })
  async getSiteForId(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId } = q;
    if (!projectId || !applicationId) {
      throw new BadRequestException("projectId and applicationId are required");
    }
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const result = await this.site.getSiteForDb(appKey);
    return func.result({ data: result });
  }

  @Get("/list")
  @RequirePermission(PermissionAction.List, "WebMonitorSite", { scope: "self" })
  @ApiOperation({ summary: "Get web system list" })
  @ApiResponse({ type: WebMonitorSiteResponseDto, isArray: true })
  async getWebSiteList(@Req() req: UserRequest) {
    const result = await this.site.getWebSiteListForUser(req.user.userId);
    return func.result({ data: result });
  }

  @Post("/deleteUser")
  @RequirePermission(PermissionAction.Delete, "WebMonitorSite")
  @ApiOperation({ summary: "Delete a user from a system" })
  @ApiResponse({ type: Object })
  async deleteWebSiteUser(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const projectId = pickRequestId(req, "projectId");
    const applicationId = pickRequestId(req, "applicationId");
    const userToken = body.userToken;
    if (!projectId || !applicationId) {
      throw new BadRequestException("projectId and applicationId are required");
    }
    if (!userToken) throw new BadRequestException("Delete a user from the system: userToken is required");
    const appKey = await this.access.resolveAppKey(projectId, applicationId, req.user.userId);
    const result = await this.site.deleteWebSiteUser(appKey, String(userToken));
    return func.result({ data: result });
  }

  @Post("/addUser")
  @RequirePermission(PermissionAction.Create, "WebMonitorSite")
  @ApiOperation({ summary: "Add a user to a system" })
  @ApiResponse({ type: Object })
  async addWebSiteUser(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const projectId = pickRequestId(req, "projectId");
    const applicationId = pickRequestId(req, "applicationId");
    const userToken = body.userToken;
    if (!projectId || !applicationId) {
      throw new BadRequestException("projectId and applicationId are required");
    }
    if (!userToken) throw new BadRequestException("Add a user to the system: userToken is required");
    const appKey = await this.access.resolveAppKey(projectId, applicationId, req.user.userId);
    const result = await this.site.addWebSiteUser(appKey, String(userToken));
    return func.result({ data: result });
  }

  @Post("/deleteSystem")
  @RequirePermission(PermissionAction.Delete, "WebMonitorSite")
  @ApiOperation({ summary: "Delete a system (with project membership gate)" })
  @ApiResponse({ type: Object })
  async deleteSite(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const projectId = pickRequestId(req, "projectId");
    const applicationId = pickRequestId(req, "applicationId");
    const type = body.type;
    if (!projectId || !applicationId) {
      throw new BadRequestException("projectId and applicationId are required");
    }
    const appKey = await this.access.resolveAppKey(projectId, applicationId, req.user.userId);
    const result = await this.site.deleteSite(appKey, String(type));
    return func.result({ data: result });
  }
}
