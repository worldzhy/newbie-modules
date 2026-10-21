import { Prisma } from "@generated/prisma/client";
import { generateRandomNumbers } from "@devbie/newbie/utilities/common.util";

export const cloudformationPrismaExtension = Prisma.defineExtension((prisma) =>
  prisma.$extends({
    query: {
      awsResourceStack: {
        async create({ args, query }) {
          const { data } = args;
          if (data && !data.name && data.type) {
            args.data = {
              ...args.data,
              name: (args.data.type + "-" + generateRandomNumbers(8)).replace(/_/g, "-"),
            };
          }
          return query(args);
        },
      },
    },
  }),
);
