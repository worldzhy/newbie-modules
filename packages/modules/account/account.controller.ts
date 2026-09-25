import {BadRequestException, Body, Controller, Get, Patch, Post, Req} from '@nestjs/common';
import {ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {Request} from 'express';
import {Prisma, VerificationCodeUse} from '@generated/prisma/client';
import {NewbieException, NewbieExceptionType} from '@devbie/newbie/exceptions/newbie.exception';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {compareHash} from '@devbie/newbie/utilities/common.util';
import {AccountService} from '@modules/account/account.service';
import {verifyEmail, verifyPhone} from '@modules/account/helpers/validator';
import {VerificationCodeService} from '@modules/account/modules/verification-code/verification-code.service';
import {NoGuard} from '@modules/account/security/passport/public/public.decorator';
import {
  ChangePasswordDto,
  GetCurrentUserResponseDto,
  PasswordChangeResponseDto,
  ResetPasswordDto,
} from '@modules/account/account.dto';

@ApiTags('Account')
@Controller('account')
export class AccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: AccountService,
    private readonly verificationCodeService: VerificationCodeService
  ) {}

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({summary: 'Get current user information'})
  @ApiResponse({type: GetCurrentUserResponseDto})
  async getCurrentUser(@Req() request: Request) {
    return await this.accountService.me(request);
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({summary: 'Update current user information'})
  @ApiResponse({type: GetCurrentUserResponseDto})
  async updateCurrentUser(@Req() request: Request, @Body() body: Prisma.UserUpdateInput) {
    return await this.accountService.updateMe(request, body);
  }

  @ApiBearerAuth()
  @Post('change-password')
  @ApiOperation({summary: 'Change the password of the current user'})
  @ApiResponse({type: PasswordChangeResponseDto})
  async changePassword(@Body() body: ChangePasswordDto) {
    // [step 1] Guard statement.
    if (!('currentPassword' in body) || !('newPassword' in body)) {
      throw new BadRequestException("Please carry 'currentPassword' and 'newPassword' in the request body.");
    }

    // [step 2] Verify if the new password is same with the current password.
    if (body.currentPassword.trim() === body.newPassword.trim()) {
      throw new BadRequestException('The new password is same with the current password.');
    }

    // [step 3] Verify the current password.
    const user = await this.prisma.user.findUniqueOrThrow({
      where: {id: body.userId},
    });
    const match = await compareHash(body.currentPassword, user.password);
    if (match === false) {
      throw new BadRequestException('The current password is incorrect.');
    }

    // [step 4] Change password.
    return await this.prisma.user.update({
      where: {id: body.userId},
      data: {password: body.newPassword},
      select: {id: true, email: true, phone: true},
    });
  }

  @NoGuard()
  @Post('reset-password')
  @ApiOperation({summary: 'Reset password with email or phone verification code'})
  @ApiResponse({type: PasswordChangeResponseDto})
  @ApiBody({
    type: ResetPasswordDto,
    description: '',
    examples: {
      a: {
        summary: 'Reset password with email',
        value: {
          email: 'henry@inceptionpad.com',
          verificationCode: '283749',
          newPassword: '',
        },
      },
      b: {
        summary: 'Reset password with phone',
        value: {
          phone: '13260000789',
          verificationCode: '283749',
          newPassword: '',
        },
      },
    },
  })
  async resetPassword(
    @Body()
    body: ResetPasswordDto
  ) {
    if (body.email && verifyEmail(body.email)) {
      // Only a code issued for resetting password can complete the reset.
      if (
        await this.verificationCodeService.validateForEmail(
          body.verificationCode,
          body.email,
          VerificationCodeUse.RESET_PASSWORD
        )
      ) {
        return await this.prisma.user.update({
          where: {email: body.email.toLowerCase()},
          data: {password: body.newPassword},
          select: {id: true, email: true, phone: true},
        });
      } else {
        throw new NewbieException(NewbieExceptionType.ResetPassword_InvalidCode);
      }
    } else if (body.phone && verifyPhone(body.phone)) {
      // Only a code issued for resetting password can complete the reset.
      if (
        await this.verificationCodeService.validateForPhone(
          body.verificationCode,
          body.phone,
          VerificationCodeUse.RESET_PASSWORD
        )
      ) {
        return await this.prisma.user.update({
          where: {phone: body.phone},
          data: {password: body.newPassword},
          select: {id: true, email: true, phone: true},
        });
      } else {
        throw new NewbieException(NewbieExceptionType.ResetPassword_InvalidCode);
      }
    }

    throw new NewbieException(NewbieExceptionType.ResetPassword_WrongInput);
  }

  /* End */
}
