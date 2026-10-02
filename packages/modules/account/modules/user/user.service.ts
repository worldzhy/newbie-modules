import { Injectable } from "@nestjs/common";
import { User } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { verifyEmail, verifyPhone } from "@modules/account/helpers/validator";
import { userPrismaExtension } from "./user.prisma.extension";

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {
    this.prisma.registerExtension(userPrismaExtension);
  }

  /**
   * Resolve an account identifier. Only email and phone are supported;
   * any other value resolves to no user so callers reject the login.
   */
  async findByAccount(account: string) {
    if (verifyEmail(account)) {
      return await this.prisma.user.findUnique({ where: { email: account } });
    } else if (verifyPhone(account)) {
      return await this.prisma.user.findUnique({ where: { phone: account } });
    } else {
      return null;
    }
  }

  withoutPassword(user: User) {
    const { password, ...others } = user;
    return others;
  }

  /* End */
}
