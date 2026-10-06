import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { LlmAgentService } from "../llm-agent/llm-agent.service";
import { LarkBotService } from "../lark-bot/lark-bot.service";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);

@Injectable()
export class TaskReportService {
  private readonly logger = new Logger(TaskReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmAgentService: LlmAgentService,
    private readonly larkBotService: LarkBotService,
  ) {}

  // --- Weekly Report Management ---

  async listWeeklyReports(groupId: string, skip?: number, take?: number) {
    const total = await this.prisma.weeklyReport.count({
      where: { groupId },
    });
    const records = await this.prisma.weeklyReport.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: [{ year: "desc" }, { week: "desc" }],
      skip,
      take,
    });
    return { records, total };
  }

  async upsertWeeklyReport(groupId: string, userId: string, content: string) {
    const now = dayjs();
    const year = now.year();
    const week = now.isoWeek();

    return await this.prisma.weeklyReport.upsert({
      where: {
        groupId_userId_year_week: {
          groupId,
          userId,
          year,
          week,
        },
      },
      update: {
        content,
      },
      create: {
        groupId,
        userId,
        year,
        week,
        content,
      },
    });
  }

  async getWeeklyReport(groupId: string, userId: string, weekOffset: number = 0) {
    const targetDate = dayjs().add(weekOffset, "week");
    const year = targetDate.year();
    const week = targetDate.isoWeek();

    return await this.prisma.weeklyReport.findUnique({
      where: {
        groupId_userId_year_week: {
          groupId,
          userId,
          year,
          week,
        },
      },
      include: {
        user: true,
      },
    });
  }

  // --- Monthly Report Management ---

  async listMonthlyReports(projectId: string, skip?: number, take?: number) {
    const total = await this.prisma.monthlyReport.count({
      where: { projectId },
    });
    const records = await this.prisma.monthlyReport.findMany({
      where: { projectId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      skip,
      take,
    });
    return { records, total };
  }

  async updateMonthlyReportContent(reportId: string, content: string) {
    return await this.prisma.monthlyReport.update({
      where: { id: reportId },
      data: { content },
    });
  }

  async upsertMonthlyReport(projectId: string, year: number, month: number, content: string) {
    return await this.prisma.monthlyReport.upsert({
      where: {
        projectId_year_month: {
          projectId,
          year,
          month,
        },
      },
      update: {
        content,
      },
      create: {
        projectId,
        year,
        month,
        content,
      },
    });
  }

  async getMonthlyReport(projectId: string, year: number, month: number) {
    return await this.prisma.monthlyReport.findUnique({
      where: {
        projectId_year_month: {
          projectId,
          year,
          month,
        },
      },
      include: {
        project: true,
      },
    });
  }

  async getTasksByProjectAndDateRange(projectId: string, startDate: Date, endDate: Date) {
    return await this.prisma.task.findMany({
      where: {
        taskProjectId: projectId,
        deletedAt: null,
        OR: [
          {
            createdAt: {
              gte: startDate,
              lt: endDate,
            },
          },
          {
            updatedAt: {
              gte: startDate,
              lt: endDate,
            },
          },
        ],
      },
      include: {
        assignee: true,
        creator: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  }

  // --- AI-powered Summary ---

  async generateProjectMonthlySummary(projectName: string, year: number, month: number, tasks: any[]): Promise<string> {
    const systemPrompt = `
You are a project manager. Your task is to write a monthly summary report for the project "${projectName}" for the period of ${year}-${month}.

You are provided with a list of tasks that were active, created, updated, or completed during this month.
Analyze the tasks and provide a concise, professional, and well-structured summary.

Requirements:
- Highlight key achievements (completed tasks).
- Mention ongoing work (developing/testing tasks).
- Keep it professional, easy to read, and structured (use markdown bullet points).
- If the task list is empty, simply state that there was no recorded activity for this project in this month.

Output ONLY the report content in Markdown format. Do not output JSON.
`;

    const userContent =
      tasks.length > 0
        ? `Tasks for ${year}-${month}:\n${JSON.stringify(tasks, null, 2)}`
        : `No tasks found for ${year}-${month}.`;

    try {
      const response = await this.llmAgentService.callLLM(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        false,
      );

      return response.content || "Failed to generate report, please try again later.";
    } catch (e) {
      this.logger.error("Failed to generate project monthly summary", e);
      return "An error occurred while generating the report.";
    }
  }

  // --- Monthly Report Orchestration ---

  async generateAndSendMonthlyReportForProject(projectId: string, year: number, month: number) {
    try {
      const targetMonthDate = dayjs()
        .year(year)
        .month(month - 1);
      const startDate = targetMonthDate.startOf("month").toDate();
      const endDate = targetMonthDate.endOf("month").toDate();

      const project = await this.prisma.taskProject.findUnique({
        where: { id: projectId },
        include: { group: true },
      });
      if (!project) {
        throw new Error(`Project with ID ${projectId} not found.`);
      }

      const tasks = await this.getTasksByProjectAndDateRange(project.id, startDate, endDate);
      const summaryContent = await this.generateProjectMonthlySummary(project.name, year, month, tasks);
      await this.upsertMonthlyReport(project.id, year, month, summaryContent);

      this.logger.log(`Successfully generated monthly report for project: ${project.name} (${year}-${month})`);

      if (project.group && project.group.chatId) {
        await this.sendMonthlyReportCard(project.group.chatId, {
          projectName: project.name,
          year,
          month,
          content: summaryContent,
        });
      }

      return { success: true, message: "Monthly report generated successfully.", year, month };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to generate monthly report for project ${projectId}`, e);
      return { success: false, error: message };
    }
  }

  private async sendMonthlyReportCard(
    chatId: string,
    report: { projectName: string; year: number; month: number; content: string },
  ) {
    const card = {
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { content: `📊 项目月报: ${report.projectName}`, tag: "plain_text" },
      },
      elements: [
        {
          tag: "div",
          text: {
            content: `**${report.year}年${report.month}月 总结**\n\n${report.content}`,
            tag: "lark_md",
          },
        },
      ],
    };

    try {
      await this.larkBotService.sendCard({ receiveId: chatId, card });
    } catch (e) {
      this.logger.error(`Failed to send monthly report card to chat ${chatId}`, e);
    }
  }
}
