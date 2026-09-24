import {
  Controller,
  Post,
  Body,
  Res,
  Ip,
  Headers,
  UnprocessableEntityException,
  NotFoundException,
} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {Response} from 'express';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {NO_TOKEN_PROVIDED, USER_NOT_FOUND} from '@devbie/newbie/exceptions/errors.constants';
import {AuthService} from '@microservices/account/auth/auth.service';
import {ApprovedSubnetService} from '@microservices/account/modules/approved-subnet/approved-subnet.service';
import {TokenService} from '@microservices/account/security/token/token.service';
import {TokenSubject} from '@microservices/account/security/token/token.constants';
import {NoGuard} from '@microservices/account/security/passport/public/public.decorator';
import {LoginByPasswordResponseDto} from '@microservices/account/auth/auth.dto';

@ApiTags('Account / Auth')
@Controller('auth')
export class LoginByApprovedSubnetController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly approvedSubnetService: ApprovedSubnetService,
    private readonly tokenService: TokenService
  ) {}

  @Post('login-by-approve-subnet')
  @NoGuard()
  @ApiOperation({summary: 'Login by approving a new subnet via token'})
  @ApiResponse({type: LoginByPasswordResponseDto})
  async approveSubnet(
    @Ip() ipAddress: string,
    @Headers('User-Agent') userAgent: string,
    @Body('token') token: string,
    @Res({passthrough: true}) response: Response
  ) {
    // [step 1] Verify token
    if (!token) throw new UnprocessableEntityException(NO_TOKEN_PROVIDED);
    const {userId} = this.tokenService.verify<{userId: string}>({
      token,
      options: {
        subject: TokenSubject.APPROVE_SUBNET_TOKEN,
      },
    });

    const user = await this.prisma.user.findUnique({where: {id: userId}});
    if (!user) throw new NotFoundException(USER_NOT_FOUND);

    // [step 2] Approve new subnet
    await this.approvedSubnetService.approveNewSubnet(userId, ipAddress);

    // [step 3] Log in
    return await this.authService.login({
      ipAddress,
      userAgent,
      userId,
      response,
    });
  }

  /* End */
}
