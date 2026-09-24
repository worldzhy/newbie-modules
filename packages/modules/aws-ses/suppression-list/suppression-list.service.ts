import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {
  SESv2Client,
  SESv2ClientConfig,
  ListSuppressedDestinationsCommand,
  ListSuppressedDestinationsCommandInput,
  DeleteSuppressedDestinationCommand,
  GetSuppressedDestinationCommand,
  PutSuppressedDestinationCommand,
  SuppressionListReason,
} from '@aws-sdk/client-sesv2';

@Injectable()
export class AwsSesSuppressionListService {
  private client: SESv2Client;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.getOrThrow<{
      accessKeyId?: string;
      secretAccessKey?: string;
      region: string;
      configurationSetName: string;
      fromEmailAddress: string;
    }>('microservices.aws-ses');

    // Create SES Client
    const clientConfig: SESv2ClientConfig = {};
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new SESv2Client(clientConfig);
  }

  async listSuppressedDestinations(params: {reasons?: SuppressionListReason[]; nextToken?: string; pageSize?: number}) {
    const input: ListSuppressedDestinationsCommandInput = {
      Reasons: params.reasons,
      NextToken: params.nextToken,
      PageSize: params.pageSize,
      // StartDate: new Date('TIMESTAMP'),
      // EndDate: new Date('TIMESTAMP'),
    };
    const command = new ListSuppressedDestinationsCommand(input);
    const response = await this.client.send(command);

    return {
      suppressedDestinations: response.SuppressedDestinationSummaries,
      nextToken: response.NextToken,
    };
  }

  async getSuppressedDestination(emailAddress: string) {
    const command = new GetSuppressedDestinationCommand({
      EmailAddress: emailAddress,
    });
    const response = await this.client.send(command);
    return response;
  }

  async addSuppressedDestination(params: {emailAddress: string; reason: SuppressionListReason}) {
    const command = new PutSuppressedDestinationCommand({
      EmailAddress: params.emailAddress,
      Reason: params.reason,
    });
    const response = await this.client.send(command);
    return response;
  }

  async deleteSuppressedDestination(emailAddress: string) {
    const command = new DeleteSuppressedDestinationCommand({
      EmailAddress: emailAddress,
    });
    const response = await this.client.send(command);
    return response;
  }
}
