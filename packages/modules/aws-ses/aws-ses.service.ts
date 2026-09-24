import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {
  GetSendStatisticsCommand,
  SESClient,
  SESClientConfig,
  SendDataPoint,
  SendEmailCommand,
  SendEmailCommandInput,
  SendEmailCommandOutput,
} from '@aws-sdk/client-ses';
import {SendEmailParams, SendEmailsParams, SendEmailWithTemplateParams} from './aws-ses.interface';
import {promises as fs} from 'fs';
import {join} from 'path';
import {marked} from 'marked';
import {render} from 'mustache';

@Injectable()
export class AwsSesService {
  private client: SESClient;
  private configurationSetName: string;
  private fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.getOrThrow<{
      accessKeyId?: string;
      secretAccessKey?: string;
      region: string;
      configurationSetName: string;
      fromEmailAddress: string;
    }>('microservices.aws-ses');

    this.configurationSetName = config.configurationSetName;
    this.fromAddress = config.fromEmailAddress;

    // Create SES Client
    const clientConfig: SESClientConfig = {region: config.region};
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new SESClient(clientConfig);
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailCommandOutput> {
    return await this.send(params);
  }

  async sendEmails(params: SendEmailsParams): Promise<SendEmailCommandOutput> {
    return await this.send(params);
  }

  async sendEmailWithTemplate(params: SendEmailWithTemplateParams): Promise<SendEmailCommandOutput> {
    const emailParams: SendEmailParams = {
      toAddress: params.toAddress,
      subject: '',
      html: '',
      text: '',
    };

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
    emailParams.text = contentMarkdown;

    // [step 3] Parse markdown to HTML
    const layoutHtml = await this.readTemplate('layout.html');
    const contentHtml = marked.parse(contentMarkdown);
    emailParams.html = render(layoutHtml, {content: contentHtml});

    return await this.send(emailParams);
  }

  async getSendStatistics(): Promise<SendDataPoint[] | undefined> {
    // Provides sending statistics for the current Amazon Web Services Region.
    // The result is a list of data points, representing the last two weeks of sending activity.
    // Each data point in the list contains statistics for a 15-minute period of time.
    const response = await this.client.send(new GetSendStatisticsCommand({}));
    return response.SendDataPoints;
  }

  private async send(params: SendEmailParams | SendEmailsParams): Promise<SendEmailCommandOutput> {
    const toAddresses = 'toAddresses' in params ? params.toAddresses : [params.toAddress];

    const commandInput: SendEmailCommandInput = {
      Source: this.fromAddress,
      Destination: {
        ToAddresses: toAddresses,
      },
      Message: {
        Subject: {
          Charset: 'UTF-8',
          Data: params.subject,
        },
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: params.html,
          },
          Text: {
            Charset: 'UTF-8',
            Data: params.text,
          },
        },
      },
      ConfigurationSetName: this.configurationSetName,
    };

    return await this.client.send(new SendEmailCommand(commandInput));
  }

  private async readTemplate(name: string): Promise<string> {
    if (!name.endsWith('.html')) name = `${name}.md`;
    return await fs.readFile(join(__dirname, 'templates', name), 'utf8');
  }
}
