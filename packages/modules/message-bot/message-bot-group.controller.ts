import {Controller, Post, Body, Get, Query, Patch, Delete, Param} from '@nestjs/common';
import {ApiTags, ApiBearerAuth, ApiOperation, ApiResponse} from '@nestjs/swagger';
import {Prisma} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {CommonGetByStringIdRequestDto} from '@devbie/newbie/common.dto';
import {
  CreateMessageBotChannelGroupRequestDto,
  UpdateMessageBotChannelGroupRequestDto,
  ListMessageBotChannelGroupsRequestDto,
  ListMessageBotChannelGroupsResponseDto,
} from './message-bot-group.dto';
import {MessageBotChannelGroupEntity} from './message-bot.entity';

@ApiTags('MessageBot')
@ApiBearerAuth()
@Controller('message-bot-groups')
export class MessageBotChannelGroupController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({summary: 'List message channel groups'})
  @ApiResponse({type: ListMessageBotChannelGroupsResponseDto})
  async list(@Query() query: ListMessageBotChannelGroupsRequestDto) {
    const {page, pageSize, id} = query;
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.MessageBotChannelGroup,
      pagination: {page, pageSize},
      findManyArgs: {where: {id}, orderBy: {sort: 'desc'}},
    });
  }

  @Post()
  @ApiOperation({summary: 'Create a message channel group'})
  @ApiResponse({type: MessageBotChannelGroupEntity})
  async create(@Body() body: CreateMessageBotChannelGroupRequestDto) {
    return await this.prisma.messageBotChannelGroup.create({data: body});
  }

  @Patch(':id')
  @ApiOperation({summary: 'Update a message channel group'})
  @ApiResponse({type: MessageBotChannelGroupEntity})
  async update(@Param() params: CommonGetByStringIdRequestDto, @Body() body: UpdateMessageBotChannelGroupRequestDto) {
    return await this.prisma.messageBotChannelGroup.update({where: {id: params.id}, data: body});
  }

  @Delete(':id')
  @ApiOperation({summary: 'Delete a message channel group'})
  @ApiResponse({type: MessageBotChannelGroupEntity})
  async delete(@Param() params: CommonGetByStringIdRequestDto) {
    return await this.prisma.messageBotChannelGroup.delete({where: {id: params.id}});
  }
}
