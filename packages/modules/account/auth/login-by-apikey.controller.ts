import {Controller, Post} from '@nestjs/common';
import {ApiBody, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {GuardByApiKey} from '@microservices/account/security/passport/api-key/api-key.decorator';
import {TokenService} from '@microservices/account/security/token/token.service';
import {LoginByApiKeyRequestDto} from '@microservices/account/auth/auth.dto';

@ApiTags('Account / Auth')
@Controller('auth')
export class LoginByApiKeyController {
  constructor(private readonly tokenService: TokenService) {}

  /**
   * After a user is verified by auth guard, this 'login' function returns
   * a JWT to declare the user is authenticated.
   *
   * The 'account' parameter supports:
   * [1] account
   * [2] email
   * [3] phone
   */
  @Post('login-by-apikey')
  @GuardByApiKey()
  @ApiOperation({summary: 'Login with API key and secret'})
  @ApiResponse({type: String})
  @ApiBody({
    type: LoginByApiKeyRequestDto,
    description: "The request body should contain 'key' and 'secret' attributes.",
    examples: {
      a: {
        summary: '1. Log in with api key and secret',
        value: {
          key: 'AKWARNPWJFRQ9NFGOH44',
          secret: '1Ks/pC7H9C19+nqbU75sLQcYi2KZsWGJorYJQ8mY',
        },
      },
    },
  })
  async loginByApiKey() {
    // [step 1] Disable active JSON web token if existed.
    // await this.tokenService.invalidate(body.key);
    // [step 2] Generate new tokens.
    // return await this.tokenService.generate(body.key);
  }

  /* End */
}
