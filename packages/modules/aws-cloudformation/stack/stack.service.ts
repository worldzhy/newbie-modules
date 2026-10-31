import { Injectable, Logger, BadGatewayException, BadRequestException, RequestTimeoutException } from "@nestjs/common";
import {
  Capability,
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  type Parameter,
} from "@aws-sdk/client-cloudformation";
import {
  GetCommandInvocationCommand,
  SendCommandCommand,
  SSMClient,
  type GetCommandInvocationCommandOutput,
} from "@aws-sdk/client-ssm";
import { AwsEnvironment, AwsResourceStack, AwsResourceStackState, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { assumeRole, type AwsTemporaryCredentials } from "@modules/aws-identity/aws-sts.helper";
import { AppHostStack } from "./app-host.stack";
import {
  isCreateFailed,
  isCreateSucceeded,
  isDeleteFailed,
  isDeleteSucceeded,
  pollUntil,
  PollRejectedError,
  PollTimeoutError,
  selectOutput,
  StackSnapshot,
  toStackSnapshot,
} from "./stack.helper";

const STACK_POLL_INTERVAL_MS = 10_000;
const STACK_POLL_TIMEOUT_MS = 30 * 60 * 1000;
const COMMAND_POLL_INTERVAL_MS = 2_000;
const COMMAND_POLL_TIMEOUT_MS = 10 * 60 * 1000;
/** Statuses after which GetCommandInvocation will not change again. */
const COMMAND_TERMINAL_STATUSES = new Set(["Success", "Failed", "Cancelled", "TimedOut"]);

export interface StackCommandResult {
  commandId: string;
  status: string;
  exitCode: number | null;
  output: string | null;
}

interface CommandInvocation {
  status: string;
  exitCode: number | null;
  output: string | null;
}

export type StackWithEnvironment = AwsResourceStack & { environment: AwsEnvironment };

/**
 * AWS primitives over a stack record. Every call re-resolves temporary
 * credentials via STS AssumeRole; nothing long-lived is stored.
 *
 * The primitives are idempotent and report AWS facts only. They never judge
 * whether an application deployment succeeded.
 */
@Injectable()
export class AwsCloudformationStackService {
  private readonly logger = new Logger(AwsCloudformationStackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Create the stack when absent, then wait for a terminal CREATE status. */
  async getOrCreateStack(stack: StackWithEnvironment): Promise<StackSnapshot> {
    const client = await this.createCloudFormationClient(stack.environment);
    const existing = await this.readStack(client, stack.name!);

    if (existing && isCreateSucceeded(existing.status)) {
      return await this.persistSnapshot(stack, existing, AwsResourceStackState.CREATE_COMPLETE);
    }
    if (existing && isCreateFailed(existing.status)) {
      await this.persistSnapshot(stack, existing, AwsResourceStackState.CREATE_FAILED);
      throw new BadRequestException(
        `Stack ${stack.name} is in ${existing.status}${existing.reason ? `: ${existing.reason}` : ""}.`,
      );
    }

    if (!existing) {
      await this.updateRecord(stack, { state: AwsResourceStackState.CREATE_IN_PROGRESS });
      const output = await client.send(
        new CreateStackCommand({
          StackName: stack.name!,
          TemplateBody: AppHostStack.getStackTemplateBody(),
          Capabilities: [Capability.CAPABILITY_IAM],
          Parameters: this.buildParameters(stack.params),
        }),
      );
      await this.updateRecord(stack, { createStackOutput: this.toJson(output) });
    }

    return await this.waitForCreatedStack(client, stack);
  }

  /** Read the current AWS stack state; null when the stack does not exist. */
  async describeStack(stack: StackWithEnvironment): Promise<StackSnapshot | null> {
    const client = await this.createCloudFormationClient(stack.environment);
    const snapshot = await this.readStack(client, stack.name!);
    return snapshot ? await this.persistSnapshot(stack, snapshot) : null;
  }

  /** Delete the stack and wait for DELETE_COMPLETE; a missing stack counts as deleted. */
  async deleteStack(stack: StackWithEnvironment): Promise<StackSnapshot> {
    const client = await this.createCloudFormationClient(stack.environment);
    const existing = await this.readStack(client, stack.name!);
    const deletedSnapshot: StackSnapshot = existing ?? {
      name: stack.name!,
      status: "DELETE_COMPLETE",
      outputs: {},
      reason: null,
    };

    if (!existing || isDeleteSucceeded(existing.status)) {
      return await this.persistSnapshot(stack, deletedSnapshot, AwsResourceStackState.DELETE_COMPLETE);
    }

    await this.updateRecord(stack, { state: AwsResourceStackState.DELETE_IN_PROGRESS });
    const output = await client.send(new DeleteStackCommand({ StackName: stack.name! }));
    await this.updateRecord(stack, { deleteStackOutput: this.toJson(output) });

    try {
      const snapshot = await pollUntil(async () => (await this.readStack(client, stack.name!)) ?? deletedSnapshot, {
        intervalMs: STACK_POLL_INTERVAL_MS,
        timeoutMs: STACK_POLL_TIMEOUT_MS,
        accept: (value) => isDeleteSucceeded(value.status),
        fail: (value) =>
          isDeleteFailed(value.status)
            ? `Stack ${stack.name} failed to delete${value.reason ? `: ${value.reason}` : ""}.`
            : null,
        describe: (value) => `stack ${value.name} to leave ${value.status}`,
      });
      return await this.persistSnapshot(stack, snapshot, AwsResourceStackState.DELETE_COMPLETE);
    } catch (error) {
      throw this.mapPollError(error);
    }
  }

  /** Run shell commands on the host instance through SSM and wait for the outcome. */
  async sendCommand(stack: StackWithEnvironment, commands: string[]): Promise<StackCommandResult> {
    const instanceId = await this.resolveInstanceId(stack);
    const client = await this.createSsmClient(stack.environment);
    const output = await client.send(
      new SendCommandCommand({
        DocumentName: "AWS-RunShellScript",
        InstanceIds: [instanceId],
        Comment: `aws-cloudformation:${stack.name}`,
        Parameters: { commands },
      }),
    );
    const commandId = output.Command?.CommandId;
    if (!commandId) {
      throw new BadGatewayException("AWS SSM SendCommand returned no command id.");
    }

    try {
      const invocation = await pollUntil(() => this.readInvocation(client, commandId, instanceId), {
        intervalMs: COMMAND_POLL_INTERVAL_MS,
        timeoutMs: COMMAND_POLL_TIMEOUT_MS,
        accept: (value) => value.status === "Success",
        fail: (value) =>
          COMMAND_TERMINAL_STATUSES.has(value.status)
            ? `SSM command ${commandId} ended with ${value.status} (exit ${value.exitCode ?? "unknown"}).`
            : null,
        describe: (value) => `SSM command ${commandId} to finish (${value.status})`,
      });
      return { commandId, ...invocation };
    } catch (error) {
      throw this.mapPollError(error);
    }
  }

  //* Helpers

  private async waitForCreatedStack(client: CloudFormationClient, stack: StackWithEnvironment): Promise<StackSnapshot> {
    try {
      const snapshot = await pollUntil(
        async () =>
          (await this.readStack(client, stack.name!)) ?? {
            name: stack.name!,
            status: "UNKNOWN",
            outputs: {},
            reason: null,
          },
        {
          intervalMs: STACK_POLL_INTERVAL_MS,
          timeoutMs: STACK_POLL_TIMEOUT_MS,
          accept: (value) => isCreateSucceeded(value.status),
          fail: (value) =>
            isCreateFailed(value.status)
              ? `Stack ${stack.name} entered ${value.status}${value.reason ? `: ${value.reason}` : ""}.`
              : null,
          describe: (value) => `stack ${value.name} to leave ${value.status}`,
        },
      );
      return await this.persistSnapshot(stack, snapshot, AwsResourceStackState.CREATE_COMPLETE);
    } catch (error) {
      throw this.mapPollError(error);
    }
  }

  private async readStack(client: CloudFormationClient, stackName: string): Promise<StackSnapshot | null> {
    try {
      const output = await client.send(new DescribeStacksCommand({ StackName: stackName }));
      const description = output.Stacks?.[0];
      return description ? toStackSnapshot(description) : null;
    } catch (error) {
      if ((error as { name?: string })?.name === "ValidationError") {
        // DescribeStacks reports a missing stack as a ValidationError.
        return null;
      }
      throw error;
    }
  }

  private async resolveInstanceId(stack: StackWithEnvironment): Promise<string> {
    const client = await this.createCloudFormationClient(stack.environment);
    const snapshot = await this.readStack(client, stack.name!);
    if (!snapshot) {
      throw new BadRequestException(`Stack ${stack.name} does not exist.`);
    }
    const instanceId = selectOutput(snapshot.outputs, "InstanceId");
    if (!instanceId) {
      throw new BadRequestException(`Stack ${stack.name} has no InstanceId output; it is not ready.`);
    }
    return instanceId;
  }

  private async readInvocation(client: SSMClient, commandId: string, instanceId: string): Promise<CommandInvocation> {
    try {
      const output: GetCommandInvocationCommandOutput = await client.send(
        new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: instanceId }),
      );
      return {
        status: output.Status ?? "Pending",
        exitCode: output.ResponseCode ?? null,
        output: output.StandardOutputContent ?? output.StandardErrorContent ?? null,
      };
    } catch (error) {
      if ((error as { name?: string })?.name === "InvocationDoesNotExist") {
        return { status: "Pending", exitCode: null, output: null };
      }
      throw error;
    }
  }

  private buildParameters(params: Prisma.JsonValue | null): Parameter[] {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      return [];
    }
    return Object.entries(params).map(([ParameterKey, value]) => ({
      ParameterKey,
      ParameterValue: value === null ? "" : String(value),
    }));
  }

  private async createCloudFormationClient(environment: AwsEnvironment): Promise<CloudFormationClient> {
    const { region, credentials } = await this.resolveClientConfig(environment);
    return new CloudFormationClient({ region, credentials });
  }

  private async createSsmClient(environment: AwsEnvironment): Promise<SSMClient> {
    const { region, credentials } = await this.resolveClientConfig(environment);
    return new SSMClient({ region, credentials });
  }

  /**
   * Exchange the host identity for temporary credentials in the customer
   * account. The role trust policy plus the optional external id are the only
   * authorisation; no access key is read from the database.
   */
  private async resolveClientConfig(
    environment: AwsEnvironment,
  ): Promise<{ region: string; credentials: AwsTemporaryCredentials }> {
    try {
      const { credentials } = await assumeRole({
        roleArn: environment.roleArn,
        externalId: environment.externalId ?? undefined,
        region: environment.awsRegion,
        sessionName: `aws-cloudformation-${environment.id}`,
      });
      return { region: environment.awsRegion, credentials };
    } catch (error) {
      this.logger.error(
        `STS AssumeRole failed for AWS environment ${environment.id}: ${(error as Error)?.name ?? "UnknownError"}`,
      );
      throw new BadGatewayException("STS AssumeRole failed for this AWS environment.");
    }
  }

  private async persistSnapshot(
    stack: StackWithEnvironment,
    snapshot: StackSnapshot,
    state?: AwsResourceStackState,
  ): Promise<StackSnapshot> {
    await this.updateRecord(stack, {
      state: state ?? this.toStackState(snapshot.status) ?? undefined,
      describeStackOutput: this.toJson(snapshot),
    });
    return snapshot;
  }

  private async updateRecord(stack: StackWithEnvironment, data: Prisma.AwsResourceStackUpdateInput): Promise<void> {
    await this.prisma.awsResourceStack.update({ where: { id: stack.id }, data });
  }

  private toStackState(status: string): AwsResourceStackState | null {
    switch (status) {
      case "CREATE_IN_PROGRESS":
      case "ROLLBACK_IN_PROGRESS":
        return AwsResourceStackState.CREATE_IN_PROGRESS;
      case "CREATE_COMPLETE":
        return AwsResourceStackState.CREATE_COMPLETE;
      case "CREATE_FAILED":
      case "ROLLBACK_COMPLETE":
      case "ROLLBACK_FAILED":
        return AwsResourceStackState.CREATE_FAILED;
      case "DELETE_IN_PROGRESS":
        return AwsResourceStackState.DELETE_IN_PROGRESS;
      case "DELETE_COMPLETE":
        return AwsResourceStackState.DELETE_COMPLETE;
      case "DELETE_FAILED":
        return AwsResourceStackState.DELETE_FAILED;
      default:
        return null;
    }
  }

  private toJson(value: object): Prisma.InputJsonObject {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
  }

  private mapPollError(error: unknown): never {
    if (error instanceof PollTimeoutError) {
      throw new RequestTimeoutException(error.message);
    }
    if (error instanceof PollRejectedError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
