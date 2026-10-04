import { Controller, Get, Post, Body, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SiteService } from "./site.service";
import { func } from "../../shared/utils";
import { WebMonitorSiteResponseDto } from "./site.dto";

@ApiTags("Frontend Monitor / System")
@Controller("/api/v1/system")
export class SiteController {
  constructor(private readonly site: SiteService) {}

  @Post("/add")
  @ApiOperation({ summary: "Add a new monitoring system" })
  @ApiResponse({ type: Object })
  async addNewSite(@Body() body: any) {
    const res = await this.site.saveSiteData(body);
    return res;
  }

  @Post("/update")
  @ApiOperation({ summary: "Update a monitoring system" })
  @ApiResponse({ type: Object })
  async updateSite(@Body() body: any) {
    const res = await this.site.updateSiteData(body);
    return res;
  }

  @Get("/getSysForUserId")
  @ApiOperation({ summary: "Get systems for a user" })
  @ApiResponse({ type: WebMonitorSiteResponseDto, isArray: true })
  async getSitesForUserId(@Query() query: any) {
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

  @Get("/web/list")
  @ApiOperation({ summary: "Get web system list" })
  @ApiResponse({ type: WebMonitorSiteResponseDto, isArray: true })
  async getWebSiteList() {
    const result = await this.site.getWebSiteList();
    return func.result({ data: result });
  }

  @Post("/deleteUser")
  @ApiOperation({ summary: "Delete a user from a system" })
  @ApiResponse({ type: Object })
  async deleteWebSiteUser(@Body() body: any) {
    const appId = body.appId;
    const userToken = body.userToken;
    if (!appId) throw new Error("Delete a user from the system: appId must not be empty");
    if (!userToken) throw new Error("Delete a user from the system: user token must not be empty");
    const result = await this.site.deleteWebSiteUser(appId, userToken);
    return func.result({ data: result });
  }

  @Post("/addUser")
  @ApiOperation({ summary: "Add a user to a system" })
  @ApiResponse({ type: Object })
  async addWebSiteUser(@Body() body: any) {
    const appId = body.appId;
    const userToken = body.userToken;
    if (!appId) throw new Error("Add a user to the system: appId must not be empty");
    if (!userToken) throw new Error("Add a user to the system: user token must not be empty");
    const result = await this.site.addWebSiteUser(appId, userToken);
    return func.result({ data: result });
  }

  @Post("/deleteSystem")
  @ApiOperation({ summary: "Delete a system" })
  @ApiResponse({ type: Object })
  async deleteSite(@Body() body: any): Promise<any> {
    const appId = body.appId;
    const type = body.type;
    if (!appId) throw new Error("Delete a system: appId must not be empty");
    const result = await this.site.deleteSite(appId, type);
    return func.result({ data: result });
  }
}
