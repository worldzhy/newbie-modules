import {
  PinpointSMSVoiceV2Client,
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
      configurationSetName: process.env.AWS_SMS_CONFIGURATION_SET_NAME!,
    }
  ) {
    this.configurationSetName = config.configurationSetName;
    this.client = new PinpointSMSVoiceV2Client({region: config.region});
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
