import {Body, Controller, Delete, Get, Param, Post, Put} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {AwsCredentialService} from './aws-credential.service';
import {
  ProjectAwsCredentialResponseDto,
  UpsertProjectAwsCredentialDto,
  VerifyAwsCredentialResponseDto,
} from './aws-credential.dto';

@ApiTags('AWS Credential')
@ApiBearerAuth()
@Controller('aws-credentials/projects')
export class AwsCredentialController {
  constructor(private readonly service: AwsCredentialService) {}

  @Get(':projectId')
  @ApiOperation({summary: 'Get the AWS credential configured for a project'})
  @ApiResponse({status: 200, type: ProjectAwsCredentialResponseDto})
  async getProjectCredential(@Param('projectId') projectId: string) {
    return await this.service.getProjectCredential(projectId);
  }

  @Put(':projectId')
  @ApiOperation({summary: 'Create or update the AWS credential for a project'})
  @ApiResponse({status: 200, type: ProjectAwsCredentialResponseDto})
  async upsertProjectCredential(@Param('projectId') projectId: string, @Body() body: UpsertProjectAwsCredentialDto) {
    return await this.service.upsertProjectCredential(projectId, body);
  }

  @Post(':projectId/verify')
  @ApiOperation({summary: 'Verify the stored AWS credential via STS GetCallerIdentity'})
  @ApiResponse({status: 200, type: VerifyAwsCredentialResponseDto})
  async verifyProjectCredential(@Param('projectId') projectId: string) {
    return await this.service.verifyProjectCredential(projectId);
  }

  @Delete(':projectId')
  @ApiOperation({summary: 'Delete the AWS credential for a project'})
  @ApiResponse({status: 200, type: ProjectAwsCredentialResponseDto})
  async deleteProjectCredential(@Param('projectId') projectId: string) {
    return await this.service.deleteProjectCredential(projectId);
  }
}
