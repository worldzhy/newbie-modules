import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import type {Prisma, UserRole} from '@prisma/client';
import {User} from '@prisma/client';
import {compare} from 'bcrypt';
import {
  CURRENT_PASSWORD_REQUIRED,
  FILE_TOO_LARGE,
  INVALID_CREDENTIALS,
  USER_NOT_FOUND,
} from '../../errors/errors.constants';
import {safeEmail} from '../../helpers/safe-email';
import {Expose} from '../../helpers/interfaces';
import {expose} from '../../helpers/expose';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {MERGE_ACCOUNTS_TOKEN} from '../../providers/tokens/tokens.constants';
import {TokensService} from '../../providers/tokens/tokens.service';
import {ApiKeysService} from '../api-keys/api-keys.service';
import {AuthService} from '../auth/auth.service';
import {PasswordUpdateInput} from './users.interface';
import {AwsS3Service} from '@modules/aws-s3/aws-s3.service';
import {EmailService} from '@modules/notification/email/email.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private email: EmailService,
    private configService: ConfigService,
    private tokensService: TokensService,
    private s3Service: AwsS3Service,
    private apiKeysService: ApiKeysService
  ) {}

  async getUser(id: number): Promise<Expose<User>> {
    const user = await this.prisma.user.findUnique({
      where: {id},
    });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return expose<User>(user);
  }

  async getUsers(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.UserWhereUniqueInput;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithAggregationInput;
  }): Promise<Expose<User>[]> {
    const {skip, take, cursor, where, orderBy} = params;
    try {
      const users = await this.prisma.user.findMany({
        skip,
        take,
        cursor,
        where,
        orderBy,
      });
      return users.map(user => expose<User>(user));
    } catch (error) {
      return [];
    }
  }

  async updateUser(
    id: number,
    data: Omit<Prisma.UserUpdateInput, 'password'> & PasswordUpdateInput,
    role?: UserRole
  ): Promise<Expose<User>> {
    const testUser = await this.prisma.user.findUnique({where: {id}});
    if (!testUser) throw new NotFoundException(USER_NOT_FOUND);
    const transformed: Prisma.UserUpdateInput & PasswordUpdateInput = data;
    // If the user is updating their password
    if (data.newPassword) {
      if (!data.currentPassword)
        throw new BadRequestException(CURRENT_PASSWORD_REQUIRED);
      const user = await this.prisma.user.findUniqueOrThrow({
        where: {id},
        include: {prefersEmail: true},
      });
      const previousPassword = user.password;
      if (previousPassword)
        if (!(await compare(data.currentPassword, previousPassword)))
          throw new BadRequestException(INVALID_CREDENTIALS);
      transformed.password = await this.auth.hashAndValidatePassword(
        data.newPassword,
        !!data.ignorePwnedPassword
      );
      if (user.prefersEmail) {
        this.email.sendWithTemplate({
          toAddress: `"${user.name}" <${user.prefersEmail.email}>`,
          template: {'users/password-changed': {userName: user.name}},
        });
      }
    }
    delete transformed.currentPassword;
    delete transformed.newPassword;
    delete transformed.ignorePwnedPassword;
    if (role !== 'SUDO') delete transformed.role;
    const updateData: Prisma.UserUpdateInput = transformed;
    const user = await this.prisma.user.update({
      data: updateData,
      where: {id},
    });
    // If the role of this user has changed
    if (transformed.role && testUser.role !== transformed.role) {
      // Log out from all sessions since their scopes have changed
      await this.prisma.session.deleteMany({where: {user: {id}}});
      // Remove all scopes now allowed anymore from API keys
      await this.apiKeysService.cleanAllApiKeysForUser(id);
    }
    return expose<User>(user);
  }

  async deactivateUser(
    id: number,
    deactivatedBy?: number
  ): Promise<Expose<User>> {
    const user = await this.prisma.user.update({
      where: {id},
      data: {active: false},
      include: {prefersEmail: true},
    });
    await this.prisma.session.deleteMany({where: {user: {id}}});
    if (deactivatedBy === id)
      if (user.prefersEmail) {
        this.email.sendWithTemplate({
          toAddress: `"${user.name}" <${user.prefersEmail.email}>`,
          template: {'users/deactivated': {userName: user.name}},
        });
      }

    return expose<User>(user);
  }

  async deleteUser(id: number): Promise<Expose<User>> {
    const testUser = await this.prisma.user.findUnique({where: {id}});
    if (!testUser) throw new NotFoundException(USER_NOT_FOUND);
    await this.prisma.membership.deleteMany({where: {user: {id}}});
    await this.prisma.email.deleteMany({where: {user: {id}}});
    await this.prisma.session.deleteMany({where: {user: {id}}});
    await this.prisma.approvedSubnet.deleteMany({where: {user: {id}}});
    await this.prisma.backupCode.deleteMany({where: {user: {id}}});
    await this.prisma.identity.deleteMany({where: {user: {id}}});
    await this.prisma.auditLog.deleteMany({where: {user: {id}}});
    await this.prisma.apiKey.deleteMany({where: {user: {id}}});
    const user = await this.prisma.user.delete({where: {id}});
    return expose<User>(user);
  }

  async requestMerge(userId: number, email: string): Promise<{queued: true}> {
    const emailSafe = safeEmail(email);
    const user = await this.prisma.user.findFirst({
      where: {emails: {some: {emailSafe}}},
      include: {prefersEmail: true},
    });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    if (user.id === userId) throw new NotFoundException(USER_NOT_FOUND);
    const minutes = parseInt(
      this.configService.get<string>(
        'modules.saas.security.mergeUsersTokenExpiry'
      ) ?? ''
    );
    if (user.prefersEmail) {
      this.email.sendWithTemplate({
        toAddress: `"${user.name}" <${user.prefersEmail.email}>`,
        template: {
          'users/merge-request': {
            userName: user.name,
            link: `${this.configService.get<string>(
              'modules.app.frontendUrl'
            )}/auth/link/merge-accounts?token=${this.tokensService.signJwt(
              MERGE_ACCOUNTS_TOKEN,
              {baseUserId: userId, mergeUserId: user.id},
              `${minutes}m`
            )}`,
            linkValidMinutes: minutes,
          },
        },
      });
    }

    return {queued: true};
  }

  async uploadProfilePicture(
    id: number,
    file: Express.Multer.File
  ): Promise<Expose<User>> {
    if (file.size > 25000000) throw new Error(FILE_TOO_LARGE);

    const {url, cdnUrl} = await this.s3Service.uploadFile({
      file,
      path: 'profile_picture',
    });
    return this.prisma.user.update({
      where: {id},
      data: {
        profilePictureUrl: cdnUrl ?? url,
      },
    });
  }
}
