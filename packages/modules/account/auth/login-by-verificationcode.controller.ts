import {Body, Controller, Headers, Ip, NotFoundException, Post, Req, Res} from '@nestjs/common';
import {ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {VerificationCodeUse} from '@generated/prisma/client';
import {Response} from 'express';
import {NewbieException, NewbieExceptionType} from '@devbie/newbie/exceptions/newbie.exception';
import {UserRequest} from '@microservices/account/account.interface';
import {AuthService} from '@microservices/account/auth/auth.service';
import {verifyEmail, verifyPhone} from '@microservices/account/helpers/validator';
import {NoGuard} from '@microservices/account/security/passport/public/public.decorator';
import {GuardByVerificationCode} from '@microservices/account/security/passport/verification-code/verification-code.decorator';
import {UserService} from '@microservices/account/modules/user/user.service';
import {VerificationCodeService} from '@microservices/account/modules/verification-code/verification-code.service';
import {AwsSesService} from '@microservices/aws-ses/aws-ses.service';
import {AwsSmsService} from '@microservices/aws-sms/aws-sms.service';
import {
  LoginByPasswordResponseDto,
  LoginByVerificationCodeRequestDto,
  SendVerificationCodeRequestDto,
  SendVerificationCodeResponseDto,
} from '@microservices/account/auth/auth.dto';

@ApiTags('Account / Auth')
@Controller('auth')
export class LoginByVerificationCodeController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly ses: AwsSesService,
    private readonly sms: AwsSmsService
  ) {}

  // *
  // * Won't send message if the same email apply again within 1 minute.
  // *
  @NoGuard()
  @Post('send-verification-code')
  @ApiOperation({summary: 'Send verification code to email or phone'})
  @ApiResponse({type: SendVerificationCodeResponseDto})
  @ApiBody({
    type: SendVerificationCodeRequestDto,
    description: '',
    examples: {
      a: {
        summary: 'Reset password',
        value: {
          email: 'henry@inceptionpad.com',
          use: VerificationCodeUse.RESET_PASSWORD,
        },
      },
      b: {
        summary: 'Email login',
        value: {
          email: 'henry@inceptionpad.com',
          use: VerificationCodeUse.LOGIN_BY_EMAIL,
        },
      },
      c: {
        summary: 'Phone login',
        value: {
          phone: '13260000789',
          use: VerificationCodeUse.LOGIN_BY_PHONE,
        },
      },
    },
  })
  async sendVerificationCode(@Body() body: SendVerificationCodeRequestDto): Promise<{secondsOfCountdown: number}> {
    if (body.email && verifyEmail(body.email)) {
      // [step 1] Check if the account exists.
      const user = await this.userService.findByAccount(body.email);
      if (!user) {
        throw new NotFoundException('Your account is not registered.');
      }

      // [step 2] Generate verification code.
      const verificationCode = await this.verificationCodeService.generateForEmail(body.email, body.use);

      // [step 3] Send verification code.
      await this.ses.sendEmailWithTemplate({
        toAddress: body.email,
        template: {
          'auth/verification-code': {
            userName: 'Dear',
            code: verificationCode.code,
            // Follow the configured validity so the email never claims a wrong window.
            codeValidMinutes: this.verificationCodeService.timeoutMinutes,
          },
        },
      });
    } else if (body.phone && verifyPhone(body.phone)) {
      // [step 1] Check if the account exists.
      const user = await this.userService.findByAccount(body.phone);
      if (!user) {
        throw new NotFoundException('Your account is not registered.');
      }

      // [step 2] Generate verification code.
      const verificationCode = await this.verificationCodeService.generateForPhone(body.phone, body.use);

      // [step 3] Send verification code.
      await this.sms.sendText({
        phoneNumber: body.phone,
        text: verificationCode.code,
      });
    } else {
      throw new NewbieException(NewbieExceptionType.ResetPassword_WrongInput);
    }

    // Countdown before the user can request a new code (the resend cooldown window).
    return {
      secondsOfCountdown: this.verificationCodeService.resendMinutes * 60,
    };
  }

  /**
   * After a user is verified by auth guard, this 'login' function returns
   * a JWT to declare the user is authenticated.
   *
   * The 'account' parameter supports:
   * [1] email
   * [2] phone
   */
  @GuardByVerificationCode()
  @Post('login-by-verification-code')
  @ApiBearerAuth()
  @ApiOperation({summary: 'Login with verification code'})
  @ApiResponse({type: LoginByPasswordResponseDto})
  @ApiBody({
    type: LoginByVerificationCodeRequestDto,
    description:
      "The request body must contain 'account' and 'verificationCode' attributes. The 'account' accepts email or phone.",
    examples: {
      a: {
        summary: '1. Log in with email',
        value: {
          account: 'henry@inceptionpad.com',
          verificationCode: '123456',
        },
      },
      b: {
        summary: '2. Log in with phone',
        value: {
          account: '13960068008',
          verificationCode: '123456',
        },
      },
    },
  })
  async loginByVerificationCode(
    @Ip() ipAddress: string,
    @Headers('User-Agent') userAgent: string,
    @Body() body: LoginByVerificationCodeRequestDto,
    @Req() request: UserRequest,
    @Res({passthrough: true}) response: Response
  ): Promise<{token: string; tokenExpiresInSeconds: number}> {
    return await this.authService.login({
      ipAddress,
      userAgent,
      userId: request.user.userId,
      response,
    });
  }

  /* End */
}
