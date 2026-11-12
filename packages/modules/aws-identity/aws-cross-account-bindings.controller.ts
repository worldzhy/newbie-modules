import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { AwsCrossAccountBindingsService } from "./aws-cross-account-bindings.service";
import {
  AttachAwsCrossAccountBindingConsumerDto,
  AwsCrossAccountBindingConsumerResponseDto,
  AwsCrossAccountBindingListResponseDto,
  AwsCrossAccountBindingResponseDto,
  UpsertAwsCrossAccountBindingDto,
  VerifyAwsCrossAccountBindingResponseDto,
} from "./aws-cross-account-bindings.dto";

@ApiTags("AWS Cross-Account Binding")
@ApiBearerAuth()
@Controller("aws-cross-account-bindings")
export class AwsCrossAccountBindingsController {
  constructor(private readonly service: AwsCrossAccountBindingsService) {}

  @Get("accounts")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "List the customer AWS accounts the platform can access" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingListResponseDto })
  async listAccountCredentials() {
    return await this.service.listAccountCredentials();
  }

  @Get("accounts/:accountId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Get the cross-account AWS role configured for an account" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async getAccountCredential(@Param("accountId") accountId: string) {
    return await this.service.getAccountCredential(accountId);
  }

  @Post("accounts/:accountId/bootstrap")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({
    summary: "Generate the per-account external ID used by the customer role trust policy",
  })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async bootstrapAccountCredential(@Param("accountId") accountId: string) {
    return await this.service.bootstrapAccountCredential(accountId);
  }

  @Put("accounts/:accountId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Save the cross-account role ARN and usage scope for an account" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async upsertAccountCredential(@Param("accountId") accountId: string, @Body() body: UpsertAwsCrossAccountBindingDto) {
    return await this.service.upsertAccountCredential(accountId, body);
  }

  @Post("accounts/:accountId/rebind")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Start a two-phase replacement of the cross-account identity" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async rebindAccountCredential(@Param("accountId") accountId: string) {
    return await this.service.rebindAccountCredential(accountId);
  }

  @Delete("accounts/:accountId/rebind")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Cancel a pending cross-account identity replacement" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async cancelRebind(@Param("accountId") accountId: string) {
    return await this.service.cancelRebind(accountId);
  }

  @Post("accounts/:accountId/verify")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Verify the cross-account role via STS AssumeRole + GetCallerIdentity" })
  @ApiResponse({ status: 200, type: VerifyAwsCrossAccountBindingResponseDto })
  async verifyAccountCredential(@Param("accountId") accountId: string) {
    return await this.service.verifyAccountCredential(accountId);
  }

  @Post("accounts/:accountId/rotate-external-id")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Rotate the external ID of the binding for this account" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async rotateExternalId(@Param("accountId") accountId: string) {
    return await this.service.rotateExternalId(accountId);
  }

  @Delete("accounts/:accountId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Delete the cross-account AWS role configuration for an account" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async deleteAccountCredential(@Param("accountId") accountId: string) {
    return await this.service.deleteAccountCredential(accountId);
  }

  @Get("consumers/:consumerId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.AwsCrossAccountBindingUsage)
  @ApiOperation({ summary: "Get the account binding a host consumer (project / tenant) references" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingConsumerResponseDto })
  async getConsumerCredential(@Param("consumerId") consumerId: string) {
    return await this.service.getConsumerCredential(consumerId);
  }

  @Put("consumers/:consumerId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBindingUsage)
  @ApiOperation({ summary: "Attach a host consumer to an account binding, or move it to another account" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingConsumerResponseDto })
  async attachConsumerCredential(
    @Param("consumerId") consumerId: string,
    @Body() body: AttachAwsCrossAccountBindingConsumerDto,
  ) {
    return await this.service.attachConsumerCredential(consumerId, body.accountId);
  }

  @Delete("consumers/:consumerId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.AwsCrossAccountBindingUsage)
  @ApiOperation({ summary: "Detach a host consumer from its account binding" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingConsumerResponseDto })
  async detachConsumerCredential(@Param("consumerId") consumerId: string) {
    return await this.service.detachConsumerCredential(consumerId);
  }
}
