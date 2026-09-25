import {Controller, Post, Body, UnprocessableEntityException, NotFoundException} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {NO_TOKEN_PROVIDED, EMAIL_NOT_FOUND} from '@devbie/newbie/exceptions/errors.constants';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {TokenService} from '@modules/account/security/token/token.service';
import {TokenSubject} from '@modules/account/security/token/token.constants';
import {NoGuard} from '@modules/account/security/passport/public/public.decorator';

@ApiTags('Account / Auth')
@Controller('auth')
export class SignupEmailVerifyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService
  ) {}

  @Post('signup-email-verify')
  @NoGuard()
  @ApiOperation({summary: 'Verify email after signup via token'})
  @ApiResponse({type: Boolean})
  async approveSubnet(@Body('token') token: string) {
    // [step 1] Verify token
    if (!token) throw new UnprocessableEntityException(NO_TOKEN_PROVIDED);
    const {id} = this.tokenService.verify<{id: number}>({
      token,
      options: {
        subject: TokenSubject.APPROVE_EMAIL_TOKEN,
      },
    });

    if (!id) throw new NotFoundException(EMAIL_NOT_FOUND);

    // [step 2] Setting Email flag
    await this.prisma.email.update({
      where: {id},
      data: {isVerified: true},
    });
    return true;
  }

  /* End */
}
