import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  async createMembership(params: { userId: string }) {
    // [step 1] Generate a unique card number
    let existing = false;
    let cardNumber = "";
    do {
      const a = randomInt(0, 10); // 0~9
      const b = randomInt(0, 1000); // 0~999
      cardNumber = "9" + `${a}${a}${b}`;
      const count = await this.prisma.membership.count({ where: { cardNumber } });

      if (count > 0) {
        existing = true;
      } else {
        existing = false;
      }
    } while (existing);

    // [step 2] Assign the first level by default
    const firstLevel = await this.prisma.membershipLevel.findFirst({
      orderBy: { requiredPoints: "asc" },
    });
    return await this.prisma.membership.create({
      data: {
        userId: params.userId,
        cardNumber,
        levelId: firstLevel?.id,
      },
    });
  }

  /* End */
}
