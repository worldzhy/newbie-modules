import {Injectable} from '@nestjs/common';
import {Prisma, UserRole} from '@generated/prisma/client';
import {Request} from 'express';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {TokenService} from '@microservices/account/security/token/token.service';

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService
  ) {}

  async me(request: Request) {
    // [step 1] Parse token from http request header.
    const accessToken = this.tokenService.getTokenFromHttpRequest(request);

    // [step 2] Get session record.
    const session = await this.prisma.session.findFirstOrThrow({
      where: {accessToken},
    });

    // [step 3] Get user.
    return await this.prisma.user.findUniqueOrThrow({
      where: {id: session.userId},
      select: {
        id: true,
        email: true,
        phone: true,
        roles: true,
        name: true,
        firstName: true,
        middleName: true,
        lastName: true,
        avatarFileId: true,
      },
    });
  }

  async updateMe(request: Request, body: Prisma.UserUpdateInput) {
    // [step 1] Parse token from http request header.
    const accessToken = this.tokenService.getTokenFromHttpRequest(request);

    // [step 2] Get session record.
    const session = await this.prisma.session.findFirstOrThrow({
      where: {accessToken},
    });

    // [step 3] Update user.
    return await this.prisma.user.update({
      where: {id: session.userId},
      data: body,
    });
  }

  async isAdmin(request: Request) {
    // [step 1] Parse token from http request header.
    const accessToken = this.tokenService.getTokenFromHttpRequest(request);

    // [step 2] Get session record.
    const session = await this.prisma.session.findFirstOrThrow({
      where: {accessToken},
    });

    // [step 3] Get user.
    const count = await this.prisma.user.count({
      where: {
        id: session.userId,
        roles: {has: UserRole.ADMIN},
      },
    });

    return count > 0 ? true : false;
  }

  /* End */
}
