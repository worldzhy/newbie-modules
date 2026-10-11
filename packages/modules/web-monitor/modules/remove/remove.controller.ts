import { Controller, Post, Body } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RemoveService, type CustomDeleteFilter } from "./remove.service";
import { func } from "../../shared/utils";

@ApiTags("Frontend Monitor / Remove")
@Controller("/api/v1/remove")
export class RemoveController {
  constructor(private readonly removeService: RemoveService) {}

  @Post("/customDeleteData")
  @ApiOperation({ summary: "Custom delete monitoring data" })
  @ApiResponse({ type: Object })
  async customDelete(@Body() body: CustomDeleteFilter) {
    const result = await this.removeService.customDelete(body);
    return func.result({
      data: result,
    });
  }
}
