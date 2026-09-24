import {Body, Controller, Delete, Get, Param, Patch, Post, Query} from '@nestjs/common';
import {ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {Permission, PermissionAction, Prisma} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {
  PermissionListResponseDto,
  PermissionResponseDto,
  CreatePermissionDto,
  UpdatePermissionDto,
} from './permission.dto';

@ApiTags('Account / Permission')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('resources')
  @ApiOperation({summary: 'List all permission resource names'})
  @ApiResponse({type: String, isArray: true})
  listPermissionResources() {
    return Object.values(Prisma.ModelName);
  }

  @Get('actions')
  @ApiOperation({summary: 'List all permission action names'})
  @ApiResponse({type: String, isArray: true})
  listPermissionActions() {
    return Object.values(PermissionAction);
  }

  @Post('')
  @ApiOperation({summary: 'Create a permission'})
  @ApiResponse({type: PermissionResponseDto})
  @ApiBody({
    type: CreatePermissionDto,
    description: "The 'name' is required in request body.",
    examples: {
      a: {
        summary: '1. Create',
        value: {
          resource: Prisma.ModelName.User,
          action: PermissionAction.Get,
          where: {state: {in: ['StateA', 'StateB']}},
          trustedUserId: 'fd5c948e-d15d-48d6-a458-7798e4d9921c',
        },
      },
    },
  })
  async createPermission(@Body() body: CreatePermissionDto): Promise<Permission> {
    // Cast: the validated DTO is a flat scalar object that matches the Prisma create input.
    return await this.prisma.permission.create({
      data: body as Prisma.PermissionCreateInput,
    });
  }

  @Get('')
  @ApiOperation({summary: 'Get permissions with pagination and optional resource filter'})
  @ApiResponse({type: PermissionListResponseDto})
  async getPermissions(
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
    @Query('resource') resource?: string
  ) {
    // [step 1] Construct where argument.
    let where: Prisma.PermissionWhereInput | undefined;
    const whereConditions: object[] = [];
    if (resource) {
      resource = resource.trim();
      if (resource.length > 0) {
        whereConditions.push({resource: {search: resource}});
      }
    }

    if (whereConditions.length > 0) {
      where = {OR: whereConditions};
    }

    // [step 2] Get permissions.
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Permission,
      pagination: {page, pageSize},
      findManyArgs: {where},
    });
  }

  @Get(':permissionId')
  @ApiOperation({summary: 'Get a permission by id'})
  @ApiResponse({type: PermissionResponseDto})
  async getPermission(@Param('permissionId') permissionId: number): Promise<Permission> {
    return await this.prisma.permission.findUniqueOrThrow({
      where: {id: permissionId},
    });
  }

  @Patch(':permissionId')
  @ApiOperation({summary: 'Update a permission'})
  @ApiResponse({type: PermissionResponseDto})
  @ApiBody({
    type: UpdatePermissionDto,
    description: '',
    examples: {
      a: {
        summary: '1. Update name',
        value: {
          resource: Prisma.ModelName.User,
          action: PermissionAction.Update,
          trustedUserId: 'fd5c948e-d15d-48d6-a458-7798e4d9921c',
        },
      },
    },
  })
  async updatePermission(
    @Param('permissionId') permissionId: number,
    @Body()
    body: UpdatePermissionDto
  ): Promise<Permission> {
    // Cast: the validated DTO is a flat scalar object that matches the Prisma update input.
    return await this.prisma.permission.update({
      where: {id: permissionId},
      data: body as Prisma.PermissionUpdateInput,
    });
  }

  @Delete(':permissionId')
  @ApiOperation({summary: 'Delete a permission'})
  @ApiResponse({type: PermissionResponseDto})
  async deletePermission(@Param('permissionId') permissionId: number): Promise<Permission> {
    return await this.prisma.permission.delete({
      where: {id: permissionId},
    });
  }

  /* End */
}
