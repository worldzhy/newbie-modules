import {Body, Controller, Get, Post} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {AwsSesService} from './aws-ses.service';
import {EmailTemplate} from './aws-ses.interface';
import {SendEmailRequestDto, SendEmailWithTemplateRequestDto} from './aws-ses.dto';

@ApiTags('AWS SES')
@Controller('aws-ses/emails')
export class AwsSesController {
  constructor(private readonly ses: AwsSesService) {}

  @Post('')
  @ApiOperation({summary: 'Send an email'})
  @ApiResponse({type: Object})
  async sendEmail(@Body() body: SendEmailRequestDto) {
    return await this.ses.sendEmail(body);
  }

  @Post('template')
  @ApiOperation({summary: 'Send an email with a template'})
  @ApiResponse({type: Object})
  async sendEmailWithTemplate(@Body() body: SendEmailWithTemplateRequestDto) {
    return await this.ses.sendEmailWithTemplate({
      toAddress: body.toAddress,
      template: {[body.templateName]: body.templateParams},
    });
  }

  @Get('templates')
  @ApiOperation({summary: 'List available email templates'})
  @ApiResponse({type: String, isArray: true})
  async listEmailTemplates() {
    return Object.values(EmailTemplate);
  }

  @Get('send-statistics')
  @ApiOperation({summary: 'Get SES send statistics'})
  @ApiResponse({type: Object})
  async getSendStatistics() {
    return await this.ses.getSendStatistics();
  }

  /* End */
}
