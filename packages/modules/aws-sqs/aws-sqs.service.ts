import {Injectable} from '@nestjs/common';
import {
  SQSClient,
  SQSClientConfig,
  SendMessageCommand,
  GetQueueAttributesCommand,
  QueueAttributeName,
} from '@aws-sdk/client-sqs';
import {ConfigService} from '@nestjs/config';

@Injectable()
export class AwsSqsService {
  private client: SQSClient;
  private queueUrl: string;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.getOrThrow<{
      accessKeyId?: string;
      secretAccessKey?: string;
      region: string;
      queueUrl: string;
    }>('modules.aws-sqs');

    this.queueUrl = config.queueUrl;

    // Static credentials are optional; when absent the SDK default
    // credential chain applies (SSO locally, instance profile on EC2).
    const clientConfig: SQSClientConfig = {region: config.region};
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }
    this.client = new SQSClient(clientConfig);
  }

  /**
   * See the API doc for more details:
   * https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessage.html
   * @param {object} params
   * @returns {(Promise<{data: SQS.SendMessageResult | void;err: AWSError | void;}>)}
   * @memberof SqsService
   */
  async sendMessage(params: {
    queueUrl?: string;
    body: object;
    MessageGroupId?: string;
    MessageDeduplicationId?: string;
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sendMessageRequest: any = {
      QueueUrl: params.queueUrl ?? this.queueUrl,
      MessageBody: JSON.stringify(params.body),
    };

    const {MessageGroupId, MessageDeduplicationId} = params;
    if (MessageGroupId) {
      sendMessageRequest.MessageGroupId = MessageGroupId;
    }

    if (MessageDeduplicationId) {
      sendMessageRequest.MessageDeduplicationId = MessageDeduplicationId;
    }

    return await this.client.send(new SendMessageCommand(sendMessageRequest));
  }

  async getQueueAttributes(params: {
    queueUrl?: string;
    attributeNames: QueueAttributeName[];
  }) {
    const getQueueAttributesRequest = {
      QueueUrl: params.queueUrl ?? this.queueUrl,
      AttributeNames: params.attributeNames,
    };

    const result = await this.client.send(
      new GetQueueAttributesCommand(getQueueAttributesRequest)
    );

    return result.Attributes;
  }
}
