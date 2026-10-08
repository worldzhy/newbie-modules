import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from "@nestjs/swagger";
import { LarkBotService } from "./lark-bot.service";
import { GetChatHistoryDto, LarkWebhookDto, SendTextDto } from "./lark-bot.dto";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";

@ApiTags("Lark Bot")
@Controller("lark-bot")
export class LarkBotController {
  constructor(private readonly larkBotService: LarkBotService) {}

  @Post("history")
  @ApiOperation({ summary: "Get chat history from Lark group" })
  @ApiBearerAuth()
  @ApiResponse({ type: Object })
  @UseGuards(AuthGuard("jwt"))
  async getChatHistory(@Body() dto: GetChatHistoryDto) {
    return await this.larkBotService.getChatHistory(dto);
  }

  @Post("send-text")
  @ApiOperation({ summary: "Send a text message to a user or group" })
  @ApiBearerAuth()
  @ApiResponse({ type: Object })
  @UseGuards(AuthGuard("jwt"))
  async sendText(@Body() dto: SendTextDto) {
    return await this.larkBotService.sendText(dto);
  }

  /**
   * Lark pushes message events to this callback. There is no human user
   * session to attach a JWT to; Lark is the caller and identifies itself via
   * the app_id / tenant_key in the payload. @NoGuard() opens the endpoint so
   * the global default JWT guard does not reject these callbacks with 401.
   */
  @Post("webhook")
  @ApiOperation({ summary: "Lark Webhook Callback" })
  @ApiResponse({ type: Object })
  @HttpCode(HttpStatus.OK)
  @NoGuard()
  async webhook(@Body() dto: LarkWebhookDto) {
    return await this.larkBotService.handleWebhook(dto);
  }
}
