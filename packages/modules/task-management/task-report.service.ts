import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { LlmAgentService } from "../llm-agent/llm-agent.service";
import { LarkBotService } from "../lark-bot/lark-bot.service";
import dayjs from "dayjs";

@Injectable()
export class TaskReportService {
  private readonly logger = new Logger(TaskReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmAgentService: LlmAgentService,
    private readonly larkBotService: LarkBotService,
  ) {}

  // --- Weekly Reports ---

  async listWeeklyReports(
    groupId: string,
    options?: { userId?: string; year?: number; week?: number; skip?: number; take?: number },
  ) {
    const { userId, year, week, skip = 0, take = 10 } = options || {};
    const whereClause: any = { groupId };
    if (userId) whereClause.userId = userId;
    if (year) whereClause.year = year;
    if (week) whereClause.week = week;

    const [records, total] = await Promise.all([
      this.prisma.weeklyReport.findMany({
        where: whereClause,
        include: { user: true },
        orderBy: [{ year: "desc" }, { week: "desc" }],
        skip,
        take,
      }),
      this.prisma.weeklyReport.count({ where: whereClause }),
    ]);

    return { records, total };
  }

  async upsertWeeklyReport(groupId: string, userId: string, year: number, week: number, content: string) {
    return this.prisma.weeklyReport.upsert({
      where: {
        groupId_userId_year_week: { groupId, userId, year, week },
      },
      update: { content },
      create: { groupId, userId, year, week, content },
    });
  }

  async getWeeklyReport(groupId: string, userId: string, year: number, week: number) {
    return this.prisma.weeklyReport.findUnique({
      where: {
        groupId_userId_year_week: { groupId, userId, year, week },
      },
    });
  }

  // --- Monthly Reports ---

  async listMonthlyReports(
    projectId: string,
    options?: { year?: number; month?: number; skip?: number; take?: number },
  ) {
    const { year, month, skip = 0, take = 10 } = options || {};
    const whereClause: any = { projectId };
    if (year) whereClause.year = year;
    if (month) whereClause.month = month;

    const [records, total] = await Promise.all([
      this.prisma.monthlyReport.findMany({
        where: whereClause,
        orderBy: [{ year: "desc" }, { month: "desc" }],
        skip,
        take,
      }),
      this.prisma.monthlyReport.count({ where: whereClause }),
    ]);

    return { records, total };
  }

  async updateMonthlyReportContent(id: string, content: string) {
    return this.prisma.monthlyReport.update({
      where: { id },
      data: { content },
    });
  }

  async upsertMonthlyReport(projectId: string, year: number, month: number, content: string) {
    return this.prisma.monthlyReport.upsert({
      where: {
        projectId_year_month: { projectId, year, month },
      },
      update: { content },
      create: { projectId, year, month, content },
    });
  }

  async getMonthlyReport(projectId: string, year: number, month: number) {
    return this.prisma.monthlyReport.findUnique({
      where: {
        projectId_year_month: { projectId, year, month },
      },
    });
  }

  async getTasksByProjectAndDateRange(projectId: string, startDate: Date, endDate: Date) {
    return this.prisma.task.findMany({
      where: {
        taskProjectId: projectId,
        deletedAt: null,
        updatedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        creator: true,
        assignee: true,
      },
      orderBy: { updatedAt: "asc" },
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

      const project = await this.prisma.taskProject.findUnique({ where: { id: projectId } });
      if (!project) {
        throw new Error(`Project with ID ${projectId} not found.`);
      }

      const tasks = await this.getTasksByProjectAndDateRange(project.id, startDate, endDate);
      const summaryContent = await this.generateProjectMonthlySummary(project.name, year, month, tasks);
      await this.upsertMonthlyReport(project.id, year, month, summaryContent);

      this.logger.log(`Successfully generated monthly report for project: ${project.name} (${year}-${month})`);

      const group = await this.prisma.taskGroup.findUnique({ where: { id: project.groupId } });
      if (group && group.chatId && group.chatId !== "DEFAULT_GROUP") {
        await this.sendMonthlyReportCard(group.chatId, {
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
