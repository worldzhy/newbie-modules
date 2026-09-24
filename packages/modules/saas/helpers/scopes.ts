/** Scopes for a user */
export const userScopes = {
  'user-{userId}:write-api-key-*': 'Create and update API keys',
  'user-{userId}:read-api-key-*': 'Read API keys',
  'user-{userId}:delete-api-key-*': 'Delete API keys',
  'user-{userId}:read-api-key-logs-*': 'Read API key logs',
  'user-{userId}:read-approved-subnet-*': 'Read approved subnets',
  'user-{userId}:delete-approved-subnet-*': 'Unapproved subnet',
  'user-{userId}:write-email-*': 'Create and update emails',
  'user-{userId}:read-email-*': 'Read emails',
  'user-{userId}:delete-email-*': 'Delete emails',
  'user-{userId}:write-membership-*': 'Create teams',
  'user-{userId}:read-membership-*': 'Read memberships',
  'user-{userId}:delete-membership-*': 'Delete memberships',
  'user-{userId}:delete-mfa-*': 'Disable MFA',
  'user-{userId}:write-mfa-regenerate': 'Regenerate MFA backup codes',
  'user-{userId}:write-mfa-totp': 'Enable TOTP-based MFA',
  'user-{userId}:write-mfa-sms': 'Enable SMS-based MFA',
  'user-{userId}:write-mfa-email': 'Enable email-based MFA',
  'user-{userId}:read-session-*': 'Read sessions',
  'user-{userId}:delete-session-*': 'Log out of sessions',
  'user-{userId}:read-info': 'Read user details',
  'user-{userId}:write-info': 'Update user details',
  'user-{userId}:deactivate': 'Delete user account',
  'user-{userId}:merge': 'Merge two users',
  'user-{userId}:read-audit-log-*': 'Read audit log',
};

/** Scopes for a team owner */
export const teamOwnerScopes = {
  'team-{teamId}:write-api-key-*': 'Create and update API keys',
  'team-{teamId}:read-api-key-*': 'Read API keys',
  'team-{teamId}:delete-api-key-*': 'Delete API keys',
  'team-{teamId}:read-api-key-logs-*': 'Read API key logs',
  'team-{teamId}:read-audit-log-*': 'Read audit log',
  'team-{teamId}:write-domain-*': 'Create and update domains',
  'team-{teamId}:read-domain-*': 'Read domains',
  'team-{teamId}:delete-domain-*': 'Delete domains',
  'team-{teamId}:read-info': 'Read apartment details',
  'team-{teamId}:write-info': 'Update apartment details',
  'team-{teamId}:delete': 'Delete apartment',
  'team-{teamId}:write-membership-*': 'Create and update memberships',
  'team-{teamId}:read-membership-*': 'Read memberships',
  'team-{teamId}:delete-membership-*': 'Delete memberships',
  'team-{teamId}:write-billing': 'Create and update billing details',
  'team-{teamId}:read-billing': 'Read billing details',
  'team-{teamId}:delete-billing': 'Delete billing details',
  'team-{teamId}:read-invoice-*': 'Read invoices',
  'team-{teamId}:write-source-*': 'Create and update payment methods',
  'team-{teamId}:read-source-*': 'Read payment methods',
  'team-{teamId}:delete-source-*': 'Delete payment methods',
  'team-{teamId}:write-subscription-*': 'Create and update subscriptions',
  'team-{teamId}:read-subscription-*': 'Read subscriptions',
  'team-{teamId}:delete-subscription-*': 'Delete subscriptions',
  'team-{teamId}:write-webhook-*': 'Create and update webhooks',
  'team-{teamId}:read-webhook-*': 'Read webhooks',
  'team-{teamId}:delete-webhook-*': 'Delete webhooks',
};

/**
 * Scopes for a team admin
 * Admins can do everything except deleting the team or removing members
 */
export const teamAdminScopes = {
  'team-{teamId}:write-api-key-*': 'Create and update API keys',
  'team-{teamId}:read-api-key-*': 'Read API keys',
  'team-{teamId}:delete-api-key-*': 'Delete API keys',
  'team-{teamId}:read-api-key-logs-*': 'Read API key logs',
  'team-{teamId}:read-audit-log-*': 'Read audit log',
  'team-{teamId}:write-domain-*': 'Create and update domains',
  'team-{teamId}:read-domain-*': 'Read domains',
  'team-{teamId}:delete-domain-*': 'Delete domains',
  'team-{teamId}:read-info': 'Read apartment details',
  'team-{teamId}:write-info': 'Update apartment details',
  'team-{teamId}:write-membership-*': 'Create and update memberships',
  'team-{teamId}:read-membership-*': 'Read memberships',
  'team-{teamId}:write-billing': 'Create and update billing details',
  'team-{teamId}:read-billing': 'Read billing details',
  'team-{teamId}:delete-billing': 'Delete billing details',
  'team-{teamId}:read-invoice-*': 'Read invoices',
  'team-{teamId}:write-source-*': 'Create and update payment methods',
  'team-{teamId}:read-source-*': 'Read payment methods',
  'team-{teamId}:delete-source-*': 'Delete payment methods',
  'team-{teamId}:write-subscription-*': 'Create and update subscriptions',
  'team-{teamId}:read-subscription-*': 'Read subscriptions',
  'team-{teamId}:delete-subscription-*': 'Delete subscriptions',
  'team-{teamId}:write-webhook-*': 'Create and update webhooks',
  'team-{teamId}:read-webhook-*': 'Read webhooks',
  'team-{teamId}:delete-webhook-*': 'Delete webhooks',
};

/**
 * Scopes for a team member
 * Members have readonly access
 */
export const teamMemberScopes = {
  'team-{teamId}:read-api-key-*': 'Read API keys',
  'team-{teamId}:read-api-key-logs-*': 'Read API key logs',
  'team-{teamId}:read-audit-log-*': 'Read audit log',
  'team-{teamId}:read-domain-*': 'Read domains',
  'team-{teamId}:read-info': 'Read apartment details',
  'team-{teamId}:read-membership-*': 'Read memberships',
  'team-{teamId}:read-billing': 'Read billing details',
  'team-{teamId}:read-invoice-*': 'Read invoices',
  'team-{teamId}:read-source-*': 'Read payment methods',
  'team-{teamId}:read-subscription-*': 'Read subscriptions',
  'team-{teamId}:read-webhook-*': 'Read webhooks',
};

/** Customized scopes for a user */
export const userScopesCustomized = {
  'application-{userId}:message-bot-api-key-*': 'Message Bot',
};

/** Customized scopes for a team member */
export const teamMemberScopesCustomized = {
  'application-{teamId}:message-bot-api-key-*': 'Message Bot',
};
