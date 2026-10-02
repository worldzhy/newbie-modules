import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { UpdateMeDto } from "./account.dto";
import { UserRequest } from "./account.interface";

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async me(request: UserRequest) {
    // The JWT strategy already verified the session and loaded the user's
    // roles into request.user, so only the profile lookup is needed here.
    return await this.prisma.user.findUniqueOrThrow({
      where: { id: request.user.userId },
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

  async updateMe(request: UserRequest, body: UpdateMeDto) {
    // Update only whitelisted fields. The DTO has already been stripped of
    // unknown properties by the global ValidationPipe, and the identity comes
    // from the authenticated session (request.user), never from the body.
    const { dateOfBirth, ...scalarFields } = body;
    return await this.prisma.user.update({
      where: { id: request.user.userId },
      data: {
        ...scalarFields,
        ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
      },
    });
  }

  /* End */
}
