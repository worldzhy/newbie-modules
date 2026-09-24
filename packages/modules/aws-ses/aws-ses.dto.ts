import {ApiProperty} from '@nestjs/swagger';
import {IsNumber, IsString, IsOptional, IsEnum} from 'class-validator';
import {Type} from 'class-transformer';
import {EmailTemplate} from './aws-ses.interface';

export class SendEmailRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  toAddress: string;

  @ApiProperty({type: String, required: true})
  @IsString()
  subject: string;

  @ApiProperty({type: String, required: true})
  @IsString()
  html: string;

  @ApiProperty({type: String, required: true})
  @IsString()
  text: string;
}

export class SendEmailWithTemplateRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  toAddress: string;

  @ApiProperty({type: String, required: true, enum: EmailTemplate})
  @IsEnum(EmailTemplate)
  templateName: EmailTemplate;

  @ApiProperty({type: Object, required: false})
  @IsOptional()
  templateParams?: Record<string, any>;
}
