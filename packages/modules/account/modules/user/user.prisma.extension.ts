import { Prisma } from "@generated/prisma/client";
import { generateHash } from "@devbie/newbie/utilities/common.util";
import { verifyEmail, verifyPassword } from "@modules/account/helpers/validator";
import { PASSWORD_RULE_MESSAGE } from "@modules/account/helpers/password.validator";
import { BadRequestException } from "@nestjs/common";

export const userPrismaExtension = Prisma.defineExtension((prisma) =>
  prisma.$extends({
    query: {
      user: {
        async $allOperations({ model, operation, args, query }) {
          if (operation === "create" || operation === "update") {
            if (args.data) {
              const { email, password, firstName, lastName, middleName, dateOfBirth } = args.data;

              if (email && typeof email === "string") {
                if (!verifyEmail(email)) {
                  throw new BadRequestException("Your email is not valid.");
                }
                args.data = {
                  ...args.data,
                  email: (email as string).toLowerCase().trim(),
                };
              }

              if (password && typeof password === "string") {
                if (!verifyPassword(password)) {
                  throw new BadRequestException(PASSWORD_RULE_MESSAGE);
                }
                const hash = await generateHash(password);
                args.data = {
                  ...args.data,
                  password: hash,
                };
              }

              if (firstName && lastName && typeof firstName === "string" && typeof lastName === "string") {
                const name =
                  firstName + " " + (middleName && typeof middleName === "string" ? middleName + " " : "") + lastName;
                args.data = {
                  ...args.data,
                  name,
                };
              }

              if (dateOfBirth) {
                args.data = {
                  ...args.data,
                  dateOfBirth: new Date(dateOfBirth.toString()),
                };
              }
            }
          }
          return query(args);
        },
      },
    },
  }),
);
