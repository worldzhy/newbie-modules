import {BadRequestException, Injectable, Logger, UnauthorizedException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {ClickhouseService} from '@microservices/clickhouse/clickhouse.service';
import OpenAI from 'openai';
import {AiAnalysisChatDto} from './ai-analysis.dto';

/** Maximum number of rows returned from a single ClickHouse query to prevent abuse. */
const MAX_QUERY_ROWS = 500;

/** Maximum number of rows per query result included in the post-query analysis context. */
const MAX_ANALYSIS_ROWS_PER_QUERY = 20;

/** Maximum number of query summaries to include in the analysis context. */
const MAX_ANALYSIS_QUERIES = 6;

/** Tables the AI is allowed to query. */
const ALLOWED_TABLES = ['application_request_logs', 'application_error_logs'];

/**
 * Represents the summarized result of an executed chart or table query,
 * collected during the block processing phase and used as context for
 * the post-query AI analysis pass.
 */
interface ExecutedQuerySummary {
  /** Human-readable title of the chart or table block */
  title: string;
  /** Whether the source block was a chart or table */
  blockType: 'chart' | 'table';
  /** Column names for the result set */
  columns: string[];
  /** Actual rows (limited to MAX_ANALYSIS_ROWS_PER_QUERY) */
  rows: Array<Record<string, unknown>>;
}

/** Forbidden SQL keywords to prevent destructive operations. */
const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|MERGE|CALL)\b/i;

