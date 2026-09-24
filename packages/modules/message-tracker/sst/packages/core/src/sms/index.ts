import {
  PinpointSMSVoiceV2Client,
  PinpointSMSVoiceV2ClientConfig,
  SendTextMessageCommand,
  SendTextMessageCommandInput,
  SendTextMessageCommandOutput,
} from '@aws-sdk/client-pinpoint-sms-voice-v2';
import {SendTextMessageParams, TextServiceConfig} from './interface';

export {SendTextMessageParams, TextServiceConfig};

export class TextMessageService {
  private client: PinpointSMSVoiceV2Client;
  private configurationSetName: string | undefined;

  constructor(
    config: TextServiceConfig = {
      region: process.env.AWS_SMS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_SMS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SMS_SECRET_ACCESS_KEY,
      configurationSetName: process.env.AWS_SMS_CONFIGURATION_SET_NAME!,
    }
  ) {
    this.configurationSetName = config.configurationSetName;

    // Create SMS Client
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

  async sendText(
    params: SendTextMessageParams
  ): Promise<SendTextMessageCommandOutput> {
    const commandInput: SendTextMessageCommandInput = {
      DestinationPhoneNumber: params.phoneNumber,
      MessageType: 'TRANSACTIONAL',
      MessageBody: params.text,
      ConfigurationSetName: this.configurationSetName,
    };

    return await this.client.send(new SendTextMessageCommand(commandInput));
  }
}
