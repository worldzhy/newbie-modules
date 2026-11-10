import { BadRequestException, Controller, Get, Inject, Post, Body, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { SiteService } from "./site.service";
import { func, pickRequestId } from "../../shared/utils";
import { FrontendMonitorSiteResponseDto } from "./site.dto";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { FrontendMonitorAccessService } from "../web/frontend-monitor-access.service";
import { VISIBLE_APP_KEYS_RESOLVER, VisibleAppKeysResolver } from "../../shared/visible-app-keys.port";

@ApiTags("Frontend Monitor / System")
@Controller("/frontend-monitor/system")
export class SiteController {
  constructor(
    private readonly site: SiteService,
    private readonly access: FrontendMonitorAccessService,
    @Inject(VISIBLE_APP_KEYS_RESOLVER)
    private readonly projectVisibility: VisibleAppKeysResolver,
  ) {}

  @Post("/update")
  @RequirePermission(PermissionAction.Update, "FrontendMonitorSite")
  @ApiOperation({ summary: "Update a monitoring system (with membership gate)" })
  @ApiResponse({ type: Object })
  async updateSite(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    // The partition key is scoped by the host, never trusted from the body:
    // a caller outside the appKey's visible scope gets a uniform 403.
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const res = await this.site.updateSiteData(appKey, body);
    return res;
  }

  @Get("/getSysForUserId")
  @RequirePermission(PermissionAction.List, "FrontendMonitorSite", { scope: "self" })
  @ApiOperation({ summary: "Get systems for a user" })
  @ApiResponse({ type: FrontendMonitorSiteResponseDto, isArray: true })
  async getSites(@Query() query: Record<string, unknown>, @Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    // An explicit appKey outside the caller's scope is rejected (uniform 403),
    // never silently dropped: the list must not answer a question it filtered.
    const requested = pickRequestId(req, "appKey");
    if (requested) this.access.assertVisibleAppKey(appKeys, requested);
    const result = await this.site.getSitesInAppKeys(query, appKeys);
    return func.result({ data: result });
  }

  @Get("/getSystemForId")
  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @ApiOperation({ summary: "Get system by appKey (with membership gate)" })
  @ApiResponse({ type: FrontendMonitorSiteResponseDto })
  async getSiteForId(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.site.getSiteForDb(appKey);
    return func.result({ data: result });
  }

  @Get("/list")
  @RequirePermission(PermissionAction.List, "FrontendMonitorSite", { scope: "self" })
  @ApiOperation({ summary: "Get web system list" })
  @ApiResponse({ type: FrontendMonitorSiteResponseDto, isArray: true })
  async getWebSiteList(@Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const result = await this.site.getWebSiteListInAppKeys(appKeys);
    return func.result({ data: result });
  }

  @Post("/deleteUser")
  @RequirePermission(PermissionAction.Delete, "FrontendMonitorSite")
  @ApiOperation({ summary: "Delete a user from a system" })
  @ApiResponse({ type: Object })
  async deleteWebSiteUser(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const userToken = body.userToken;
    if (!userToken) throw new BadRequestException("Delete a user from the system: userToken is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.site.deleteWebSiteUser(appKey, String(userToken));
    return func.result({ data: result });
  }

  @Post("/addUser")
  @RequirePermission(PermissionAction.Create, "FrontendMonitorSite")
  @ApiOperation({ summary: "Add a user to a system" })
  @ApiResponse({ type: Object })
  async addWebSiteUser(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const userToken = body.userToken;
    if (!userToken) throw new BadRequestException("Add a user to the system: userToken is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.site.addWebSiteUser(appKey, String(userToken));
    return func.result({ data: result });
  }

  @Post("/deleteSystem")
  @RequirePermission(PermissionAction.Delete, "FrontendMonitorSite")
  @ApiOperation({ summary: "Delete a system (with membership gate)" })
  @ApiResponse({ type: Object })
  async deleteSite(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const type = body.type;
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.site.deleteSite(appKey, String(type));
    return func.result({ data: result });
  }
}
