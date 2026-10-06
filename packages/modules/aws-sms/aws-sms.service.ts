import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
  SendTextMessageCommandInput,
  SendTextMessageCommandOutput,
} from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { SendTextMessageParams } from "./aws-sms.interface";
import { AwsCredentialsService } from "@modules/aws-identity/aws-credentials.service";

@Injectable()
export class AwsSmsService {
  private client: PinpointSMSVoiceV2Client;
  private configurationSetName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly credentials: AwsCredentialsService,
  ) {
    const config = this.configService.getOrThrow<{
      region: string;
      configurationSetName: string;
    }>("modules.aws-sms");

    this.configurationSetName = config.configurationSetName;
    this.client = new PinpointSMSVoiceV2Client({
      region: config.region,
      credentials: this.credentials.resolveDefaultCredentials(),
    });
  }

  async sendText(params: SendTextMessageParams): Promise<SendTextMessageCommandOutput> {
    const commandInput: SendTextMessageCommandInput = {
      DestinationPhoneNumber: params.phoneNumber,
      MessageType: "TRANSACTIONAL",
      MessageBody: params.text,
      ConfigurationSetName: this.configurationSetName,
    };

    return await this.client.send(new SendTextMessageCommand(commandInput));
  }
}
