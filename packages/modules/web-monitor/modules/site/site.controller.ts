import { BadRequestException, Controller, Get, Post, Body, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { SiteService } from "./site.service";
import { func } from "../../shared/utils";
import { WebMonitorSiteResponseDto } from "./site.dto";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

@ApiTags("Frontend Monitor / System")
@Controller("/web-monitor/system")
export class SiteController {
  constructor(private readonly site: SiteService) {}

  @Post("/add")
  @RequirePermission(PermissionAction.Create, "WebMonitorSite")
  @ApiOperation({ summary: "Add a new monitoring system" })
  @ApiResponse({ type: Object })
  async addNewSite(@Body() body: Record<string, unknown>) {
    const res = await this.site.saveSiteData(body);
    return res;
  }

  @Post("/update")
  @RequirePermission(PermissionAction.Update, "WebMonitorSite")
  @ApiOperation({ summary: "Update a monitoring system" })
  @ApiResponse({ type: Object })
  async updateSite(@Body() body: Record<string, unknown>) {
    const res = await this.site.updateSiteData(body);
    return res;
  }

  @Get("/getSysForUserId")
  @RequirePermission(PermissionAction.List, "WebMonitorSite")
  @ApiOperation({ summary: "Get systems for a user" })
  @ApiResponse({ type: WebMonitorSiteResponseDto, isArray: true })
  async getSitesForUserId(@Query() query: Record<string, unknown>, @Req() req: UserRequest) {
    const result = await this.site.getSitesForUserId(query, req.user.userId);
    return func.result({ data: result });
  }

  @Get("/getSystemForId")
  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @ApiOperation({ summary: "Get system by appId" })
  @ApiResponse({ type: WebMonitorSiteResponseDto })
  async getSiteForId(@Query("appId") appId: string) {
    const result = await this.site.getSiteForDb(appId);
    return func.result({ data: result });
  }

  @Get("/list")
  @RequirePermission(PermissionAction.List, "WebMonitorSite")
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
  async deleteWebSiteUser(@Body() body: Record<string, unknown>) {
    const appId = body.appId;
    const userToken = body.userToken;
    if (!appId) throw new BadRequestException("Delete a user from the system: appId must not be empty");
    if (!userToken) throw new BadRequestException("Delete a user from the system: user token must not be empty");
    const result = await this.site.deleteWebSiteUser(String(appId), String(userToken));
    return func.result({ data: result });
  }

  @Post("/addUser")
  @RequirePermission(PermissionAction.Create, "WebMonitorSite")
  @ApiOperation({ summary: "Add a user to a system" })
  @ApiResponse({ type: Object })
  async addWebSiteUser(@Body() body: Record<string, unknown>) {
    const appId = body.appId;
    const userToken = body.userToken;
    if (!appId) throw new BadRequestException("Add a user to the system: appId must not be empty");
    if (!userToken) throw new BadRequestException("Add a user to the system: user token must not be empty");
    const result = await this.site.addWebSiteUser(String(appId), String(userToken));
    return func.result({ data: result });
  }

  @Post("/deleteSystem")
  @RequirePermission(PermissionAction.Delete, "WebMonitorSite")
  @ApiOperation({ summary: "Delete a system" })
  @ApiResponse({ type: Object })
  async deleteSite(@Body() body: Record<string, unknown>) {
    const appId = body.appId;
    const type = body.type;
    if (!appId) throw new BadRequestException("Delete a system: appId must not be empty");
    const result = await this.site.deleteSite(String(appId), String(type));
    return func.result({ data: result });
  }
}
