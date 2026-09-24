import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {
  PinpointSMSVoiceV2Client,
  PinpointSMSVoiceV2ClientConfig,
  SendTextMessageCommand,
  SendTextMessageCommandInput,
  SendTextMessageCommandOutput,
} from '@aws-sdk/client-pinpoint-sms-voice-v2';
import {SendTextMessageParams} from './aws-sms.interface';

@Injectable()
export class AwsSmsService {
  private client: PinpointSMSVoiceV2Client;
  private configurationSetName: string;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.getOrThrow<{
      accessKeyId?: string;
      secretAccessKey?: string;
      region: string;
      configurationSetName: string;
    }>('microservices.aws-sms');

    this.configurationSetName = config.configurationSetName;

    // Create SES Client
    const clientConfig: PinpointSMSVoiceV2ClientConfig = {
      region: config.region,
    };
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new PinpointSMSVoiceV2Client(clientConfig);
  }

  async sendText(params: SendTextMessageParams): Promise<SendTextMessageCommandOutput> {
    const commandInput: SendTextMessageCommandInput = {
      DestinationPhoneNumber: params.phoneNumber,
      MessageType: 'TRANSACTIONAL',
      MessageBody: params.text,
      ConfigurationSetName: this.configurationSetName,
    };

    return await this.client.send(new SendTextMessageCommand(commandInput));
  }
}
