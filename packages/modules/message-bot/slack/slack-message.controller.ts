import {Body, Controller, Get, Post, Query} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Prisma} from '@generated/prisma/client';
import {SlackMessageBotService} from '@microservices/message-bot/slack/slack.service';
import {ListMessageBotMessagesRequestDto, ListMessageBotMessagesResponseDto} from '../message-bot.dto';
import {SendSlackMessageRequestDto, SendSlackMessageResponseDto, SendSlackTextMessageRequestDto} from './slack.dto';

@ApiTags('Message Bot / Slack Message')
@ApiBearerAuth()
@Controller('slack-messages')
export class SlackMessageController {
  constructor(
    private slackMessageBotService: SlackMessageBotService,
    private readonly prisma: PrismaService
  ) {}

  @Get('')
  @ApiOperation({summary: 'List delivery records of a Slack channel'})
  @ApiResponse({type: ListMessageBotMessagesResponseDto})
  async recordList(@Query() query: ListMessageBotMessagesRequestDto) {
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
  @ApiOperation({summary: 'Send a structured message to a Slack incoming webhook'})
  @ApiResponse({type: SendSlackMessageResponseDto})
  async send(@Body() body: SendSlackMessageRequestDto) {
    return await this.slackMessageBotService.sendMessage(body);
  }

  @Post('send-text')
  @ApiOperation({summary: 'Send a plain text message to a Slack incoming webhook'})
  @ApiResponse({type: SendSlackMessageResponseDto})
  async sendText(@Body() body: SendSlackTextMessageRequestDto) {
    return await this.slackMessageBotService.sendText(body);
  }
}
