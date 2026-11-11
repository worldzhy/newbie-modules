import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
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
  async createUser(@Body() body: CreateUserDto, @Req() request: UserRequest) {
    const { roles, ...scalarFields } = body;

    // A caller may only hand out roles whose permissions it already holds;
    // otherwise a custom role that merely carries "Create User" could mint an
    // ADMIN account.
    if (roles && roles.length > 0) {
      await this.assertGrantableRoles(roles, request.user.roles ?? []);
    }

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
    const { page, pageSize, name, roles, status } = query;

    // [step 1] Construct where argument. Every filter is optional and the
    // filters narrow jointly (AND): e.g. the approval queue is
    // status=PENDING_APPROVAL combined with a name search, so matching on
    // either condition alone would leak unrelated rows into the queue.
    let where: Prisma.UserWhereInput | undefined;
    const whereConditions: Prisma.UserWhereInput[] = [];

    if (name) {
      const trimmedName = name.trim();
      if (trimmedName.length > 0) {
        whereConditions.push({ name: { search: trimmedName } });
      }
    }

    if (roles && roles.length > 0) {
      whereConditions.push({ roles: { some: { role: { name: { in: roles } } } } });
    }

    if (status) {
      whereConditions.push({ status });
    }

    if (whereConditions.length > 1) {
      where = { AND: whereConditions };
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
      const callerRoles = request.user.roles ?? [];

      // Nobody may change their own role set: that is the difference between
      // holding "Update User" and being able to promote oneself to ADMIN.
      if (userId === request.user.userId) {
        throw new BadRequestException("You cannot change your own roles.");
      }

      // Refuse to touch a user whose roles carry permissions the caller does
      // not hold; the caller could otherwise strip a higher-privileged user's
      // roles and replace them with its own. The comparison is over effective
      // permission atoms, not role names: after ADR-043 an ADMIN does not
      // literally hold MEMBER, yet ADMIN's atom set fully covers it, so a name
      // comparison would make every MEMBER uneditable by every ADMIN.
      const target = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { roles: { select: { role: { select: { name: true } } } } },
      });
      const targetRoles = target.roles.map((entry) => entry.role.name);
      const atomsByRole = await this.loadRoleAtoms([...roles, ...targetRoles, ...callerRoles]);
      const callerAtoms = this.collectAtoms(atomsByRole, callerRoles);

      const outOfReach = this.rolesOutsidePermissions(targetRoles, atomsByRole, callerAtoms);
      if (outOfReach.length > 0) {
        throw new ForbiddenException(
          `You cannot change the roles of a user holding roles you do not have: ${outOfReach.join(", ")}.`,
        );
      }

      const ungrantable = this.rolesOutsidePermissions(roles, atomsByRole, callerAtoms);
      if (ungrantable.length > 0) {
        throw new ForbiddenException(
          `You cannot grant roles whose permissions you do not hold: ${ungrantable.join(", ")}.`,
        );
      }

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
    @Req() req: UserRequest,
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

    // Deleting a PENDING_APPROVAL account is how the IAM console rejects an
    // application: the row is gone, so the same person can submit a fresh
    // application instead of being stuck behind a permanent INACTIVE state.
    // Record the removed identity because the user row no longer carries it.
    await this.auditLogService.record(AuditEvent.USER_DELETED, {
      actorId: req.user.userId,
      resourceType: "user",
      resourceId: userId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      detail: { status: user.status, account: user.email ?? user.phone },
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
  async changePassword(
    @Param("userId") userId: string,
    @Body() body: ChangeUserPasswordDto,
    @Req() request: UserRequest,
  ) {
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
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { password: body.newPassword },
      select: { id: true, email: true, phone: true },
    });

    // [step 4] Revoke the user's sessions, mirroring the self-service flow:
    // old refresh tokens must not keep rotating after a password change. The
    // acting session survives only when an admin resets their own password.
    const currentSessionId = userId === request.user.userId ? request.user.sessionId : undefined;
    await this.prisma.session.deleteMany({
      where: {
        userId,
        ...(currentSessionId ? { NOT: { id: currentSessionId } } : {}),
      },
    });

    return updated;
  }

  /**
   * A caller may only hand out permissions it already holds, so a custom role
   * that merely carries "Create User" cannot mint an ADMIN account.
   *
   * The comparison is over effective permission atoms — the same union the
   * permission authorizer evaluates (Role → Permission ∪ Role →
   * RolePermissionGroup → PermissionGroup → PermissionGroupPermission) — not
   * over role names. Atoms express the actual security property ("you cannot
   * grant what you do not have") and stay correct for the superuser role, which
   * holds every atom through the derived "All" group without holding every role.
   */
  private async assertGrantableRoles(requested: string[], callerRoles: string[]): Promise<void> {
    if (requested.length === 0) return;

    const atomsByRole = await this.loadRoleAtoms([...requested, ...callerRoles]);
    const callerAtoms = this.collectAtoms(atomsByRole, callerRoles);
    const ungrantable = this.rolesOutsidePermissions(requested, atomsByRole, callerAtoms);

    if (ungrantable.length > 0) {
      throw new ForbiddenException(
        `You cannot grant roles whose permissions you do not hold: ${ungrantable.join(", ")}.`,
      );
    }
  }

  /** Load each role's effective permission atoms as "action:resource" strings. */
  private async loadRoleAtoms(roleNames: string[]): Promise<Map<string, Set<string>>> {
    const uniqueNames = [...new Set(roleNames)];
    const atomsByRole = new Map<string, Set<string>>();
    if (uniqueNames.length === 0) return atomsByRole;

    const roles = await this.prisma.role.findMany({
      where: { name: { in: uniqueNames } },
      select: {
        name: true,
        permissions: { select: { action: true, resource: true } },
        rolePermissionGroups: {
          select: {
            permissionGroup: {
              select: { permissions: { select: { action: true, resource: true } } },
            },
          },
        },
      },
    });

    for (const role of roles) {
      const atoms = new Set<string>();
      for (const permission of role.permissions) {
        atoms.add(`${permission.action}:${permission.resource}`);
      }
      for (const binding of role.rolePermissionGroups) {
        for (const permission of binding.permissionGroup.permissions) {
          atoms.add(`${permission.action}:${permission.resource}`);
        }
      }
      atomsByRole.set(role.name, atoms);
    }

    return atomsByRole;
  }

  /** Union of the atoms held by the given roles. */
  private collectAtoms(atomsByRole: Map<string, Set<string>>, roleNames: string[]): Set<string> {
    const atoms = new Set<string>();
    for (const name of roleNames) {
      for (const atom of atomsByRole.get(name) ?? []) atoms.add(atom);
    }
    return atoms;
  }

  /**
   * Roles whose atoms are not all held by the caller. A role missing from the
   * loaded set does not exist, so it is reported as outside the caller's reach
   * rather than silently ignored.
   */
  private rolesOutsidePermissions(
    roleNames: string[],
    atomsByRole: Map<string, Set<string>>,
    callerAtoms: Set<string>,
  ): string[] {
    return roleNames.filter((name) => {
      const atoms = atomsByRole.get(name);
      if (!atoms) return true;
      for (const atom of atoms) {
        if (!callerAtoms.has(atom)) return true;
      }
      return false;
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
