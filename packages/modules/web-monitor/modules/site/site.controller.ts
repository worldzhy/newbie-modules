import { Controller, Get, Post, Body, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SiteService } from "./site.service";
import { func } from "../../shared/utils";
import { WebMonitorSiteResponseDto } from "./site.dto";
import { RequireOwner } from "@modules/security/authorization/require-owner.decorator";

@ApiTags("Frontend Monitor / System")
@RequireOwner()
@Controller("/web-monitor/system")
export class SiteController {
  constructor(private readonly site: SiteService) {}

  @Post("/add")
  @ApiOperation({ summary: "Add a new monitoring system" })
  @ApiResponse({ type: Object })
  async addNewSite(@Body() body: Record<string, unknown>) {
    const res = await this.site.saveSiteData(body);
    return res;
  }

  @Post("/update")
  @ApiOperation({ summary: "Update a monitoring system" })
  @ApiResponse({ type: Object })
  async updateSite(@Body() body: Record<string, unknown>) {
    const res = await this.site.updateSiteData(body);
    return res;
  }

  @Get("/getSysForUserId")
  @ApiOperation({ summary: "Get systems for a user" })
  @ApiResponse({ type: WebMonitorSiteResponseDto, isArray: true })
  async getSitesForUserId(@Query() query: Record<string, unknown>) {
    const result = await this.site.getSitesForUserId(query);
    return func.result({ data: result });
  }

  @Get("/getSystemForId")
  @ApiOperation({ summary: "Get system by appId" })
  @ApiResponse({ type: WebMonitorSiteResponseDto })
  async getSiteForId(@Query("appId") appId: string) {
    const result = await this.site.getSiteForDb(appId);
    return func.result({ data: result });
  }

  @Get("/list")
  @ApiOperation({ summary: "Get web system list" })
  @ApiResponse({ type: WebMonitorSiteResponseDto, isArray: true })
  async getWebSiteList() {
    const result = await this.site.getWebSiteList();
    return func.result({ data: result });
  }

  @Post("/deleteUser")
  @ApiOperation({ summary: "Delete a user from a system" })
  @ApiResponse({ type: Object })
  async deleteWebSiteUser(@Body() body: Record<string, unknown>) {
    const appId = body.appId;
    const userToken = body.userToken;
    if (!appId) throw new Error("Delete a user from the system: appId must not be empty");
    if (!userToken) throw new Error("Delete a user from the system: user token must not be empty");
    const result = await this.site.deleteWebSiteUser(String(appId), String(userToken));
    return func.result({ data: result });
  }

  @Post("/addUser")
  @ApiOperation({ summary: "Add a user to a system" })
  @ApiResponse({ type: Object })
  async addWebSiteUser(@Body() body: Record<string, unknown>) {
    const appId = body.appId;
    const userToken = body.userToken;
    if (!appId) throw new Error("Add a user to the system: appId must not be empty");
    if (!userToken) throw new Error("Add a user to the system: user token must not be empty");
    const result = await this.site.addWebSiteUser(String(appId), String(userToken));
    return func.result({ data: result });
  }

  @Post("/deleteSystem")
  @ApiOperation({ summary: "Delete a system" })
  @ApiResponse({ type: Object })
  async deleteSite(@Body() body: Record<string, unknown>) {
    const appId = body.appId;
    const type = body.type;
    if (!appId) throw new Error("Delete a system: appId must not be empty");
    const result = await this.site.deleteSite(String(appId), String(type));
    return func.result({ data: result });
  }
}
