import {Body, Controller, Get, Post, Query} from '@nestjs/common';
import {ApiBody, ApiTags} from '@nestjs/swagger';
import {MessageTrackerService} from './message-tracker.service';
import {
  SendEmailMessageParams,
  SendTextMessageParams,
} from './message-tracker.interface';

@ApiTags('Message Tracker')
@Controller('message-tracker')
export class MessageTrackerController {
  constructor(private readonly messageTrackerService: MessageTrackerService) {}

  @Post('messages/email')
  @ApiBody({
    description: '',
    examples: {
      a: {
        value: {
          toAddress: 'worldzhy@126.com',
          subject: 'Hello World',
          text: 'Hello World',
          html: '<h1>Hello World</h1>',
        },
      },
    },
  })
  async sendEmailMessage(@Body() body: SendEmailMessageParams) {
    return await this.messageTrackerService.sendEmail(body);
  }

  @Post('messages/text')
  @ApiBody({
    description: '',
    examples: {
      a: {value: {phoneNumber: '+14254147755', text: 'Hello World'}},
    },
  })
  async sendTextMessage(@Body() body: SendTextMessageParams) {
    return await this.messageTrackerService.sendText(body);
  }

  @Get('status/email')
  async getEventsOfEmailMessage(@Query('sesMessageId') sesMessageId: string) {
    return await this.messageTrackerService.getStatusOfEmailMessage(
      sesMessageId
    );
  }

  @Post('status/emails')
  @ApiBody({
    description: '',
    examples: {
      a: {value: {sesMessageIds: ['id1', 'id2']}},
    },
  })
  async getEventsOfEmailMessages(@Body() body: {sesMessageIds: string[]}) {
    return await this.messageTrackerService.getStatusOfEmailMessages(
      body.sesMessageIds
    );
  }

  @Get('status/text')
  async getEventsOfTextMessage(@Query('smsMessageId') smsMessageId: string) {
    return await this.messageTrackerService.getStatusOfTextMessage(
      smsMessageId
    );
  }

  @Post('status/texts')
  @ApiBody({
    description: '',
    examples: {
      a: {value: {smsMessageIds: ['id1', 'id2']}},
    },
  })
  async getEventsOfTextMessages(@Body() body: {smsMessageIds: string[]}) {
    return await this.messageTrackerService.getStatusOfTextMessages(
      body.smsMessageIds
    );
  }

  /* End */
}
