import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsOptional, IsEnum, IsObject } from "class-validator";
import { EmailTemplate } from "./aws-ses.interface";

export class SendEmailRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  toAddress!: string;

  @ApiProperty({ type: String })
  @IsString()
  subject!: string;

  @ApiProperty({ type: String })
  @IsString()
  html!: string;

  @ApiProperty({ type: String })
  @IsString()
  text!: string;
}

export class SendEmailWithTemplateRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  toAddress!: string;

  @ApiProperty({ enum: EmailTemplate, enumName: "EmailTemplate" })
  @IsEnum(EmailTemplate)
  templateName!: EmailTemplate;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  templateParams?: Record<string, unknown>;
}
