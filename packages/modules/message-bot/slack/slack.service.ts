import { HttpService } from "@nestjs/axios";
import { AxiosError, AxiosResponse } from "axios";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { MessageBotRecordStatus, MessageBotProvider } from "../message-bot.constants";
import { assertAllowedWebhook, WEBHOOK_TIMEOUT_MS } from "../webhook-url";
import { SendSlackMessageRequestDto, SendSlackMessageResponseDto, SendSlackTextMessageRequestDto } from "./slack.dto";
import { SlackMessageBotSendMessageReqBody, SlackMessageBotSendMessageRes } from "./slack.interface";

@Injectable()
export class SlackMessageBotService {
  constructor(
    private httpService: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  async sendMessage(req: SendSlackMessageRequestDto): Promise<SendSlackMessageResponseDto> {
    const { channelId, body } = req;
    const channel = await this.prisma.messageBotChannel.findUniqueOrThrow({
      where: { id: channelId },
    });

    // Re-check at send time: rows written before the allowlist existed, or by
    // a direct database write, must not turn into outbound requests.
    assertAllowedWebhook(channel.webhook, MessageBotProvider.Slack);

    const newRecord = await this.prisma.messageBotRecord.create({
      data: {
        channelId: channel.id,
        webhook: channel.webhook,
        status: MessageBotRecordStatus.Pending,
        request: body as object,
      },
    });

    const result: SendSlackMessageResponseDto = await this.httpService.axiosRef
      .post<SlackMessageBotSendMessageReqBody, AxiosResponse<SlackMessageBotSendMessageRes>>(channel.webhook, body, {
        timeout: WEBHOOK_TIMEOUT_MS,
      })
      .then((res) => {
        return { res: res.data };
      })
      .catch((e: AxiosError) => {
        return { error: { message: e.response?.data } };
      });

    await this.prisma.messageBotRecord.update({
      where: { id: newRecord.id },
      data: {
        response: result as object,
        status: result.error ? MessageBotRecordStatus.Failed : MessageBotRecordStatus.Succeeded,
      },
    });

    return result;
  }

  async sendText(params: SendSlackTextMessageRequestDto): Promise<SendSlackMessageResponseDto> {
    return await this.sendMessage({
      channelId: params.channelId,
      body: { text: params.text },
    });
  }
}
