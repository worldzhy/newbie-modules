import {Module} from '@nestjs/common';
import {APP_GUARD, APP_INTERCEPTOR} from '@nestjs/core';
import {ScheduleModule} from '@nestjs/schedule';
import {AuditLogger} from './interceptors/audit-log.interceptor';
import {RateLimitInterceptor} from './interceptors/rate-limit.interceptor';
import {ApiKeysModule} from './modules/api-keys/api-keys.module';
import {ApprovedSubnetsModule} from './modules/approved-subnets/approved-subnets.module';
import {AuditLogsModule} from './modules/audit-logs/audit-logs.module';
import {AuthModule} from './modules/auth/auth.module';
import {ScopesGuard} from './modules/auth/guards/scope.guard';
import {SaasAuthGuard} from './modules/auth/guards/auth.guard';
import {GoogleAuthGuard} from './modules/auth/guards/google-auth.guard';
import {DomainsModule} from './modules/domains/domains.module';
import {EmailsModule} from './modules/emails/emails.module';
import {TeamsModule} from './modules/teams/teams.module';
import {MembershipsModule} from './modules/memberships/memberships.module';
import {MultiFactorAuthenticationModule} from './modules/multi-factor-authentication/multi-factor-authentication.module';
import {SessionsModule} from './modules/sessions/sessions.module';
import {StripeModule} from './modules/stripe/stripe.module';
import {UsersModule} from './modules/users/users.module';
import {WebhooksModule} from './modules/webhooks/webhooks.module';
import {DnsModule} from './providers/dns/dns.module';
import {GeolocationModule} from './providers/geolocation/geolocation.module';
import {GoogleMapsModule} from './providers/google-maps/google-maps.module';
import {TasksModule} from './providers/tasks/tasks.module';
import {MetricsModule} from './modules/metrics/metrics.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TasksModule,
    UsersModule,
    AuthModule,
    SessionsModule,
    EmailsModule,
    TeamsModule,
    MultiFactorAuthenticationModule,
    ApiKeysModule,
    ApprovedSubnetsModule,
    DomainsModule,
    DnsModule,
    GeolocationModule,
    MembershipsModule,
    StripeModule,
    AuditLogsModule,
    WebhooksModule,
    GoogleMapsModule,
    MetricsModule,
  ],
  providers: [
    GoogleAuthGuard,
    {provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor},
    {provide: APP_GUARD, useClass: SaasAuthGuard},
    {provide: APP_GUARD, useClass: ScopesGuard},
    {provide: APP_INTERCEPTOR, useClass: AuditLogger},
  ],
})
export class SaasModule {}
