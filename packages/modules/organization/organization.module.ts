import {Global, Module} from '@nestjs/common';
import {OrganizationService} from './organization.service';
import {OrganizationController} from './organization.controller';
import {MembershipController} from './membership/membership.controller';
import {MembershipService} from './membership/membership.service';

@Global()
@Module({
  controllers: [OrganizationController, MembershipController],
  providers: [OrganizationService, MembershipService],
  exports: [OrganizationService, MembershipService],
})
export class OrganizationModule {}
