import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { AuditLogService, AuditEvent } from "@modules/audit/audit-log.service";
import {
  AddPermissionGroupPermissionDto,
  CreatePermissionGroupDto,
  ListPermissionGroupsRequestDto,
  ListPermissionGroupsResponseDto,
  PermissionGroupDetailResponseDto,
  PermissionGroupPermissionResponseDto,
  PermissionGroupResponseDto,
  UpdatePermissionGroupDto,
} from "./permission-group.dto";

@ApiTags("Account / PermissionGroup")
@ApiBearerAuth()
@Controller("permission-groups")
export class PermissionGroupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post("")
  @RequirePermission(PermissionAction.Manage, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Create a permission group" })
  @ApiResponse({ type: PermissionGroupResponseDto })
  async create(@Body() body: CreatePermissionGroupDto): Promise<PermissionGroupResponseDto> {
    const existing = await this.prisma.permissionGroup.findUnique({ where: { name: body.name } });
    if (existing) {
      throw new BadRequestException(`Permission group "${body.name}" already exists.`);
    }

    const group = await this.prisma.permissionGroup.create({ data: body });

    await this.auditLogService.record(AuditEvent.ROLES_CHANGED, {
      detail: { action: "permission_group_created", permissionGroupId: group.id, name: group.name },
    });

    return this.toResponseDto(group);
  }

  @Get("")
  @RequirePermission(PermissionAction.Manage, Prisma.ModelName.Role)
  @ApiOperation({ summary: "List permission groups with pagination and optional name filter" })
  @ApiResponse({ type: ListPermissionGroupsResponseDto })
  async list(@Query() query: ListPermissionGroupsRequestDto): Promise<ListPermissionGroupsResponseDto> {
    const { page, pageSize, name } = query;

    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.PermissionGroup,
      pagination: { page, pageSize },
      findManyArgs: {
        where: name ? { name: { contains: name, mode: "insensitive" } } : undefined,
        orderBy: { id: "asc" },
      },
    });

    return {
      ...result,
      records: (result.records as Prisma.PermissionGroupGetPayload<object>[]).map((g) => this.toResponseDto(g)),
    };
  }

  @Get(":id")
  @RequirePermission(PermissionAction.Manage, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Get a permission group with its permissions" })
  @ApiResponse({ type: PermissionGroupDetailResponseDto })
  async get(@Param("id") id: number): Promise<PermissionGroupDetailResponseDto> {
    const group = await this.prisma.permissionGroup.findUniqueOrThrow({
      where: { id },
      include: { permissions: { orderBy: [{ resource: "asc" }, { action: "asc" }] } },
    });

    return {
      ...this.toResponseDto(group),
      permissions: group.permissions.map((p) => this.toPermissionDto(p)),
    };
  }

  @Patch(":id")
  @RequirePermission(PermissionAction.Manage, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Update a permission group (builtin groups cannot be renamed)" })
  @ApiResponse({ type: PermissionGroupResponseDto })
  async update(@Param("id") id: number, @Body() body: UpdatePermissionGroupDto): Promise<PermissionGroupResponseDto> {
    const existing = await this.prisma.permissionGroup.findUniqueOrThrow({ where: { id } });

    if (existing.isBuiltin && body.name !== undefined && body.name !== existing.name) {
      throw new ForbiddenException(`Builtin permission group "${existing.name}" cannot be renamed.`);
    }

    if (body.name !== undefined && body.name !== existing.name) {
      const conflicting = await this.prisma.permissionGroup.findUnique({ where: { name: body.name } });
      if (conflicting) {
        throw new BadRequestException(`Permission group "${body.name}" already exists.`);
      }
    }

    const updated = await this.prisma.permissionGroup.update({ where: { id }, data: body });

    await this.auditLogService.record(AuditEvent.ROLES_CHANGED, {
      detail: { action: "permission_group_updated", permissionGroupId: id, name: updated.name },
    });

    return this.toResponseDto(updated);
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Manage, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Delete a permission group (builtin groups cannot be deleted)" })
  @ApiResponse({ type: PermissionGroupResponseDto })
  async delete(@Param("id") id: number): Promise<PermissionGroupResponseDto> {
    const existing = await this.prisma.permissionGroup.findUniqueOrThrow({ where: { id } });

    if (existing.isBuiltin) {
      throw new ForbiddenException(`Builtin permission group "${existing.name}" cannot be deleted.`);
    }

    const deleted = await this.prisma.permissionGroup.delete({ where: { id } });

    await this.auditLogService.record(AuditEvent.ROLES_CHANGED, {
      detail: { action: "permission_group_deleted", permissionGroupId: id, name: deleted.name },
    });

    return this.toResponseDto(deleted);
  }

  @Post(":id/permissions")
  @RequirePermission(PermissionAction.Manage, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Add a permission to a permission group" })
  @ApiResponse({ type: PermissionGroupPermissionResponseDto })
  async addPermission(
    @Param("id") id: number,
    @Body() body: AddPermissionGroupPermissionDto,
  ): Promise<PermissionGroupPermissionResponseDto> {
    await this.prisma.permissionGroup.findUniqueOrThrow({ where: { id } });

    try {
      const perm = await this.prisma.permissionGroupPermission.create({
        data: { permissionGroupId: id, action: body.action, resource: body.resource },
      });

      await this.auditLogService.record(AuditEvent.ROLES_CHANGED, {
        detail: {
          action: "permission_group_permission_added",
          permissionGroupId: id,
          permissionAction: body.action,
          resource: body.resource,
        },
      });

      return this.toPermissionDto(perm);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
        throw new ConflictException(
          `Permission ${body.action}:${body.resource} already exists in this permission group.`,
        );
      }
      throw err;
    }
  }

  @Delete(":id/permissions/:permissionId")
  @RequirePermission(PermissionAction.Manage, Prisma.ModelName.Role)
  @ApiOperation({ summary: "Remove a permission from a permission group" })
  @ApiResponse({ status: 204, description: "Removed successfully." })
  async removePermission(@Param("id") id: number, @Param("permissionId") permissionId: number): Promise<void> {
    const existing = await this.prisma.permissionGroupPermission.findUnique({
      where: { id: permissionId },
    });

    if (!existing || existing.permissionGroupId !== id) {
      throw new NotFoundException(`Permission ${permissionId} not found in permission group ${id}.`);
    }

    await this.prisma.permissionGroupPermission.delete({ where: { id: permissionId } });

    await this.auditLogService.record(AuditEvent.ROLES_CHANGED, {
      detail: {
        action: "permission_group_permission_removed",
        permissionGroupId: id,
        permissionId,
      },
    });
  }

  private toResponseDto(group: {
    id: number;
    name: string;
    description: string | null;
    routePath: string;
    navGroup: string;
    navLabel: string;
    navIcon: string | null;
    isBuiltin: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): PermissionGroupResponseDto {
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      routePath: group.routePath,
      navGroup: group.navGroup,
      navLabel: group.navLabel,
      navIcon: group.navIcon,
      isBuiltin: group.isBuiltin,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  private toPermissionDto(p: {
    id: number;
    permissionGroupId: number;
    action: PermissionAction;
    resource: string;
    createdAt: Date;
    updatedAt: Date;
  }): PermissionGroupPermissionResponseDto {
    return {
      id: p.id,
      permissionGroupId: p.permissionGroupId,
      action: p.action,
      resource: p.resource,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
