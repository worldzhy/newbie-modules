import { Global, Module } from "@nestjs/common";
import { BitbucketService } from "./bitbucket.service";

@Global()
@Module({
  providers: [BitbucketService],
  exports: [BitbucketService],
})
export class BitbucketModule {}
