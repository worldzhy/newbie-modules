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
   * Emails are normalized to lower case to match the write-side normalization
   * in userPrismaExtension, otherwise a case-variant spelling would miss the row.
   */
  async findByAccount(account: string) {
    const trimmed = account.trim();
    if (verifyEmail(trimmed)) {
      return await this.prisma.user.findUnique({ where: { email: trimmed.toLowerCase() } });
    } else if (verifyPhone(trimmed)) {
      return await this.prisma.user.findUnique({ where: { phone: trimmed } });
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
