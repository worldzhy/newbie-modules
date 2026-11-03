import { Injectable } from "@nestjs/common";
import { SQSClient, SendMessageCommand, GetQueueAttributesCommand, QueueAttributeName } from "@aws-sdk/client-sqs";
import { ConfigService } from "@nestjs/config";
import { AwsCredentialsService } from "@modules/aws-identity/aws-credentials.service";

@Injectable()
export class AwsSqsService {
  private client: SQSClient;
  private queueUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly credentials: AwsCredentialsService,
  ) {
    const config = this.configService.getOrThrow<{
      region: string;
      queueUrl: string;
    }>("modules.aws-sqs");

    this.queueUrl = config.queueUrl;
    this.client = new SQSClient({
      region: config.region,
      credentials: this.credentials.resolveDefaultCredentials(),
    });
  }

  /**
   * See the API doc for more details:
   * https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessage.html
   *
   * The queue URL is read from config only — callers cannot override it, so
   * there is no injection surface for arbitrary AWS SQS endpoints.
   * @param {object} params
   * @returns {(Promise<{data: SQS.SendMessageResult | void;err: AWSError | void;}>)}
   * @memberof SqsService
   */
  async sendMessage(params: { body: object; MessageGroupId?: string; MessageDeduplicationId?: string }) {
    const sendMessageRequest: any = {
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(params.body),
    };

    const { MessageGroupId, MessageDeduplicationId } = params;
    if (MessageGroupId) {
      sendMessageRequest.MessageGroupId = MessageGroupId;
    }

    if (MessageDeduplicationId) {
      sendMessageRequest.MessageDeduplicationId = MessageDeduplicationId;
    }

    return await this.client.send(new SendMessageCommand(sendMessageRequest));
  }

  async getQueueAttributes(params: { attributeNames: QueueAttributeName[] }) {
    const getQueueAttributesRequest = {
      QueueUrl: this.queueUrl,
      AttributeNames: params.attributeNames,
    };

    const result = await this.client.send(new GetQueueAttributesCommand(getQueueAttributesRequest));

    return result.Attributes;
  }
}
