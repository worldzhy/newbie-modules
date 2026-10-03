import {Body, Controller, HttpCode, HttpStatus, Post, Res} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {Response} from 'express';
import {AiAnalysisService} from './ai-analysis.service';
import {AiAnalysisChatDto} from './ai-analysis.dto';

@ApiTags('AI Analysis')
@Controller('ai-analysis')
export class AiAnalysisController {
  constructor(private readonly aiAnalysisService: AiAnalysisService) {}

  /**
   * Accepts a user message and streams back AI analysis results via SSE.
   *
   * The response is a stream of Server-Sent Events. Each event carries a JSON
   * payload with a "type" field indicating its kind:
   *
   *   - type: "token"          — a single incremental AI text token (for live typing)
   *   - type: "block"          — a fully resolved response block (text / chart / table)
   *   - type: "analysis-start" — signals the start of the post-query insight summary
   *   - type: "analysis-token" — incremental token for the insight summary stream
   *   - type: "analysis-done"  — signals the end of the insight summary
   *   - type: "error"          — an error message
   *   - type: "done"           — signals the end of the entire stream
   *
   * Requires JWT authentication — the user must be logged in.
   * The applicationId in the body scopes data queries so users can only
   * analyze data belonging to their own applications.
   */
  @ApiOperation({summary: 'Chat with AI for data analysis (streaming SSE)'})
  @ApiResponse({status: 200, description: 'SSE stream of AI analysis results.', type: String})
  @ApiResponse({status: 401, description: 'Invalid application token or not authenticated.'})
  @HttpCode(HttpStatus.OK)
  @Post('chat')
  async chat(@Body() body: AiAnalysisChatDto, @Res() res: Response) {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.flushHeaders();

    try {
      await this.aiAnalysisService.chatStream(body, (event: string, data: any) => {
        if (event === '__keepalive__') {
          // SSE comment — keeps the connection alive, clients ignore it
          res.write(': keepalive\n\n');
        } else {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      });
    } catch (error) {
      res.write(
        `event: error\ndata: ${JSON.stringify({message: error instanceof Error ? error.message : 'Unknown error'})}\n\n`
      );
    }

    // Signal stream end
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  }
}
