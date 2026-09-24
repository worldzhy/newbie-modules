import {Prisma} from '@generated/prisma/client';
import {isString} from 'class-validator';
import {datePlusMinutes, splitDateTime} from '@devbie/newbie/utilities/datetime.util';

function formatOutputDate(date: Date) {
  return new Date(date).toISOString().split('T')[0];
}

function eventGeneratedFields(data: any) {
  if (data.datetimeOfStart && data.timeZone) {
    data.datetimeOfStart = new Date(data.datetimeOfStart);
    const splitedDateTime = splitDateTime(data.datetimeOfStart, data.timeZone);

    data.year = splitedDateTime.year;
    data.month = splitedDateTime.month;
    data.dayOfMonth = splitedDateTime.dayOfMonth;
    data.hour = splitedDateTime.hour;
    data.minute = splitedDateTime.minute;
    data.dayOfWeek = splitedDateTime.dayOfWeek;
    data.weekOfMonth = splitedDateTime.weekOfMonth;
    data.weekOfYear = splitedDateTime.weekOfYear;

    if (data.minutesOfDuration) {
      data.datetimeOfEnd = datePlusMinutes(data.datetimeOfStart, data.minutesOfDuration);
    }
  }
}

const eventContainerCreateOrUpdate = ({model, operation, args, query}) => {
  if (args.data) {
    const {dateOfOpening, dateOfClosure} = args.data;
    if (isString(dateOfOpening)) {
      args.data.dateOfOpening = new Date(dateOfOpening);
    }
    if (isString(dateOfClosure)) {
      args.data.dateOfClosure = new Date(dateOfClosure);
    }
  }
  return query(args);
};

const eventContainerFindUniqueOrFindUniqueThrowOrFindFirstOrFindFirstThrow = async ({
  model,
  operation,
  args,
  query,
}) => {
  const result = await query(args);
  if (result) {
    if (result.dateOfOpening) {
      result.dateOfOpening = formatOutputDate(result.dateOfOpening);
    }
    if (result.dateOfClosure) {
      result.dateOfClosure = formatOutputDate(result.dateOfClosure);
    }
  }
  return result;
};

const eventContainerFindMany = async ({model, operation, args, query}) => {
  const result = await query(args);
  if (result.length) {
    for (let i = 0; i < result.length; i++) {
      if (result[i].dateOfOpening) {
        result[i].dateOfOpening = formatOutputDate(result.dateOfOpening);
      }
      if (result[i].dateOfClosure) {
        result[i].dateOfClosure = formatOutputDate(result.dateOfClosure);
      }
    }
  }
  return result;
};

const eventCreateOrUpdate = ({model, operation, args, query}) => {
  if (args.data) {
    eventGeneratedFields(args.data);
  }
  return query(args);
};

const eventCreateMany = ({model, operation, args, query}) => {
  if (args.data && args.data.length) {
    for (let i = 0; i < args.data.length; i++) {
      eventGeneratedFields(args.data[i]);
    }
  }
  return query(args);
};

const eventDelete = ({model, operation, args, query}) => {
  return query({
    ...args,
    operation: 'update',
    args: {
      where: args.where,
      data: {
        deletedAt: new Date(),
      },
    },
  });
};

const eventDeleteMany = ({model, operation, args, query}) => {
  return query({
    ...args,
    operation: 'updateMany',
    args: {
      where: args.where,
      data: {
        deletedAt: new Date(),
      },
    },
  });
};

export const eventPrismaExtension = Prisma.defineExtension(prisma =>
  prisma.$extends({
    query: {
      eventContainer: {
        create: eventContainerCreateOrUpdate,
        update: eventContainerCreateOrUpdate,
        findUnique: eventContainerFindUniqueOrFindUniqueThrowOrFindFirstOrFindFirstThrow,
        findUniqueOrThrow: eventContainerFindUniqueOrFindUniqueThrowOrFindFirstOrFindFirstThrow,
        findFirst: eventContainerFindUniqueOrFindUniqueThrowOrFindFirstOrFindFirstThrow,
        findFirstOrThrow: eventContainerFindUniqueOrFindUniqueThrowOrFindFirstOrFindFirstThrow,
        findMany: eventContainerFindMany,
      },
      event: {
        create: eventCreateOrUpdate,
        update: eventCreateOrUpdate,
        createMany: eventCreateMany,
        delete: eventDelete,
        deleteMany: eventDeleteMany,
      },
    },
  })
);
