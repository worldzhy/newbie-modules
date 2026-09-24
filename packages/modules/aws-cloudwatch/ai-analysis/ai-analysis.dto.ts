import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested} from 'class-validator';
import {Type} from 'class-transformer';

/**
 * A single message in the AI conversation history.
 */
export class AiChatMessageDto {
  @ApiProperty({
    type: String,
    description: 'The role of the message sender: user or assistant',
    example: 'user',
  })
  @IsNotEmpty()
  @IsString()
  role: 'user' | 'assistant';

  @ApiProperty({
    type: String,
    description: 'The message content',
    example: 'Show me the top 5 slowest requests today',
  })
  @IsNotEmpty()
  @IsString()
  content: string;
}

/**
 * Request body for the AI analysis chat endpoint.
 */
export class AiAnalysisChatDto {
  @ApiProperty({
    type: String,
    description: 'Application ID (UUID) used to scope data queries',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsString()
  applicationId: string;

  @ApiProperty({
    type: String,
    description: 'The user message / question for AI analysis',
    example: 'Show me the top 5 slowest requests today',
  })
  @IsNotEmpty()
  @IsString()
  message: string;

  @ApiPropertyOptional({
    type: [AiChatMessageDto],
    description: 'Previous conversation history for context continuity',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({each: true})
  @Type(() => AiChatMessageDto)
  history?: AiChatMessageDto[];
}

/**
 * A single content block in the AI response.
 * Each block has a type that determines how the frontend renders it.
 */
export interface AiResponseBlock {
  /** The type of content block */
  type: 'text' | 'chart' | 'table' | 'analysis';

  /** Text content — used when type is 'text' or 'analysis' */
  text?: string;

  /** Chart configuration — used when type is 'chart' */
  chart?: {
    chartType: 'line' | 'bar' | 'pie' | 'doughnut';
    title: string;
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      backgroundColor?: string | string[];
      borderColor?: string;
    }>;
  };

  /** Table configuration — used when type is 'table' */
  table?: {
    title: string;
    columns: Array<{field: string; headerName: string; width?: number}>;
    rows: Array<Record<string, any>>;
  };
}

/**
 * The full AI analysis response returned to the frontend.
 */
export interface AiAnalysisResponse {
  /** Array of content blocks that the frontend renders in sequence */
  blocks: AiResponseBlock[];
}
