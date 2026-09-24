import {
  SESClient,
  SESClientConfig,
  SendEmailCommand,
  SendEmailCommandInput,
  SendEmailCommandOutput,
} from '@aws-sdk/client-ses';
import {promises as fs} from 'fs';
import {join} from 'path';
import {marked} from 'marked';
import mustache from 'mustache';
import {
  EmailServiceConfig,
  SendEmailParams,
  SendEmailWithTemplateParams,
  SendEmailsParams,
} from './interface';

export {EmailServiceConfig, SendEmailParams, SendEmailWithTemplateParams};

export class EmailService {
  private client: SESClient;
  private fromAddress: string;
  private configurationSetName: string | undefined;

  constructor(
    config: EmailServiceConfig = {
      region: process.env.AWS_SES_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
      configurationSetName: process.env.AWS_SES_CONFIGURATION_SET_NAME,
      fromAddress: process.env.FROM_EMAIL_ADDRESS!,
    }
  ) {
    // Validate configuration
    this.configurationSetName = config.configurationSetName;
    this.fromAddress = config.fromAddress;
    if (!this.fromAddress) {
      throw new Error(
        `FROM_EMAIL_ADDRESS environment variable is not set. ${config.region} 11 ${config.fromAddress}`
      );
    }

    // Create SES Client
    const clientConfig: SESClientConfig = {
      region: config.region,
    };
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

  async sendEmailWithTemplate(
    params: SendEmailWithTemplateParams
  ): Promise<SendEmailCommandOutput> {
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
    let contentMarkdown = mustache.render(
      templateMarkdown,
      params.template[templatePath] || {}
    );
    if (contentMarkdown.startsWith('#')) {
      const subject = contentMarkdown.split('\n', 1)[0].replace('#', '').trim();
      if (subject) {
        emailParams.subject = subject;
        contentMarkdown = contentMarkdown.replace(
          `# ${contentMarkdown.split('\n', 1)[0]}`,
          ''
        );
      }
    }
    emailParams.text = contentMarkdown;

    // [step 3] Parse markdown to HTML
    const layoutHtml = await this.readTemplate('layout.html');
    const contentHtml = marked.parse(contentMarkdown);
    emailParams.html = mustache.render(layoutHtml, {content: contentHtml});

    return await this.send(emailParams);
  }

  private async send(
    params: SendEmailParams | SendEmailsParams
  ): Promise<SendEmailCommandOutput> {
    const toAddresses =
      'toAddresses' in params ? params.toAddresses : [params.toAddress];

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
