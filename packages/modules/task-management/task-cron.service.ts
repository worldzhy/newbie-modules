import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { TaskService } from "./task.service";
import { TaskReportService } from "./task-report.service";
import { LarkBotService } from "../lark-bot/lark-bot.service";
import dayjs from "dayjs";
import * as chineseDays from "chinese-days";

@Injectable()
export class TaskCronService {
  private readonly logger = new Logger(TaskCronService.name);

  constructor(
    private readonly taskService: TaskService,
    private readonly taskReportService: TaskReportService,
    private readonly larkBotService: LarkBotService,
  ) {}

  /**
   * Run every Friday at 14:30
   */
  @Cron("0 30 14 * * 5", {
    name: "weeklySummaryReminder",
    timeZone: "Asia/Shanghai",
  })
  async triggerWeeklySummaryReminder() {
    this.logger.log("Running weekly summary reminder cron job...");

    const isHoliday = await this.checkIfTodayIsHoliday();
    if (isHoliday) {
      this.logger.log("Today is a public holiday. Skipping weekly summary reminder.");
      return;
    }

    try {
      const groups = await this.taskService.listGroups();

      for (const group of groups) {
        if (group.chatId && group.chatId !== "DEFAULT_GROUP") {
          await this.sendReminderCard(group.chatId);
        }
      }
      this.logger.log(`Weekly summary reminder sent to ${groups.length} groups.`);
    } catch (error) {
      this.logger.error("Failed to execute weekly summary reminder cron job", error);
    }
  }

  private async checkIfTodayIsHoliday(): Promise<boolean> {
    try {
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

      if (chineseDays.isHoliday(today)) {
        return true;
      }

      if (!chineseDays.isWorkday(today)) {
        return true;
      }

      return false;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Failed to check holiday status: ${message}. Defaulting to working day.`);
      return false;
    }
  }

  @Cron("0 0 1 * *", {
    name: "monthlyProjectSummary",
    timeZone: "Asia/Shanghai",
  })
  async triggerMonthlyProjectSummary() {
    this.logger.log("Running monthly project summary cron job...");

    try {
      const now = dayjs();
      const lastMonthDate = now.subtract(1, "month");
      const year = lastMonthDate.year();
      const month = lastMonthDate.month() + 1;

      const projects = await this.taskService.getAllProjects();

      for (const project of projects) {
        await this.taskReportService.generateAndSendMonthlyReportForProject(project.id, year, month);
      }
    } catch (error) {
      this.logger.error("Failed to execute monthly project summary cron job", error);
    }
  }

  private async sendReminderCard(chatId: string) {
    const card = {
      config: { wide_screen_mode: true },
      header: {
        template: "orange",
        title: { content: "📝 周总结提交提醒", tag: "plain_text" },
      },
      elements: [
        {
          tag: "div",
          text: {
            content: "本周的工作即将结束，请各位同学记得提交本周的**周总结**哦！",
            tag: "lark_md",
          },
        },
        { tag: "hr" },
        {
          tag: "note",
          elements: [
            {
              tag: "plain_text",
              content: "你可以随时对我说：“我的任务有哪些” 来回顾本周的待办事项。",
            },
          ],
        },
      ],
    };

    try {
      await this.larkBotService.sendCard({ receiveId: chatId, card });
    } catch (e) {
      this.logger.error(`Failed to send reminder card to chat ${chatId}`, e);
    }
  }
}
