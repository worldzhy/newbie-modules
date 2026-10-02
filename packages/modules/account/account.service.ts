import { Injectable } from "@nestjs/common";
import { UserRole } from "@generated/prisma/client";
import { Request } from "express";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { TokenService } from "@modules/account/security/token/token.service";
import { UpdateMeDto } from "./account.dto";

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async me(request: Request) {
    // [step 1] Parse token from http request header.
    const accessToken = this.tokenService.getTokenFromHttpRequest(request);

    // [step 2] Get session record.
    const session = await this.prisma.session.findFirstOrThrow({
      where: { accessToken },
    });

    // [step 3] Get user.
    return await this.prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
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

  async updateMe(request: Request, body: UpdateMeDto) {
    // [step 1] Parse token from http request.
    const accessToken = this.tokenService.getTokenFromHttpRequest(request);

    // [step 2] Get session record.
    const session = await this.prisma.session.findFirstOrThrow({
      where: { accessToken },
    });

    // [step 3] Update user with only whitelisted fields. The DTO has already
    // been stripped of unknown properties by the global ValidationPipe.
    const { dateOfBirth, ...scalarFields } = body;
    return await this.prisma.user.update({
      where: { id: session.userId },
      data: {
        ...scalarFields,
        ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
      },
    });
  }

  async isAdmin(request: Request) {
    // [step 1] Parse token from http request header.
    const accessToken = this.tokenService.getTokenFromHttpRequest(request);

    // [step 2] Get session record.
    const session = await this.prisma.session.findFirstOrThrow({
      where: { accessToken },
    });

    // [step 3] Get user.
    const count = await this.prisma.user.count({
      where: {
        id: session.userId,
        roles: { has: UserRole.ADMIN },
      },
    });

    return count > 0 ? true : false;
  }

  /* End */
}
