import {BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req} from '@nestjs/common';
import {ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {PermissionAction, Prisma, User, UserRole} from '@generated/prisma/client';
import {RequirePermission} from '@microservices/account/security/authorization/authorization.decorator';
import {compareHash} from '@devbie/newbie/utilities/common.util';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {TokenService} from '@microservices/account/security/token/token.service';
import {UserService} from './user.service';
import {
  ChangeUserPasswordDto,
  CreateUserResponseDto,
  CreateUserDto,
  UpdateUserDto,
  UserChangePasswordResponseDto,
  UserListResponseDto,
  UserResponseDto,
} from './user.dto';
import {Request} from 'express';

@ApiTags('Account / User')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly tokenService: TokenService
  ) {}

  @Post('')
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.User)
  @ApiOperation({summary: 'Create a new user'})
  @ApiResponse({type: CreateUserResponseDto})
  async createUser(@Body() body: CreateUserDto) {
    // [step 1] Create the user. Cast: the validated DTO matches the Prisma create input
    // for scalar columns (roles as a plain enum array is valid on create).
    const user = await this.prisma.user.create({
      data: body as Prisma.UserCreateInput,
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

    // [step 2] Automatically create Permission records for the new user so that
    // they can pass the @RequirePermission checks on User resource endpoints.
    // A Manage-level permission on a resource matches any action (Create, List,
    // Get, Update, Delete), giving the user full access to their own resource.
    //
    // The ADMIN role already bypasses all permission checks in AuthorizationGuard,
    // so these records are primarily useful for non-ADMIN (USER role) users.

    const permissionData: Prisma.PermissionCreateInput[] = [
      {
        action: PermissionAction.Manage,
        resource: Prisma.ModelName.User,
        trustedUserId: user.id,
      },
    ];

    for (const p of permissionData) {
      await this.prisma.permission.create({data: p});
    }

    return user;
  }

  @Get('')
  @RequirePermission(PermissionAction.List, Prisma.ModelName.User)
  @ApiOperation({summary: 'Get users with pagination and filters'})
  @ApiResponse({type: UserListResponseDto})
  async getUsers(
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
    @Query('name') name?: string,
    @Query('roles') roles?: UserRole[]
  ) {
    // [step 1] Construct where argument.
    let where: Prisma.UserWhereInput | undefined;
    const whereConditions: object[] = [];

    if (name) {
      name = name.trim();
      if (name.length > 0) {
        whereConditions.push({name: {search: name}});
      }
    }

    if (roles) {
      whereConditions.push({roles: {hasSome: roles}});
    }

    if (whereConditions.length > 1) {
      where = {OR: whereConditions};
    } else if (whereConditions.length === 1) {
      where = whereConditions[0];
    } else {
      // where === undefined
    }

    // [step 2] Get users.
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.User,
      pagination: {page, pageSize},
      findManyArgs: {where: where},
    });

    // [step 3] Return users without password.
    result.records = result.records.map(user => {
      return this.userService.withoutPassword(user);
    });

    return result;
  }

  @Get(':userId')
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.User)
  @ApiOperation({summary: 'Get a user by id'})
  @ApiResponse({type: UserResponseDto})
  async getUser(@Param('userId') userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: {id: userId},
    });

    return this.userService.withoutPassword(user);
  }

  @Patch(':userId')
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.User)
  @ApiOperation({summary: 'Update a user'})
  @ApiResponse({type: UserResponseDto})
  @ApiBody({
    type: UpdateUserDto,
    description: 'Set roles with an empty array to remove all the roles of the user.',
    examples: {
      a: {
        summary: '1. Update',
        value: {
          email: '',
          phone: '',
          firstName: '',
          middleName: '',
          lastName: '',
        },
      },
    },
  })
  async updateUser(@Param('userId') userId: string, @Body() body: UpdateUserDto) {
    // Prisma requires scalar list updates to use {set: [...]}, while the DTO
    // accepts a plain enum array. Empty array clears all roles.
    const {roles, ...scalarFields} = body;
    const data: Prisma.UserUpdateInput = scalarFields as Prisma.UserUpdateInput;
    if (roles !== undefined) {
      data.roles = {set: roles};
    }

    const user = await this.prisma.user.update({
      where: {id: userId},
      data,
    });

    // Strip the password hash from the response to prevent sensitive data leakage.
    return this.userService.withoutPassword(user);
  }

  @Delete(':userId')
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.User)
  @ApiOperation({summary: 'Delete a user'})
  @ApiResponse({type: UserResponseDto})
  async deleteUser(@Param('userId') userId: string, @Req() req: Request): Promise<Omit<User, 'password'>> {
    // Prevent users from deleting their own account.
    const token = this.tokenService.getTokenFromHttpRequest(req);
    if (token) {
      const payload = this.tokenService.verifyUserAccessToken(token);
      if (payload.userId === userId) {
        throw new BadRequestException('You cannot delete your own account.');
      }
    }

    const user = await this.prisma.user.delete({
      where: {id: userId},
    });

    // Strip the password hash from the response.
    return this.userService.withoutPassword(user);
  }

  @Patch(':userId/change-password')
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.User)
  @ApiOperation({summary: "Change a user's password"})
  @ApiResponse({type: UserChangePasswordResponseDto})
  @ApiBody({
    type: ChangeUserPasswordDto,
    description: "The 'currentPassword' and 'newPassword' are required in request body.",
    examples: {
      a: {
        summary: '1. new password != current password',
        value: {
          currentPassword: '',
          newPassword: '',
        },
      },
    },
  })
  async changePassword(@Param('userId') userId: string, @Body() body: ChangeUserPasswordDto) {
    // [step 1] Verify if the new password is same with the current password.
    if (body.currentPassword.trim() === body.newPassword.trim()) {
      throw new BadRequestException('The new password is same with the current password.');
    }

    // [step 2] Verify the current password.
    const user = await this.prisma.user.findUniqueOrThrow({
      where: {id: userId},
    });
    const match = await compareHash(body.currentPassword, user.password);
    if (match === false) {
      throw new BadRequestException('The current password is incorrect.');
    }

    // [step 3] Change password (the Prisma extension validates strength and hashes it).
    return await this.prisma.user.update({
      where: {id: userId},
      data: {password: body.newPassword},
      select: {id: true, email: true, phone: true},
    });
  }

  /* End */
}
