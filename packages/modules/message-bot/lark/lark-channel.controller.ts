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

@ApiTags('Message Bot / Lark Channel')
@ApiBearerAuth()
@Controller('lark-channels')
export class LarkChannelController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('')
  @ApiOperation({summary: 'List Lark message channels'})
  @ApiResponse({type: ListMessageBotChannelsResponseDto})
  async listChannels(@Query() query: ListMessageBotChannelsRequestDto) {
    const {page, pageSize, groupId} = query;
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.MessageBotChannel,
      pagination: {page, pageSize},
      findManyArgs: {
        where: {platform: MessageBotPlatform.Lark, groupId},
      },
    });
  }

  @Post('')
  @ApiOperation({summary: 'Create a Lark message channel'})
  @ApiResponse({type: MessageBotChannelDetailResDto})
  async createChannel(@Body() body: CreateMessageBotChannelRequestDto) {
    return await this.prisma.messageBotChannel.create({
      data: {...body, platform: MessageBotPlatform.Lark},
    });
  }

  @Patch(':id')
  @ApiOperation({summary: 'Update a Lark message channel'})
  @ApiResponse({type: MessageBotChannelDetailResDto})
  async updateChannel(@Param('id') id: string, @Body() body: UpdateMessageBotChannelRequestDto) {
    return await this.prisma.messageBotChannel.update({
      where: {id},
      data: body,
    });
  }

  @Delete(':id')
  @ApiOperation({summary: 'Delete a Lark message channel'})
  @ApiResponse({type: MessageBotChannelDetailResDto})
  async deleteChannel(@Param('id') id: string) {
    return await this.prisma.messageBotChannel.delete({
      where: {id},
    });
  }
}
