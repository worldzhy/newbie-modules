import { Controller, NotImplementedException, Post } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { GuardByApiKey } from "@modules/account/security/passport/api-key/api-key.decorator";

@ApiTags("Account / Auth")
@Controller("auth")
export class LoginByApiKeyController {
  /**
   * Token issuance for API keys is not implemented yet. The guard has already
   * authenticated the key/secret pair, so clients should keep calling the API
   * with the key and secret headers directly.
   */
  @Post("login-by-apikey")
  @GuardByApiKey()
  @ApiOperation({ summary: "Login with API key and secret (not implemented)" })
  @ApiHeader({ name: "key", required: true })
  @ApiHeader({ name: "secret", required: true })
  async loginByApiKey() {
    throw new NotImplementedException("Login by API key is not implemented yet.");
  }

  /* End */
}
