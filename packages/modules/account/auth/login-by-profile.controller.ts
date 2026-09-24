import {Controller, Post, Res, Ip, Headers, Req} from '@nestjs/common';
import {ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {Response} from 'express';
import {UserRequest} from '@microservices/account/account.interface';
import {AuthService} from '@microservices/account/auth/auth.service';
import {GuardByProfile} from '@microservices/account/security/passport/profile/profile.decorator';
import {GuardByUuid} from '@microservices/account/security/passport/uuid/uuid.decorator';
import {
  LoginByPasswordResponseDto,
  LoginByProfileRequestDto,
  LoginByUuidRequestDto,
} from '@microservices/account/auth/auth.dto';

@ApiTags('Account / Auth')
@Controller('auth')
export class LoginByProfileController {
  constructor(private readonly authService: AuthService) {}

  /**
   * After a user is verified by auth guard, this 'login' function returns
   * a JWT to declare the user is authenticated.
   */
  @Post('login-by-profile')
  @GuardByProfile()
  @ApiBearerAuth()
  @ApiOperation({summary: 'Login with user profile information'})
  @ApiResponse({type: LoginByPasswordResponseDto})
  @ApiBody({
    type: LoginByProfileRequestDto,
    description:
      "The request body should contain 'firstName', 'middleName', 'lastName' and 'dateOfBirth' attributes. The 'suffix' is optional.",
    examples: {
      a: {
        summary: '1. UserProfile with suffix',
        value: {
          firstName: 'Robert',
          middleName: 'William',
          lastName: 'Smith',
          suffix: 'PhD',
          dateOfBirth: '2019-05-27',
        },
      },
      b: {
        summary: '2. UserProfile without suffix',
        value: {
          firstName: 'Mary',
          middleName: 'Rose',
          lastName: 'Johnson',
          dateOfBirth: '2019-05-27',
        },
      },
    },
  })
  async loginByUserProfile(
    @Ip() ipAddress: string,
    @Headers('User-Agent') userAgent: string,
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

  @Post('login-by-uuid')
  @GuardByUuid()
  @ApiBearerAuth()
  @ApiOperation({summary: 'Login with UUID'})
  @ApiResponse({type: LoginByPasswordResponseDto})
  @ApiBody({
    type: LoginByUuidRequestDto,
    description: 'Verfiy account by uuid.',
    examples: {
      a: {
        summary: '1. Valid uuid',
        value: {
          uuid: 'e51b4030-39ab-4420-bc87-2907acae824c',
        },
      },
    },
  })
  async loginByUuid(
    @Ip() ipAddress: string,
    @Headers('User-Agent') userAgent: string,
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
