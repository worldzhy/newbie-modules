import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SendMessagesCommandOutput} from '@aws-sdk/client-pinpoint';
import {EmailNotification} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {AwsPinpointService} from './aws.pinpoint.service';
import {promises as fs} from 'fs';
import {join} from 'path';
import {render} from 'mustache';
import {marked} from 'marked';
import {EmailParams, EmailParamsWithTemplate} from './email.interface';

@Injectable()
export class EmailService {
  private emailPinpointApplicationId: string;
  private emailPinpointFromAddress: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly pinpointService: AwsPinpointService
  ) {
    this.emailPinpointApplicationId = this.configService.getOrThrow<string>(
      'microservices.notification.email.awsPinpointApplicationId'
    )!;
    this.emailPinpointFromAddress = this.configService.getOrThrow<string>(
      'microservices.notification.email.awsPinpointFromAddress'
    )!;
  }

  async send(params: EmailParams): Promise<void> {
    await this.sendEmail(params);
  }

  async sendWithTemplate(params: EmailParamsWithTemplate): Promise<void> {
    const emailParams: EmailParams = {toAddress: params.toAddress};

    // [step 1] Get template
    const templatePath = Object.keys(params.template)[0];
    let templateMarkdown = await this.readTemplate(templatePath);

    // [step 2] Replace information in template
    let contentMarkdown = render(templateMarkdown, params.template[templatePath] || {});
    if (contentMarkdown.startsWith('#')) {
      const subject = contentMarkdown.split('\n', 1)[0].replace('#', '').trim();
      if (subject) {
        emailParams.subject = subject;
        contentMarkdown = contentMarkdown.replace(`# ${contentMarkdown.split('\n', 1)[0]}`, '');
      }
    }
    emailParams.plainText = contentMarkdown;

    // [step 3] Parse markdown to HTML
    const layoutHtml = await this.readTemplate('layout.html');
    const contentHtml = marked.parse(contentMarkdown);
    emailParams.html = render(layoutHtml, {content: contentHtml});

    await this.sendEmail(emailParams);
  }

  private async sendEmail(params: EmailParams): Promise<EmailNotification> {
    // [step 1] Send AWS Pinpoint message.
    const output: SendMessagesCommandOutput = await this.pinpointService.sendEmail({
      applicationId: this.emailPinpointApplicationId,
      fromAddress: this.emailPinpointFromAddress,
      body: params,
    });

    // [step 2] Save notification record.
    let pinpointRequestId: string | undefined;
    let pinpointMessageId: string | undefined;
    if (output.MessageResponse) {
      pinpointRequestId = output.MessageResponse.RequestId;
      if (output.MessageResponse?.Result) {
        pinpointMessageId = output.MessageResponse?.Result[params.toAddress].MessageId;
      }
    }

    return await this.prisma.emailNotification.create({
      data: {
        payload: params as object,
        pinpointRequestId: pinpointRequestId,
        pinpointMessageId: pinpointMessageId,
        pinpointResponse: output as object,
      },
    });
  }

  private async readTemplate(name: string) {
    if (!name.endsWith('.html')) name = `${name}.md`;
    return await fs.readFile(join(__dirname, 'templates', name), 'utf8');
  }
}
