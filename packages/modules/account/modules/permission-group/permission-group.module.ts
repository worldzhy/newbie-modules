import { Global, Module } from "@nestjs/common";
import { PermissionGroupController } from "./permission-group.controller";

@Global()
@Module({
  controllers: [PermissionGroupController],
})
export class PermissionGroupModule {}
