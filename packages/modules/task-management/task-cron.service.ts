import {Injectable, Logger} from '@nestjs/common';
import {Cron} from '@nestjs/schedule';
import {TaskService} from './task.service';
import {LarkBotService} from '../lark-bot/lark-bot.service';
import {LlmAgentService} from '../llm-agent/llm-agent.service';
import dayjs from 'dayjs';
import * as chineseDays from 'chinese-days';

@Injectable()
export class TaskCronService {
  private readonly logger = new Logger(TaskCronService.name);

  constructor(
    private readonly taskService: TaskService,
    private readonly larkBotService: LarkBotService,
    private readonly llmAgentService: LlmAgentService
  ) {}

  /**
   * Run every Friday at 14:30
   * 0 30 14 * * 5
   * Second: 0, Minute: 30, Hour: 14, Day of Month: *, Month: *, Day of Week: 5 (Friday)
   */
  @Cron('0 30 14 * * 5', {
    name: 'weeklySummaryReminder',
    timeZone: 'Asia/Shanghai',
  })
  async triggerWeeklySummaryReminder() {
    this.logger.log('Running weekly summary reminder cron job...');

    // 1. Check if today is a public holiday
    // Simple weekend check is already handled by cron expression (runs on Friday).
    // For Chinese public holidays, we would ideally call an external API.
    // For now, we assume it's a working day unless we integrate a specific calendar API.
    const isHoliday = await this.checkIfTodayIsHoliday();
    if (isHoliday) {
      this.logger.log('Today is a public holiday. Skipping weekly summary reminder.');
      return;
    }

    // 2. Fetch all groups
    try {
      const groups = await this.taskService.listGroups();

      // 3. Send reminder card to each group
      for (const group of groups) {
        if (group.chatId && group.chatId !== 'DEFAULT_GROUP') {
          await this.sendReminderCard(group.chatId);
        }
      }
      this.logger.log(`Weekly summary reminder sent to ${groups.length} groups.`);
    } catch (error) {
      this.logger.error('Failed to execute weekly summary reminder cron job', error);
    }
  }

  private async checkIfTodayIsHoliday(): Promise<boolean> {
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      // Use chinese-days to check if today is a holiday locally
      if (chineseDays.isHoliday(today)) {
        return true;
      }

      // isWorkday checks for normal workdays and special weekend make-up workdays
      if (!chineseDays.isWorkday(today)) {
        return true; // It's a normal weekend, not a make-up workday
      }

      return false;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Failed to check holiday status: ${message}. Defaulting to working day.`);
      return false;
    }
  }

  @Cron('0 0 1 * *', {
    name: 'monthlyProjectSummary',
    timeZone: 'Asia/Shanghai',
  })
  async triggerMonthlyProjectSummary() {
    this.logger.log('Running monthly project summary cron job...');

    try {
      const now = dayjs();
      // The report is for the previous month
      const lastMonthDate = now.subtract(1, 'month');
      const year = lastMonthDate.year();
      const month = lastMonthDate.month() + 1; // dayjs month is 0-indexed

      const projects = await this.taskService.getAllProjects();

      for (const project of projects) {
        await this.generateAndSendMonthlyReportForProject(project.id, year, month);
      }
    } catch (error) {
      this.logger.error('Failed to execute monthly project summary cron job', error);
    }
  }

  async generateAndSendMonthlyReportForProject(projectId: string, year: number, month: number) {
    try {
      // Calculate start and end date for the given year and month
      // dayjs month is 0-indexed, so we subtract 1
      const targetMonthDate = dayjs()
        .year(year)
        .month(month - 1);
      const startDate = targetMonthDate.startOf('month').toDate();
      const endDate = targetMonthDate.endOf('month').toDate();

      const projects = await this.taskService.getAllProjects();
      const project = projects.find(p => p.id === projectId);
      if (!project) {
        throw new Error(`Project with ID ${projectId} not found.`);
      }

      const tasks = await this.taskService.getTasksByProjectAndDateRange(project.id, startDate, endDate);
      const summaryContent = await this.llmAgentService.generateProjectMonthlySummary(project.name, year, month, tasks);

      await this.taskService.upsertMonthlyReport(project.id, year, month, summaryContent);

      this.logger.log(`Successfully generated monthly report for project: ${project.name} (${year}-${month})`);

      // 自动发送卡片到对应的群组
      if (project.group && project.group.chatId) {
        await this.sendMonthlyReportCard(project.group.chatId, {
          projectName: project.name,
          year,
          month,
          content: summaryContent,
        });
      }

      return {success: true, message: 'Monthly report generated successfully.', year, month};
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to generate monthly report for project ${projectId}`, e);
      return {success: false, error: message};
    }
  }

  private async sendMonthlyReportCard(
    chatId: string,
    report: {projectName: string; year: number; month: number; content: string}
  ) {
    const card = {
      config: {wide_screen_mode: true},
      header: {
        template: 'blue',
        title: {content: `📊 项目月报: ${report.projectName}`, tag: 'plain_text'},
      },
      elements: [
        {
          tag: 'div',
          text: {
            content: `**${report.year}年${report.month}月 总结**\n\n${report.content}`,
            tag: 'lark_md',
          },
        },
      ],
    };

    try {
      await this.larkBotService.sendCard({receiveId: chatId, card});
    } catch (e) {
      this.logger.error(`Failed to send monthly report card to chat ${chatId}`, e);
    }
  }

  private async sendReminderCard(chatId: string) {
    const card = {
      config: {wide_screen_mode: true},
      header: {
        template: 'orange',
        title: {content: '📝 周总结提交提醒', tag: 'plain_text'},
      },
      elements: [
        {
          tag: 'div',
          text: {
            content: '本周的工作即将结束，请各位同学记得提交本周的**周总结**哦！',
            tag: 'lark_md',
          },
        },
        {tag: 'hr'},
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: '你可以随时对我说：“我的任务有哪些” 来回顾本周的待办事项。',
            },
          ],
        },
      ],
    };

    try {
      await this.larkBotService.sendCard({receiveId: chatId, card});
    } catch (e) {
      this.logger.error(`Failed to send reminder card to chat ${chatId}`, e);
    }
  }
}
