// import {BadRequestException} from '@nestjs/common';
// import {Prisma} from '@generated/prisma/client';
// import {generateHash} from '@devbie/newbie/utilities/common.util';
// import {verifyEmail, verifyPassword} from '@modules/account/helpers/validator';
//
// export async function userPrismaMiddleware(
//   params: Prisma.MiddlewareParams,
//   next: (params: Prisma.MiddlewareParams) => Promise<any>
// ) {
//   if (params.model === Prisma.ModelName.User) {
//     switch (params.action) {
//       case 'create':
//       case 'update':
//         if (params.args['data']['email']) {
//           if (!verifyEmail(params.args['data']['email'])) {
//             throw new BadRequestException('Your email is not valid.');
//           }
//           params.args['data']['email'] = (params.args['data']['email'] as string).toLowerCase().trim();
//         }
//
//         if (params.args['data']['password']) {
//           if (!verifyPassword(params.args['data']['password'])) {
//             throw new BadRequestException(
//               'The password is not strong enough. (length >= 8, lowercase >= 1, uppercase >= 1, numbers >= 1, symbols >= 1)'
//             );
//           }
//           // Generate hash of the password.
//           const hash = await generateHash(params.args['data']['password']);
//           params.args['data']['password'] = hash;
//         }
//
//         if (params.args['data']['firstName'] && params.args['data']['lastName']) {
//           params.args['data']['name'] =
//             params.args['data']['firstName'] +
//             ' ' +
//             (params.args['data']['middleName'] ? params.args['data']['middleName'] + ' ' : '') +
//             params.args['data']['lastName'];
//         }
//
//         if (params.args['data']['dateOfBirth']) {
//           params.args['data']['dateOfBirth'] = new Date(params.args['data']['dateOfBirth'].toString());
//         }
//
//         return next(params);
//
//       default:
//         return next(params);
//     }
//   }
//
//   return next(params);
// }
