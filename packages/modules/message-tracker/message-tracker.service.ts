import {Injectable} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {
  SendEmailMessageParams,
  SendTextMessageParams,
} from './message-tracker.interface';
import {MessageTrackerSqsService} from './message-tracker-sqs.service';

@Injectable()
export class MessageTrackerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sqs: MessageTrackerSqsService
  ) {}

  async sendEmail(params: SendEmailMessageParams) {
    await this.sqs.sendMessage({
      queueUrl: this.sqs.emailQueueUrl,
      body: params,
    });
  }

  async sendText(params: SendTextMessageParams) {
    await this.sqs.sendMessage({
      queueUrl: this.sqs.textQueueUrl,
      body: params,
    });
  }

  async getStatusOfEmailMessage(sesMessageId: string) {
    const event = await this.prisma.emailMessageEvent.findFirstOrThrow({
      where: {sesMessageId},
      orderBy: {eventTime: 'desc'},
      select: {eventType: true},
    });

    return event.eventType.split('.')[1].toUpperCase();
  }

  async getStatusOfEmailMessages(sesMessageIds: string[]) {
    // [step 1] Get events
    const events = await this.prisma.emailMessageEvent.findMany({
      where: {sesMessageId: {in: sesMessageIds}},
      orderBy: {eventTime: 'desc'},
      select: {eventType: true, sesMessageId: true},
    });

    // [step 2] Create a map messageId => status
    const messageIdAndStatusMap = new Map();
    events.forEach(event => {
      if (messageIdAndStatusMap.get(event.sesMessageId) === undefined) {
        messageIdAndStatusMap.set(
          event.sesMessageId,
          event.eventType.split('.')[1].toUpperCase()
        );
      }
    });

    return Object.fromEntries(messageIdAndStatusMap);
  }

  async getStatusOfTextMessage(smsMessageId: string) {
    const event = await this.prisma.textMessageEvent.findFirstOrThrow({
      where: {smsMessageId},
      orderBy: {eventTime: 'desc'},
      select: {eventType: true},
    });

    return event.eventType.split('_')[1].toUpperCase();
  }

  async getStatusOfTextMessages(smsMessageIds: string[]) {
    // [step 1] Get events
    const events = await this.prisma.textMessageEvent.findMany({
      where: {smsMessageId: {in: smsMessageIds}},
      orderBy: {eventTime: 'desc'},
      select: {eventType: true, smsMessageId: true},
    });

    // [step 2] Create a map messageId => status
    const messageIdAndStatusMap = new Map();
    events.forEach(event => {
      if (messageIdAndStatusMap.get(event.smsMessageId) === undefined) {
        messageIdAndStatusMap.set(
          event.smsMessageId,
          event.eventType.split('_')[1].toUpperCase()
        );
      }
    });

    return Object.fromEntries(messageIdAndStatusMap);
  }
}
