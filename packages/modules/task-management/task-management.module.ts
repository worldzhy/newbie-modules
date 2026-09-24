import {Module} from '@nestjs/common';
import {TaskService} from './task.service.js';
import {TaskController} from './task.controller.js';
import {TaskCronService} from './task-cron.service';
import {PrismaModule} from '../../framework/prisma/prisma.module';
import {LarkBotModule} from '../lark-bot/lark-bot.module';
import {LlmAgentModule} from '../llm-agent/llm-agent.module';
import {HttpModule} from '@nestjs/axios';

@Module({
  imports: [PrismaModule, LarkBotModule, LlmAgentModule, HttpModule],
  controllers: [TaskController],
  providers: [TaskService, TaskCronService],
  exports: [TaskService, TaskCronService],
})
export class TaskManagementModule {}
