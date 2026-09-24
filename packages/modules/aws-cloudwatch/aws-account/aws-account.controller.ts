import {Body, Controller, Get, Param, Patch, Post} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {
  AwsAccountResponseDto,
  CreateAWSAccountDto,
  UpdateAWSAccountDto,
} from '@microservices/aws-cloudwatch/aws-account/aws-account.dto';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {encryptString} from '@devbie/newbie/utilities/crypto.util';
import {ConfigService} from '@nestjs/config';
import {AwsRegion} from '@generated/prisma/enums';

@ApiTags('AWS CloudWatch / Account')
@ApiBearerAuth()
@Controller('awsAccounts')
export class AWSAccountController {
  private readonly encryptKey: string;
  private readonly encryptIV: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService
  ) {
    this.encryptKey = this.configService.get('microservices.cloudwatch.cryptoEncryptKey') as string;
    this.encryptIV = this.configService.get('microservices.cloudwatch.cryptoEncryptIV') as string;
  }

  @Get(':id')
  @ApiOperation({summary: 'Get an AWS account by id'})
  @ApiResponse({type: AwsAccountResponseDto})
  async getAWSAccount(@Param('id') id: string) {
    const awsAccount = await this.prisma.awsAccount.findUniqueOrThrow({
      where: {id},
    });
    // Strip the encrypted secret access key from the response.
    const {secretAccessKey, ...rest} = awsAccount;
    return rest;
  }

  @Post()
  @ApiOperation({summary: 'Create an AWS account'})
  @ApiResponse({type: AwsAccountResponseDto})
  async createAWSAccount(@Body() body: CreateAWSAccountDto) {
    const {secretAccessKey, regions, ...rest} = body;

    const newAWSAccount = await this.prisma.awsAccount.create({
      data: {
        ...rest,
        regions: regions as AwsRegion[],
        secretAccessKey: encryptString(secretAccessKey, this.encryptKey, this.encryptIV),
      },
    });

    // Strip the encrypted secret access key from the response.
    const {secretAccessKey: _secret, ...result} = newAWSAccount;
    return result;
  }

  @Patch(':id')
  @ApiOperation({summary: 'Update an AWS account'})
  @ApiResponse({type: AwsAccountResponseDto})
  async updateAWSAccount(@Param('id') id: string, @Body() body: UpdateAWSAccountDto) {
    const {secretAccessKey, regions, ...rest} = body;

    const updatedAWSAccount = await this.prisma.awsAccount.update({
      where: {id},
      data: {
        ...rest,
        regions: regions as AwsRegion[] | undefined,
        secretAccessKey: secretAccessKey ? encryptString(secretAccessKey, this.encryptKey, this.encryptIV) : undefined,
      },
    });

    // Strip the encrypted secret access key from the response.
    const {secretAccessKey: _secret, ...result} = updatedAWSAccount;
    return result;
  }
}
