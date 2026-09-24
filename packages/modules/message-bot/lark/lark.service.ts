import {HttpService} from '@nestjs/axios';
import {AxiosResponse, AxiosError} from 'axios';
import {Injectable} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {MessageBotRecordStatus} from '../message-bot.constants';
import {LarkWebhookSendStatus} from './lark.constants';
import {
  LarkMessageBotSendTextMessageReqDto,
  LarkMessageBotSendMessageReqDto,
  LarkMessageBotSendMessageResDto,
} from './lark.dto';
import {LarkMessageBotSendMessageRes, LarkMessageBotSendMessageReqBody} from './lark.interface';

@Injectable()
export class LarkMessageBotService {
  constructor(
    private httpService: HttpService,
    private readonly prisma: PrismaService
  ) {}

  async sendMessage(req: LarkMessageBotSendMessageReqDto): Promise<LarkMessageBotSendMessageResDto> {
    const {channelId, body} = req;
    const channel = await this.prisma.messageBotChannel.findUniqueOrThrow({
      where: {id: channelId},
    });

    const newRecord = await this.prisma.messageBotRecord.create({
      data: {
        channelId: channel.id,
        webhook: channel.webhook,
        status: MessageBotRecordStatus.Pending,
        request: body as object,
      },
    });

    const result: LarkMessageBotSendMessageResDto = await this.httpService.axiosRef
      .post<LarkMessageBotSendMessageReqBody, AxiosResponse<LarkMessageBotSendMessageRes>>(channel.webhook, body)
      .then(res => {
        if (res.data.code === LarkWebhookSendStatus.Succeeded) {
          return {res: res.data};
        } else {
          return {error: res.data};
        }
      })
      .catch((e: AxiosError) => {
        return {error: {message: e.message, response: e.response}};
      });

    await this.prisma.messageBotRecord.update({
      where: {id: newRecord.id},
      data: {
        response: result as object,
        status: result.error ? MessageBotRecordStatus.Failed : MessageBotRecordStatus.Succeeded,
      },
    });

    return result;
  }

  async sendText(params: LarkMessageBotSendTextMessageReqDto): Promise<LarkMessageBotSendMessageResDto> {
    return await this.sendMessage({
      channelId: params.channelId,
      body: {msg_type: 'text', content: {text: params.text}},
    });
  }
}