@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);
  private client: OpenAI;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickhouseService
  ) {
    // Debug: trace the DeepSeek API key resolution
    const rawEnv = process.env.AWS_CLOUDWATCH_AI_DEEPSEEK_KEY;
    const fromConfig = this.configService.get<string>('microservices.cloudwatch.ai.deepseekKey');
    const fromConfigWrong = this.configService.get<string>('microservices.ai.deepseekKey');
    this.logger.log(
      `[DEBUG] raw env AWS_CLOUDWATCH_AI_DEEPSEEK_KEY = ${rawEnv ? `"${rawEnv.slice(0, 12)}..." (len=${rawEnv.length})` : 'UNDEFINED / EMPTY'}`
    );
    this.logger.log(
      `[DEBUG] configService.get('microservices.cloudwatch.ai.deepseekKey') = ${fromConfig ? `"${fromConfig.slice(0, 12)}..." (len=${fromConfig.length})` : 'UNDEFINED / EMPTY'}`
    );
    this.logger.log(
      `[DEBUG] configService.get('microservices.ai.deepseekKey') = ${fromConfigWrong ? `"${fromConfigWrong.slice(0, 12)}..." (len=${fromConfigWrong.length})` : 'UNDEFINED / EMPTY'}`
    );

    const apiKey = fromConfig;
    this.logger.log(
      `[DEBUG] final apiKey passed to OpenAI = ${apiKey ? `"${apiKey.slice(0, 12)}..." (len=${apiKey.length})` : 'UNDEFINED / EMPTY'}`
    );
    this.client = new OpenAI({
      apiKey: apiKey || '',
      baseURL: 'https://api.deepseek.com',
    });
  }

  /**
   * Validates that the application exists in the database by its ID.
   * @throws UnauthorizedException when the ID is invalid.
   */
  private async resolveApplication(applicationId: string) {
    const application = await this.prisma.application.findUnique({
      where: {id: applicationId},
    });
    if (!application) {
      throw new UnauthorizedException('Invalid application ID.');
    }
    return application;
  }

  /**
   * Validates a ClickHouse SQL query to ensure it is safe to execute.
   * Enforces:
   *   - Only SELECT queries (no DDL/DML, no CTEs)
   *   - Allowed tables only
   *   - Application token isolation
   *   - LIMIT capped to MAX_QUERY_ROWS (caps AI-specified values that exceed it)
   * Returns the sanitized SQL string.
   */
  private validateQuery(sql: string, applicationId: string): string {
    let trimmed = sql.trim();

    // Reject CTEs (WITH clause) — AI is instructed not to use them, but provide a clear error
    if (/^WITH\b/i.test(trimmed)) {
      throw new BadRequestException('CTEs (WITH clause) are not allowed. Write a flat SELECT query.');
    }

    // Must start with SELECT
    if (!/^SELECT\b/i.test(trimmed)) {
      throw new BadRequestException('Only SELECT queries are allowed.');
    }

    // Must not contain destructive keywords
    if (FORBIDDEN_KEYWORDS.test(trimmed)) {
      throw new BadRequestException('Query contains forbidden operations.');
    }

    // Must reference only allowed tables — check all FROM / JOIN occurrences
    const tablePattern = /\b(?:FROM|JOIN)\s+(\w+)/gi;
    let match: RegExpExecArray | null;
    while ((match = tablePattern.exec(trimmed)) !== null) {
      if (!ALLOWED_TABLES.includes(match[1].toLowerCase())) {
        throw new BadRequestException(`Table "${match[1]}" is not allowed.`);
      }
    }

    // Must include the application_id filter to enforce data isolation
    if (!trimmed.includes(applicationId)) {
      throw new BadRequestException('Query must be scoped to the current application ID.');
    }

    // Cap or add LIMIT — if AI wrote a LIMIT > MAX_QUERY_ROWS, replace it
    const limitMatch = /\bLIMIT\s+(\d+)/i.exec(trimmed);
    if (limitMatch) {
      const aiLimit = parseInt(limitMatch[1], 10);
      if (aiLimit > MAX_QUERY_ROWS) {
        trimmed = trimmed.replace(/\bLIMIT\s+\d+/i, `LIMIT ${MAX_QUERY_ROWS}`);
      }
    } else {
      // No LIMIT specified — add one
      trimmed = trimmed.replace(/;?\s*$/, '') + ` LIMIT ${MAX_QUERY_ROWS}`;
    }

    return trimmed;
  }

  /**
   * Executes a validated ClickHouse query and returns the results.
   */
  private async executeQuery(sql: string): Promise<any[]> {
    const result = await this.clickhouse.query({
      query: sql,
      format: 'JSONEachRow',
    });
    return (await result.json()) as any[];
  }

  /**
   * Builds the system prompt that instructs DeepSeek how to behave as a data analyst.
   * This prompt is comprehensive and covers:
   *   - Language rules
   *   - Table schema
   *   - 15 SQL generation rules (ClickHouse-specific)
   *   - 5 concrete SQL examples with matching response schemas
   *   - Response format specification
   *   - Block type guidelines
   */
  private buildSystemPrompt(applicationId: string): string {
    return `You are an AI data analyst for the NightWatch application monitoring platform.

## ⚠️ MANDATORY OUTPUT FORMAT — READ THIS FIRST ⚠️
You MUST ALWAYS respond with ONLY a single valid JSON object. No markdown fences, no prose, no extra text.
Structure:
{
  "blocks": [
    {
      "type": "text",
      "text": "Brief qualitative explanation (no numbers)."
    },
    {
      "type": "chart",
      "sql": "SELECT ... FROM application_request_logs WHERE application_id = '${applicationId}' ...",
      "chart": {
        "chartType": "line" | "bar" | "pie" | "doughnut",
        "title": "Chart Title",
        "labelField": "exact_sql_alias",
        "dataFields": [{"field": "exact_sql_alias", "label": "Display Label"}]
      }
    },
    {
      "type": "table",
      "sql": "SELECT ... FROM application_request_logs WHERE application_id = '${applicationId}' ...",
      "table": {
        "title": "Table Title",
        "columns": [{"field": "exact_sql_alias", "headerName": "Display Name", "width": 150}]
      }
    }
  ]
}

If you cannot produce charts/tables, return: {"blocks":[{"type":"text","text":"...explanation..."}]}

## Language
Respond in the same language as the user's message (Chinese or English).

## Scope
Only answer questions about application monitoring, performance, and error analysis.

## Database Tables

### application_request_logs
- application_id (UUID), path (String), method (String), status_code (UInt16)
- request_at (DateTime64(3)), response_at (DateTime64(3)), duration_ms (UInt32)
- ip (String), user_agent (String), created_at (DateTime64(3))

### application_error_logs
- application_id (UUID), type (String), message (String), stack (String)
- path (String), method (String), status_code (UInt16), ip (String)
- occurred_at (DateTime64(3)), created_at (DateTime64(3))

## SQL Rules

1. ALWAYS filter: WHERE application_id = '${applicationId}'
2. SELECT only. No INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/WITH.
3. No CTEs. Flat single-level SELECT only.
4. ClickHouse syntax: toDate, today, now, formatDateTime, quantile(), countIf, etc.
5. Current UTC date: ${new Date().toISOString().split('T')[0]}
6. CRITICAL alias rule: SQL column alias MUST EXACTLY match the field name in labelField/dataFields/columns (case-sensitive).
7. Default time range (when user doesn't specify): last 24 hours.
8. Time-series: \`formatDateTime(toStartOfHour(request_at), '%m-%d %H:%i') AS hour\` ORDER BY hour ASC
9. Specific date filter: \`toDate(request_at) = toDate('2026-04-21')\` (use toDate() for date strings)
10. Error rate: \`round(countIf(status_code >= 400) / count() * 100, 2) AS error_rate_pct\`
11. Percentiles: \`round(quantile(0.95)(duration_ms), 0) AS p95_ms\`
12. Avoid epoch: \`nullIf(max(request_at), toDateTime64(0, 3)) AS last_request_at\`
13. Truncate long text: \`left(message, 200) AS message\`. Never SELECT stack column.
14. LIMIT max ${MAX_QUERY_ROWS}. Always use ORDER BY.
15. Format display timestamps: \`formatDateTime(occurred_at, '%Y-%m-%d %H:%i:%S') AS occurred_at\`

## Response Guidelines
- text block: brief qualitative context only, NO numbers (you don't have DB access yet).
- chart: for trends, comparisons, distributions, rankings.
- table: for detailed records, aggregate stats.
- Use multiple blocks for comprehensive answers.
- NEVER use bracket-style context markers like [Charts/Tables shown:] or [AI Insight:].

## Examples (follow these schemas exactly)

Example 1 — Hourly request trend (line chart):
{"type":"chart","sql":"SELECT formatDateTime(toStartOfHour(request_at),'%m-%d %H:%i') AS hour, count() AS request_count FROM application_request_logs WHERE application_id='${applicationId}' AND request_at>=now()-INTERVAL 24 HOUR GROUP BY hour ORDER BY hour ASC LIMIT 500","chart":{"chartType":"line","title":"Hourly Request Volume","labelField":"hour","dataFields":[{"field":"request_count","label":"Requests"}]}}

Example 2 — Top 10 slowest paths (bar chart):
{"type":"chart","sql":"SELECT path, round(avg(duration_ms),0) AS avg_ms, round(quantile(0.95)(duration_ms),0) AS p95_ms FROM application_request_logs WHERE application_id='${applicationId}' AND request_at>=now()-INTERVAL 24 HOUR GROUP BY path ORDER BY avg_ms DESC LIMIT 10","chart":{"chartType":"bar","title":"Top 10 Slowest APIs","labelField":"path","dataFields":[{"field":"avg_ms","label":"Avg (ms)"},{"field":"p95_ms","label":"P95 (ms)"}]}}

Example 3 — Status code distribution (doughnut):
{"type":"chart","sql":"SELECT toString(status_code) AS status_code, count() AS request_count FROM application_request_logs WHERE application_id='${applicationId}' AND request_at>=now()-INTERVAL 24 HOUR GROUP BY status_code ORDER BY request_count DESC LIMIT 500","chart":{"chartType":"doughnut","title":"Status Code Distribution","labelField":"status_code","dataFields":[{"field":"request_count","label":"Count"}]}}

Example 4 — Recent errors (table):
{"type":"table","sql":"SELECT type, left(message,200) AS message, ifNull(nullIf(path,''),'-') AS path, toString(status_code) AS status_code, formatDateTime(occurred_at,'%Y-%m-%d %H:%i:%S') AS occurred_at FROM application_error_logs WHERE application_id='${applicationId}' ORDER BY occurred_at DESC LIMIT 50","table":{"title":"Recent Errors","columns":[{"field":"type","headerName":"Type","width":140},{"field":"message","headerName":"Message"},{"field":"path","headerName":"Path","width":180},{"field":"status_code","headerName":"Status","width":80},{"field":"occurred_at","headerName":"Time","width":170}]}}

Example 5 — Specific date filter (April 21):
{"type":"chart","sql":"SELECT formatDateTime(toStartOfHour(request_at),'%m-%d %H:%i') AS hour, count() AS request_count FROM application_request_logs WHERE application_id='${applicationId}' AND toDate(request_at)=toDate('2026-04-21') GROUP BY hour ORDER BY hour ASC LIMIT 500","chart":{"chartType":"bar","title":"Requests on April 21","labelField":"hour","dataFields":[{"field":"request_count","label":"Requests"}]}}`;
  }

  /**
   * Streaming entry point: processes a user chat message and pushes results
   * incrementally via the provided `emit` callback (used for SSE).
   *
   * Flow:
   * 1. Validate the application token
   * 2. Emit a "status" event so the frontend shows a progress indicator
   * 3. Call DeepSeek (non-streaming internally) to get the full query plan JSON
   * 4. Parse JSON blocks, execute SQL, and emit resolved blocks one by one
   * 5. For text blocks, stream content word-by-word for a typing effect
   * 6. After all blocks are processed, collect the real query results and make
   *    a second streaming DeepSeek call to generate a data-backed insight summary
   *    (the "post-query analysis" pass using real numbers from the database)
   */
  async chatStream(dto: AiAnalysisChatDto, emit: (event: string, data: any) => void): Promise<void> {
    // Step 1: Validate application ID
    await this.resolveApplication(dto.applicationId);

    // Step 2: Build messages for DeepSeek
    const messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}> = [
      {role: 'system', content: this.buildSystemPrompt(dto.applicationId)},
    ];

    if (dto.history && dto.history.length > 0) {
      const recentHistory = dto.history.slice(-10);
      for (const msg of recentHistory) {
        messages.push({role: msg.role, content: msg.content});
      }
    }

    messages.push({role: 'user', content: dto.message});

    // Step 3: Call DeepSeek (non-streaming). A keepalive timer fires every
    // 15 s to send SSE comment lines so the HTTP connection stays open while
    // we wait for the full response.
    emit('status', {phase: 'thinking'});

    let fullContent = '';
    const keepaliveTimer = setInterval(() => emit('__keepalive__', null), 15000);
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: 'deepseek-v4-flash',
          messages,
          temperature: 0.1,
          max_tokens: 4000,
        },
        {timeout: 120000} // 2 minute hard timeout passed as RequestOptions
      );
      fullContent = completion.choices[0]?.message?.content?.trim() ?? '';
    } catch (error) {
      this.logger.error('DeepSeek API call failed', error);
      emit('block', {type: 'text', text: 'Sorry, AI service is currently unavailable. Please try again later.'});
      return;
    } finally {
      clearInterval(keepaliveTimer);
    }

    // Step 4: Parse the accumulated AI response
    emit('status', {phase: 'querying'});

    const aiResponse = fullContent.trim();
    let parsed: {blocks: any[]};
    try {
      // Try to extract a JSON object even when the model wraps it in markdown fences
      // or adds prose before/after. Strategy:
      //   1. Strip ```json ... ``` or ``` ... ``` fences
      //   2. Find the first '{' and last '}' and extract that substring
      let cleaned = aiResponse
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');

      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }

      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn('Failed to parse AI response as JSON. Raw response starts with: ' + aiResponse.slice(0, 200));
      // Do NOT dump the raw markdown to the user — show a friendly error instead
      emit('block', {
        type: 'text',
        text: 'The AI returned an unexpected response format. Please try again or rephrase your question.',
      });
      return;
    }

    if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
      emit('block', {
        type: 'text',
        text: 'The AI response was incomplete. Please try again.',
      });
      return;
    }

    // Step 5: Execute SQL queries and emit resolved blocks one by one.
    // Also accumulate executed query results for the post-query analysis pass.
    const executedSummaries: ExecutedQuerySummary[] = [];

    for (const block of parsed.blocks) {
      try {
        if (block.type === 'text') {
          // Stream text blocks word-by-word for a typing effect
          const text = block.text || '';
          const words = text.split(/(\s+)/); // Split but keep whitespace
          for (const word of words) {
            if (word) {
              emit('text-token', {content: word});
            }
          }
          emit('text-done', {});
          continue;
        }

        if (block.type === 'chart' && block.sql && block.chart) {
          const safeSql = this.validateQuery(block.sql, dto.applicationId);
          const rows = await this.executeQuery(safeSql);

          // Emit a text notice instead of an empty chart when there's no data
          if (rows.length === 0) {
            emit('text-token', {
              content: `No data found for "${block.chart.title}". There may be no records matching the query criteria for the selected time range.`,
            });
            emit('text-done', {});
            continue;
          }

          const labels = rows.map(r => String(r[block.chart.labelField] ?? ''));
          const datasets = (block.chart.dataFields || []).map((df: {field: string; label: string}, index: number) => ({
            label: df.label,
            data: rows.map(r => Number(r[df.field]) || 0),
            backgroundColor: this.getChartColors(block.chart.chartType, rows.length, index),
            borderColor: this.getChartBorderColor(index),
          }));

          emit('block', {
            type: 'chart',
            chart: {
              chartType: block.chart.chartType,
              title: block.chart.title,
              labels,
              datasets,
            },
          });

          // Collect chart data for the post-query analysis pass
          if (executedSummaries.length < MAX_ANALYSIS_QUERIES) {
            const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
            executedSummaries.push({
              title: block.chart.title,
              blockType: 'chart',
              columns,
              rows: rows.slice(0, MAX_ANALYSIS_ROWS_PER_QUERY),
            });
          }
          continue;
        }

        if (block.type === 'table' && block.sql && block.table) {
          const safeSql = this.validateQuery(block.sql, dto.applicationId);
          const rows = await this.executeQuery(safeSql);

          emit('block', {
            type: 'table',
            table: {
              title: block.table.title,
              columns: block.table.columns,
              // If no rows, emit an empty table — the frontend shows "No data"
              rows: rows.map((row, idx) => ({id: idx, ...row})),
            },
          });

          // Collect table data for the post-query analysis pass
          if (executedSummaries.length < MAX_ANALYSIS_QUERIES) {
            const columns = block.table.columns.map((c: {field: string}) => c.field);
            executedSummaries.push({
              title: block.table.title,
              blockType: 'table',
              columns,
              rows: rows.slice(0, MAX_ANALYSIS_ROWS_PER_QUERY),
            });
          }
          continue;
        }

        if (block.text) {
          emit('block', {type: 'text', text: block.text});
        }
      } catch (error) {
        this.logger.warn(`Failed to process block: ${error}`);
        emit('block', {
          type: 'text',
          text: `Failed to execute query: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // Step 6: Post-query analysis pass.
    // If any SQL queries were successfully executed, send the actual results back
    // to AI for a second streaming call. This allows the AI to write a concrete
    // analysis with real numbers (e.g. "Today there were 1,234 requests with a
    // 2.3% error rate") instead of the qualitative-only text from step 5.
    if (executedSummaries.length > 0) {
      emit('status', {phase: 'analyzing'});
      await this.generateAnalysisSummary(dto, executedSummaries, emit);
    }
  }

  /**
   * Builds the system prompt for the post-query analysis AI call.
   * This second prompt instructs the AI to write a concrete data analysis
   * using actual numbers from the query results.
   */
  private buildAnalysisSystemPrompt(): string {
    return `You are an expert application performance analyst for the NightWatch monitoring platform.
You have been given the ACTUAL DATA retrieved from the database by a prior AI query.
Your sole task: analyze this data and produce a concise, actionable insight summary.

## Language
Respond in the SAME language as the user's original question.
Chinese question → Chinese response. English question → English response.

## Response Format
Write a plain-text analysis using ONLY these section headings (omit irrelevant sections):

**📊 Summary**
1–2 sentences on the most important finding. Include SPECIFIC NUMBERS and the time period.

**🔢 Key Metrics**
Bullet list of the most important numerical facts. Be precise — cite actual values from the data.

**⚠️ Issues Detected**
(Only include if real problems are found based on the benchmarks below.)
Describe anomalies with specific values, paths, or error types.

**📈 Trends**
Observable patterns over time (growth, spikes, quiet periods). Only if data shows a clear trend.

**💡 Recommendations**
2–3 concise, actionable suggestions based strictly on the data.

## Performance Benchmarks
Use these thresholds to evaluate health and add status emojis in your analysis:

Error Rate (4xx+5xx / total):
  < 1%    → ✅ Excellent
  1–5%    → 🟡 Normal
  5–10%   → 🟠 Warning (worth investigating)
  > 10%   → 🔴 Critical (immediate attention needed)

Average Response Time:
  < 200 ms   → ✅ Excellent
  200–500 ms → 🟡 Normal
  500–1000 ms → 🟠 Warning
  > 1000 ms  → 🔴 Critical

P95 Response Time:
  < 500 ms   → ✅ Good
  500–2000 ms → 🟡 Acceptable
  > 2000 ms  → 🔴 Tail latency issue

## Rules
1. ONLY use data provided in the query results — do NOT invent or extrapolate any numbers.
2. Include SPECIFIC NUMBERS, percentages, and counts from the data.
3. Always reference the time period being analyzed (e.g. "In the last 24 hours...").
4. Compare metrics against the benchmarks above and include the matching emoji.
5. If all data is 0 or NULL (no logs in the time range), explicitly state
   "No data recorded in this time range" and suggest the user check if reporting is enabled.
6. Keep the total response under 500 words.
7. Use plain text — \`**heading**\` renders as bold in the UI.`;
  }

  /**
   * Performs the post-query analysis pass.
   *
   * After all chart/table SQL queries have been executed and their results
   * emitted to the frontend, this method makes a second (streaming) call to
   * DeepSeek with the actual query result data. This allows the AI to write
   * a concrete analysis with real numbers instead of the qualitative-only text
   * produced in the first pass.
   *
   * Events emitted:
   *   - analysis-start  — frontend should begin rendering an analysis block
   *   - analysis-token  — incremental text chunk for streaming display
   *   - analysis-done   — analysis is complete
   */
  private async generateAnalysisSummary(
    dto: AiAnalysisChatDto,
    summaries: ExecutedQuerySummary[],
    emit: (event: string, data: any) => void
  ): Promise<void> {
    // Build a compact data-context string from all collected query summaries.
    // Each summary includes the query title, column names, and up to
    // MAX_ANALYSIS_ROWS_PER_QUERY rows of actual data.
    const dataContext = summaries
      .map(s => {
        const rowsJson = JSON.stringify(s.rows, null, 1);
        return `### ${s.title} (${s.blockType})\nColumns: ${s.columns.join(', ')}\nData:\n${rowsJson}`;
      })
      .join('\n\n');

    const analysisMessages: Array<{role: 'system' | 'user'; content: string}> = [
      {role: 'system', content: this.buildAnalysisSystemPrompt()},
      {
        role: 'user',
        content: `User's original question: "${dto.message}"\n\nActual query results from the database:\n\n${dataContext}\n\nPlease provide your analysis.`,
      },
    ];

    try {
      emit('analysis-start', {});

      // Use streaming for the analysis call to give the user real-time feedback.
      const stream = await this.client.chat.completions.create({
        model: 'deepseek-v4-flash',
        messages: analysisMessages,
        temperature: 0.2,
        max_tokens: 1200,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          emit('analysis-token', {content});
        }
      }

      emit('analysis-done', {});
    } catch (error) {
      this.logger.error('Post-query analysis summary failed', error);
      // Emit done so the frontend finalises the (possibly partial) analysis block.
      emit('analysis-done', {});
    }
  }

  /**
   * Returns appropriate colors for chart datasets based on chart type and data size.
   */
  private getChartColors(chartType: string, dataLength: number, datasetIndex: number): string | string[] {
    const colorPalette = [
      'rgba(54, 162, 235, 0.7)',
      'rgba(255, 99, 132, 0.7)',
      'rgba(255, 206, 86, 0.7)',
      'rgba(75, 192, 192, 0.7)',
      'rgba(153, 102, 255, 0.7)',
      'rgba(255, 159, 64, 0.7)',
      'rgba(199, 199, 199, 0.7)',
      'rgba(83, 102, 255, 0.7)',
      'rgba(255, 99, 255, 0.7)',
      'rgba(99, 255, 132, 0.7)',
    ];

    if (chartType === 'pie' || chartType === 'doughnut') {
      return Array.from({length: dataLength}, (_, i) => colorPalette[i % colorPalette.length]);
    }

    return colorPalette[datasetIndex % colorPalette.length];
  }

  /**
   * Returns border color for a chart dataset line.
   */
  private getChartBorderColor(index: number): string {
    const borderColors = [
      'rgba(54, 162, 235, 1)',
      'rgba(255, 99, 132, 1)',
      'rgba(255, 206, 86, 1)',
      'rgba(75, 192, 192, 1)',
      'rgba(153, 102, 255, 1)',
      'rgba(255, 159, 64, 1)',
    ];
    return borderColors[index % borderColors.length];
  }
}
