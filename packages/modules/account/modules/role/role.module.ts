import { Global, Module } from "@nestjs/common";
import { RoleController } from "./role.controller";

@Global()
@Module({
  controllers: [RoleController],
})
export class RoleModule {}
