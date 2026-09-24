import {Body, Controller, Get, Post, Query} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Prisma} from '@generated/prisma/client';
import {LarkMessageBotService} from './lark.service';
import {ListMessageBotMessagesRequestDto, ListMessageBotMessagesResponseDto} from '../message-bot.dto';
import {
  LarkMessageBotSendMessageReqDto,
  LarkMessageBotSendMessageResDto,
  LarkMessageBotSendTextMessageReqDto,
} from './lark.dto';

@ApiTags('Message Bot / Lark Message')
@ApiBearerAuth()
@Controller('lark-messages')
export class LarkMessageController {
  constructor(
    private larkMessageBotService: LarkMessageBotService,
    private readonly prisma: PrismaService
  ) {}

  @Get('')
  @ApiOperation({summary: 'List delivery records of a Lark channel'})
  @ApiResponse({type: ListMessageBotMessagesResponseDto})
  async listMessages(@Query() query: ListMessageBotMessagesRequestDto) {
    const {page, pageSize, channelId} = query;
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.MessageBotRecord,
      pagination: {page, pageSize},
      findManyArgs: {
        where: {channelId},
        orderBy: {id: 'desc'},
      },
    });
  }

  @Post('send')
  @ApiOperation({summary: 'Send a structured message to a Lark channel webhook'})
  @ApiResponse({
    type: LarkMessageBotSendMessageResDto,
  })
  async sendMessage(@Body() body: LarkMessageBotSendMessageReqDto) {
    return await this.larkMessageBotService.sendMessage(body);
  }

  @Post('send-text')
  @ApiOperation({summary: 'Send a plain text message to a Lark channel webhook'})
  @ApiResponse({
    type: LarkMessageBotSendMessageResDto,
  })
  async sendTextMessage(@Body() body: LarkMessageBotSendTextMessageReqDto) {
    return await this.larkMessageBotService.sendText(body);
  }
}
