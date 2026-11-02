import { BadRequestException, Injectable } from "@nestjs/common";
import { AwsResourceStack } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AwsCloudformationStackService, StackCommandResult, StackWithEnvironment } from "./stack/stack.service";
import { AppHostStack } from "./stack/app-host.stack";
import { StackSnapshot } from "./stack/stack.helper";

/**
 * Facade over the stack primitives. Resolves the stored stack record and
 * delegates to AwsCloudformationStackService; it adds no business semantics.
 */
@Injectable()
export class AwsCloudformationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudformationStackService: AwsCloudformationStackService,
  ) {}

  listStackTypes(): string[] {
    return [AppHostStack.type];
  }

  getStackParams(type: string): Record<string, string> {
    if (type !== AppHostStack.type) {
      throw new BadRequestException(`Unsupported stack type: ${type}`);
    }
    return AppHostStack.getStackParams();
  }

  async getOrCreateStack(stackId: string): Promise<StackSnapshot> {
    return await this.cloudformationStackService.getOrCreateStack(await this.getStackOrThrow(stackId));
  }

  async describeStack(stackId: string): Promise<StackSnapshot | null> {
    return await this.cloudformationStackService.describeStack(await this.getStackOrThrow(stackId));
  }

  async deleteStack(stackId: string): Promise<StackSnapshot> {
    return await this.cloudformationStackService.deleteStack(await this.getStackOrThrow(stackId));
  }

  async sendCommand(stackId: string, commands: string[]): Promise<StackCommandResult> {
    return await this.cloudformationStackService.sendCommand(await this.getStackOrThrow(stackId), commands);
  }

  private async getStackOrThrow(stackId: string): Promise<StackWithEnvironment> {
    const stack: AwsResourceStack & { environment?: StackWithEnvironment["environment"] } =
      await this.prisma.awsResourceStack.findUniqueOrThrow({
        where: { id: stackId },
        include: { environment: true },
      });
    return stack as StackWithEnvironment;
  }
}
