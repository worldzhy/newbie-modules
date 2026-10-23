import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
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
  @ApiOperation({ summary: "Get a role with its permissions" })
  @ApiResponse({ type: RoleDetailResponseDto })
  async getRole(@Param("roleId") roleId: number): Promise<RoleDetailResponseDto> {
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: { _count: { select: { users: true } }, permissions: true },
    });

    return { ...this.toResponseDto(role, role._count.users), permissions: role.permissions };
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
  @ApiOperation({ summary: "List the permissions granted to a role" })
  @ApiResponse({ type: PermissionResponseDto, isArray: true })
  async listRolePermissions(@Param("roleId") roleId: number): Promise<PermissionResponseDto[]> {
    await this.prisma.role.findUniqueOrThrow({ where: { id: roleId } });

    return await this.prisma.permission.findMany({
      where: { roleId },
      orderBy: [{ resource: "asc" }, { action: "asc" }],
    });
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
