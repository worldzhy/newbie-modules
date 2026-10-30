import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma, User } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { TokenService } from "@modules/security/token/token.service";
import { AuditLogService, AuditEvent } from "@modules/audit/audit-log.service";
import { UserRequest } from "@modules/security/security.interface";
import { UserService } from "./user.service";
import {
  ChangeUserPasswordDto,
  CreateUserResponseDto,
  CreateUserDto,
  ExternalIdentityResponseDto,
  LinkExternalIdentityDto,
  ListUsersRequestDto,
  ListUsersResponseDto,
  UpdateUserDto,
  UserChangePasswordResponseDto,
  UserResponseDto,
} from "./user.dto";
import { Request } from "express";

@ApiTags("Account / User")
@ApiBearerAuth()
@Controller("users")
export class UserController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post("")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.User)
  @ApiOperation({ summary: "Create a new user" })
  @ApiResponse({ type: CreateUserResponseDto })
  async createUser(@Body() body: CreateUserDto) {
    const { roles, ...scalarFields } = body;

    // Resolve role names to Role rows for the UserRole join table.
    const roleConnect =
      roles && roles.length > 0
        ? await this.prisma.role.findMany({ where: { name: { in: roles } }, select: { id: true } })
        : [];

    const user = await this.prisma.user.create({
      data: {
        ...scalarFields,
        roles: { create: roleConnect.map((r) => ({ role: { connect: { id: r.id } } })) },
      },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        name: true,
        firstName: true,
        middleName: true,
        lastName: true,
      },
    });

    return user;
  }

  @Get("")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.User)
  @ApiOperation({ summary: "Get users with pagination and filters" })
  @ApiResponse({ type: ListUsersResponseDto })
  async list(@Query() query: ListUsersRequestDto) {
    const { page, pageSize, name, roles } = query;

    // [step 1] Construct where argument. Every filter is optional; in
    // particular roles only narrows the list when at least one value is
    // given, so callers without the filter see every user.
    let where: Prisma.UserWhereInput | undefined;
    const whereConditions: object[] = [];

    if (name) {
      const trimmedName = name.trim();
      if (trimmedName.length > 0) {
        whereConditions.push({ name: { search: trimmedName } });
      }
    }

    if (roles && roles.length > 0) {
      whereConditions.push({ roles: { some: { role: { name: { in: roles } } } } });
    }

    if (whereConditions.length > 1) {
      where = { OR: whereConditions };
    } else if (whereConditions.length === 1) {
      where = whereConditions[0];
    } else {
      // where === undefined
    }

    // [step 2] Get users.
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.User,
      pagination: { page, pageSize },
      findManyArgs: {
        where: where,
        include: { roles: { include: { role: { select: { name: true } } } } },
      },
    });

    // [step 3] Return users through the response allowlist (password and
    // secret columns stripped); map roles to name strings.
    result.records = result.records.map((record) => {
      const { roles, ...user } = record as User & {
        roles: { role: { name: string } }[];
      };
      return { ...this.userService.withoutPassword(user), roles: roles.map((r) => r.role.name) };
    });

    return result;
  }

  @Get(":userId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.User)
  @ApiOperation({ summary: "Get a user by id" })
  @ApiResponse({ type: UserResponseDto })
  async getUser(@Param("userId") userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });

    const { roles, ...scalars } = user;
    return { ...this.userService.withoutPassword(scalars), roles: roles.map((r) => r.role.name) };
  }

  @Patch(":userId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.User)
  @ApiOperation({ summary: "Update a user" })
  @ApiResponse({ type: UserResponseDto })
  @ApiBody({
    type: UpdateUserDto,
    description: "Set roles with an empty array to remove all the roles of the user.",
    examples: {
      a: {
        summary: "1. Update",
        value: {
          email: "",
          phone: "",
          firstName: "",
          middleName: "",
          lastName: "",
        },
      },
    },
  })
  async updateUser(@Param("userId") userId: string, @Body() body: UpdateUserDto, @Req() request: UserRequest) {
    // Roles are now a UserRole join relation; resolve names to Role rows and
    // replace the whole set via deleteMany + create.
    const { roles, ...scalarFields } = body;
    const data: Prisma.UserUpdateInput = scalarFields as Prisma.UserUpdateInput;

    if (roles !== undefined) {
      const roleRows = await this.prisma.role.findMany({
        where: { name: { in: roles } },
        select: { id: true },
      });
      data.roles = {
        deleteMany: {},
        create: roleRows.map((r) => ({ role: { connect: { id: r.id } } })),
      };
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { roles: { include: { role: { select: { name: true } } } } },
    });

    if (roles !== undefined) {
      await this.auditLogService.record(AuditEvent.ROLES_CHANGED, {
        actorId: request.user.userId,
        resourceType: "user",
        resourceId: userId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        detail: { roles },
      });
    }

    const { roles: userRoles, ...scalars } = user;
    return { ...this.userService.withoutPassword(scalars), roles: userRoles.map((r) => r.role.name) };
  }

  @Delete(":userId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.User)
  @ApiOperation({ summary: "Delete a user" })
  @ApiResponse({ type: UserResponseDto })
  async deleteUser(
    @Param("userId") userId: string,
    @Req() req: Request,
  ): Promise<Omit<User, "password" | "twoFactorSecret" | "pendingTwoFactorSecret" | "wechatSessionKey">> {
    // Prevent users from deleting their own account.
    const token = this.tokenService.getTokenFromHttpRequest(req);
    if (token) {
      const payload = this.tokenService.verifyUserAccessToken(token);
      if (payload.userId === userId) {
        throw new BadRequestException("You cannot delete your own account.");
      }
    }

    const user = await this.prisma.user.delete({
      where: { id: userId },
    });

    // Strip the password hash from the response.
    return this.userService.withoutPassword(user);
  }

  @Patch(":userId/change-password")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.User)
  @ApiOperation({ summary: "Change a user's password" })
  @ApiResponse({ type: UserChangePasswordResponseDto })
  @ApiBody({
    type: ChangeUserPasswordDto,
    description: "The 'currentPassword' and 'newPassword' are required in request body.",
    examples: {
      a: {
        summary: "1. new password != current password",
        value: {
          currentPassword: "",
          newPassword: "",
        },
      },
    },
  })
  async changePassword(@Param("userId") userId: string, @Body() body: ChangeUserPasswordDto) {
    // [step 1] Verify if the new password is same with the current password.
    if (body.currentPassword.trim() === body.newPassword.trim()) {
      throw new BadRequestException("The new password is same with the current password.");
    }

    // [step 2] Verify the current password.
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const match = await compareHash(body.currentPassword, user.password);
    if (match === false) {
      throw new BadRequestException("The current password is incorrect.");
    }

    // [step 3] Change password (the Prisma extension validates strength and hashes it).
    return await this.prisma.user.update({
      where: { id: userId },
      data: { password: body.newPassword },
      select: { id: true, email: true, phone: true },
    });
  }

  /* External platform identities (evidence attribution, ADR-029) */

  @Get(":userId/external-identities")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.AccountExternalIdentity)
  @ApiOperation({ summary: "List a user's external platform identities" })
  @ApiResponse({ type: ExternalIdentityResponseDto, isArray: true })
  async listExternalIdentities(@Param("userId") userId: string) {
    return this.prisma.accountExternalIdentity.findMany({
      where: { userId },
      orderBy: { linkedAt: "asc" },
    });
  }

  @Post(":userId/external-identities")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.AccountExternalIdentity)
  @ApiOperation({ summary: "Link an external platform identity to a user" })
  @ApiResponse({ type: ExternalIdentityResponseDto })
  async linkExternalIdentity(@Param("userId") userId: string, @Body() body: LinkExternalIdentityDto) {
    const platform = body.platform.trim().toUpperCase();
    return this.prisma.accountExternalIdentity.upsert({
      where: {
        platform_externalAccountId: {
          platform,
          externalAccountId: body.externalAccountId,
        },
      },
      create: {
        userId,
        platform,
        externalAccountId: body.externalAccountId,
        displayName: body.displayName,
      },
      update: {
        userId,
        displayName: body.displayName,
      },
    });
  }

  @Delete(":userId/external-identities/:identityId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.AccountExternalIdentity)
  @ApiOperation({ summary: "Unlink an external platform identity" })
  @ApiResponse({ type: ExternalIdentityResponseDto })
  async unlinkExternalIdentity(@Param("userId") userId: string, @Param("identityId") identityId: string) {
    await this.prisma.accountExternalIdentity.deleteMany({ where: { id: identityId, userId } });
    return { id: identityId, deleted: true };
  }

  /* End */
}
