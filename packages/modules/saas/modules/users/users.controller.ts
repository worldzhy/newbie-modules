import {
  BadRequestException,
  UnauthorizedException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {FilesInterceptor} from '@nestjs/platform-express';
import {Prisma, User} from '@prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {expose} from '../../helpers/expose';
import {Expose} from '../../helpers/interfaces';
import {UserRequest} from '../auth/auth.interface';
import {RateLimit} from '../auth/rate-limit.decorator';
import {Scopes} from '../auth/scope.decorator';
import {UpdateUserDto, UsersListReqDto, UsersListResDto} from './users.dto';
import {UsersService} from './users.service';
import {AccessTokenType} from '../auth/auth.interface';
import {INVALID_TOKEN} from '../../errors/errors.constants';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(
    private usersService: UsersService,
    private prisma: PrismaService
  ) {}

  /** Get users */
  @Get()
  @Scopes('user-*:read-info')
  async getAll(@Query() query: UsersListReqDto): Promise<UsersListResDto> {
    const {page, pageSize} = query;
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.User,
      pagination: {page, pageSize},
      findManyArgs: {
        orderBy: {id: 'desc'},
        include: {emails: true},
      },
    });

    result.records = result.records.map(user => expose<User>(user));
    return result;
  }

  /** Get a user */
  @Get(':userId')
  @Scopes('user-{userId}:read-info')
  async get(@Param('userId', ParseIntPipe) id: number): Promise<Expose<User>> {
    return this.usersService.getUser(id);
  }

  /** Get login user */
  @Get('/info/me')
  async getMe(@Req() req: UserRequest): Promise<Expose<User>> {
    const {userId} = req.user;
    try {
      const res = await this.usersService.getUser(userId as number);
      return res;
    } catch (e) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }
  }

  /** Update a user */
  @Patch(':userId')
  @Scopes('user-{userId}:write-info')
  async update(
    @Req() request: UserRequest,
    @Param('userId', ParseIntPipe) id: number,
    @Body() data: UpdateUserDto
  ): Promise<Expose<User>> {
    return this.usersService.updateUser(id, data, request.user.role);
  }

  /** Delete a user */
  @Delete(':userId')
  @Scopes('user-{userId}:deactivate')
  async remove(
    @Param('userId', ParseIntPipe) id: number,
    @Req() request: UserRequest
  ): Promise<Expose<User>> {
    return this.usersService.deactivateUser(
      id,
      request.user.type === AccessTokenType.user ? request.user.id : undefined
    );
  }

  /** Upload profile picture */
  @Post(':userId/profile-picture')
  @Scopes('user-{userId}:write-info')
  @UseInterceptors(FilesInterceptor('files'))
  async profilePicture(
    @Param('userId', ParseIntPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[]
  ) {
    if (files.length && files[0])
      return this.usersService.uploadProfilePicture(id, files[0]);
    else throw new BadRequestException();
  }

  /** Send a link to merge two users */
  @Post(':userId/merge-request')
  @Scopes('user-{userId}:merge')
  @RateLimit(10)
  async mergeRequest(
    @Param('userId', ParseIntPipe) id: number,
    @Body('email') email: string
  ): Promise<{queued: true}> {
    return this.usersService.requestMerge(id, email);
  }
}
