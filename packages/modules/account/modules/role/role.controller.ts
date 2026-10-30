import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { AuditLogService, AuditEvent } from "@modules/audit/audit-log.service";
import { PermissionResponseDto } from "../permission/permission.dto";
import {
  CreateRoleDto,
  ListRolesRequestDto,
  ListRolesResponseDto,
  ReplaceRolePermissionGroupsDto,
  RoleDetailResponseDto,
  RoleResponseDto,
  UpdateRoleDto,
} from "./role.dto";

@ApiTags("Account / Role")
@ApiBearerAuth()
@Controller("roles")
export class RoleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post("")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Create a role" })
  @ApiResponse({ type: RoleResponseDto })
  @ApiBody({
    type: CreateRoleDto,
    examples: {
      a: {
        summary: "1. Create",
        value: { name: "DevOps", description: "Operations team" },
      },
    },
  })
  async createRole(@Body() body: CreateRoleDto): Promise<RoleResponseDto> {
    const existing = await this.prisma.role.findUnique({ where: { name: body.name } });
    if (existing) {
      throw new BadRequestException(`Role "${body.name}" already exists.`);
    }

    const role = await this.prisma.role.create({
      // Roles created via the API are never builtin; builtin roles are
      // seeded by migrations only.
      data: { name: body.name, description: body.description, isBuiltin: false },
    });

    await this.auditLogService.record(AuditEvent.ROLES_CHANGED, {
      detail: { action: "role_created", roleId: role.id, roleName: role.name },
    });

    return this.toResponseDto(role, 0);
  }

  @Get("")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Get roles with pagination" })
  @ApiResponse({ type: ListRolesResponseDto })
  async list(@Query() query: ListRolesRequestDto) {
    const { page, pageSize } = query;

    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Role,
      pagination: { page, pageSize },
      findManyArgs: {
        orderBy: { id: "asc" },
        include: { _count: { select: { users: true } } },
      },
    });

    return {
      ...result,
      records: (result.records as Prisma.RoleGetPayload<{ include: { _count: { select: { users: true } } } }>[]).map(
        (role) => this.toResponseDto(role, role._count.users),
      ),
    };
  }

  @Get(":roleId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Get a role with its permissions and permission groups" })
  @ApiResponse({ type: RoleDetailResponseDto })
  async getRole(@Param("roleId") roleId: number): Promise<RoleDetailResponseDto> {
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: {
        _count: { select: { users: true } },
        permissions: true,
        rolePermissionGroups: {
          include: {
            permissionGroup: {
              select: {
                id: true,
                name: true,
                routePath: true,
                navPlacement: true,
                navOrder: true,
                navLabel: true,
                navIcon: true,
              },
            },
          },
        },
      },
    });

    return {
      ...this.toResponseDto(role, role._count.users),
      permissions: role.permissions,
      permissionGroups: role.rolePermissionGroups.map((rpg) => rpg.permissionGroup),
    };
  }

  @Patch(":roleId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Rename or re-describe a role" })
  @ApiResponse({ type: RoleResponseDto })
  async updateRole(@Param("roleId") roleId: number, @Body() body: UpdateRoleDto): Promise<RoleResponseDto> {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { id: roleId } });
    if (role.isBuiltin && body.name !== undefined && body.name !== role.name) {
      throw new BadRequestException(`Builtin role "${role.name}" cannot be renamed.`);
    }

    if (body.name !== undefined && body.name !== role.name) {
      const conflicting = await this.prisma.role.findUnique({ where: { name: body.name } });
      if (conflicting) {
        throw new BadRequestException(`Role "${body.name}" already exists.`);
      }
    }

    const updated = await this.prisma.role.update({ where: { id: roleId }, data: body });

    await this.auditLogService.record(AuditEvent.ROLES_CHANGED, {
      detail: { action: "role_updated", roleId, roleName: updated.name },
    });

    const userCount = await this.prisma.userRole.count({ where: { roleId } });
    return this.toResponseDto(updated, userCount);
  }

  @Delete(":roleId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Delete a role" })
  @ApiResponse({ type: RoleResponseDto })
  async deleteRole(@Param("roleId") roleId: number): Promise<RoleResponseDto> {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { id: roleId } });
    if (role.isBuiltin) {
      // ADMIN carries the *:Manage grant and USER is the signup default
      // (auth services connectOrCreate it); both must survive.
      throw new BadRequestException(`Builtin role "${role.name}" cannot be deleted.`);
    }

    const userCount = await this.prisma.userRole.count({ where: { roleId } });
    if (userCount > 0) {
      throw new BadRequestException(
        `Role "${role.name}" is still held by ${userCount} user(s). Remove the role from those users first.`,
      );
    }

    const deleted = await this.prisma.role.delete({ where: { id: roleId } });

    await this.auditLogService.record(AuditEvent.ROLES_CHANGED, {
      detail: { action: "role_deleted", roleId, roleName: deleted.name },
    });

    return this.toResponseDto(deleted, 0);
  }

  @Get(":roleId/permissions")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.Role)
  @ApiOperation({ summary: "List the direct permissions granted to a role" })
  @ApiResponse({ type: PermissionResponseDto, isArray: true })
  async listRolePermissions(@Param("roleId") roleId: number): Promise<PermissionResponseDto[]> {
    await this.prisma.role.findUniqueOrThrow({ where: { id: roleId } });

    return await this.prisma.permission.findMany({
      where: { roleId },
      orderBy: [{ resource: "asc" }, { action: "asc" }],
    });
  }

  @Post(":roleId/permission-groups")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Replace a role's permission group bindings (transactional)" })
  @ApiResponse({ type: RoleDetailResponseDto })
  async replaceRolePermissionGroups(
    @Param("roleId") roleId: number,
    @Body() body: ReplaceRolePermissionGroupsDto,
  ): Promise<RoleDetailResponseDto> {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { id: roleId } });
    if (role.isBuiltin) {
      throw new BadRequestException(`Builtin role "${role.name}" cannot have its permission group bindings replaced.`);
    }

    // Validate all permission group IDs exist
    if (body.permissionGroupIds.length > 0) {
      const groups = await this.prisma.permissionGroup.findMany({
        where: { id: { in: body.permissionGroupIds } },
        select: { id: true },
      });
      const foundIds = new Set(groups.map((g) => g.id));
      const missing = body.permissionGroupIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(`Permission group(s) not found: ${missing.join(", ")}`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermissionGroup.deleteMany({ where: { roleId } });

      if (body.permissionGroupIds.length > 0) {
        await tx.rolePermissionGroup.createMany({
          data: body.permissionGroupIds.map((pgId) => ({ roleId, permissionGroupId: pgId })),
        });
      }
    });

    await this.auditLogService.record(AuditEvent.ROLES_CHANGED, {
      detail: {
        action: "role_permission_groups_replaced",
        roleId,
        roleName: role.name,
        permissionGroupIds: body.permissionGroupIds,
      },
    });

    // Return updated role detail
    return this.getRole(roleId);
  }

  private toResponseDto(
    role: {
      id: number;
      name: string;
      isBuiltin: boolean;
      description: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    userCount: number,
  ): RoleResponseDto {
    return {
      id: role.id,
      name: role.name,
      isBuiltin: role.isBuiltin,
      description: role.description,
      userCount,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
