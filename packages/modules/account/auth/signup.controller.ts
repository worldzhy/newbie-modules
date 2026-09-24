import {Controller, Post, Body, Ip} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {AuthService} from '@microservices/account/auth/auth.service';
import {SignUpDto} from '@microservices/account/auth/auth.dto';
import {NoGuard} from '@microservices/account/security/passport/public/public.decorator';

@ApiTags('Account / Auth')
@Controller('auth')
export class SignupController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Sign up by:
   * [1] email: password is optional
   * [2] phone: password is optional
   *
   * [Constraint] 'password' is required if neither email nor phone is provided.
   */
  @NoGuard()
  @Post('signup')
  @ApiOperation({summary: 'Sign up a new user'})
  @ApiResponse({type: String})
  async signup(@Ip() ipAddress: string, @Body() body: SignUpDto) {
    await this.authService.signup({userData: body, ipAddress});
  }

  /* End */
}
