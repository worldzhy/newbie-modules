import {Body, Controller, Delete, Get, Param, Patch, Post, Query} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Prisma} from '@generated/prisma/client';
import {
  CreateMessageBotChannelRequestDto,
  ListMessageBotChannelsRequestDto,
  ListMessageBotChannelsResponseDto,
  MessageBotChannelDetailResDto,
  UpdateMessageBotChannelRequestDto,
} from '../message-bot.dto';
import {MessageBotPlatform} from '../message-bot.constants';

@ApiTags('Message Bot / Slack Channel')
@ApiBearerAuth()
@Controller('slack-channels')
export class SlackChannelController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('')
  @ApiOperation({summary: 'Create a Slack message channel'})
  @ApiResponse({type: MessageBotChannelDetailResDto})
  async channelCreate(@Body() body: CreateMessageBotChannelRequestDto) {
    return await this.prisma.messageBotChannel.create({
      data: {...body, platform: MessageBotPlatform.Slack},
    });
  }

  @Patch(':id')
  @ApiOperation({summary: 'Update a Slack message channel'})
  @ApiResponse({type: MessageBotChannelDetailResDto})
  async channelUpdate(@Param('id') id: string, @Body() body: UpdateMessageBotChannelRequestDto) {
    return await this.prisma.messageBotChannel.update({
      where: {id},
      data: body,
    });
  }

  @Delete(':id')
  @ApiOperation({summary: 'Delete a Slack message channel'})
  @ApiResponse({type: MessageBotChannelDetailResDto})
  async channelDelete(@Param('id') id: string) {
    return await this.prisma.messageBotChannel.delete({
      where: {id},
    });
  }

  @Get('')
  @ApiOperation({summary: 'List Slack message channels'})
  @ApiResponse({type: ListMessageBotChannelsResponseDto})
  async channelList(@Query() query: ListMessageBotChannelsRequestDto) {
    const {page, pageSize, groupId} = query;
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.MessageBotChannel,
      pagination: {page, pageSize},
      findManyArgs: {
        where: {platform: MessageBotPlatform.Slack, groupId},
      },
    });
  }
}
