export interface SendEmailParams {
  toAddress: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailsParams {
  toAddresses: string[];
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailWithTemplateParams {
  toAddress: string;
  template: {
    [EmailTemplate.AuthVerifyEmail]?: {
      userName: string;
      link: string;
      linkValidDays: number;
    };
    [EmailTemplate.AuthVerifyEmailResend]?: {
      userName: string;
      link: string;
      linkValidDays: number;
    };
    [EmailTemplate.AuthVerifySubnet]?: {
      userName: string;
      locationName: string;
      link: string;
      linkValidMinutes: number;
    };
    [EmailTemplate.AuthEnableEmailMfa]?: {
      userName: string;
      code: string;
    };
    [EmailTemplate.AuthLoginLink]?: {
      userName: string;
      link: string;
      linkValidMinutes: number;
    };
    [EmailTemplate.AuthPasswordReset]?: {
      userName: string;
      link: string;
      linkValidMinutes: number;
    };

    [EmailTemplate.AuthUsedBackupCode]?: {
      userName: string;
      locationName: string;
      link: string;
    };
    [EmailTemplate.AuthVerificationCode]?: {
      userName: string;
      code: string;
      codeValidMinutes: number;
    };
    [EmailTemplate.OrganizationsInvitation]?: {
      organizationName: string;
      link: string;
    };
    [EmailTemplate.UsersDeactivated]?: {
      userName: string;
    };
    [EmailTemplate.UsersMergeRequest]?: {
      userName: string;
      link: string;
      linkValidMinutes: number;
    };
    [EmailTemplate.UsersPasswordChanged]?: {
      userName: string;
    };
  };
}

export enum EmailTemplate {
  AuthVerifyEmail = 'auth/verify-email',
  AuthVerifyEmailResend = 'auth/verify-email-resend',
  AuthVerifySubnet = 'auth/verify-subnet',
  AuthEnableEmailMfa = 'auth/enable-email-mfa',
  AuthLoginLink = 'auth/login-link',
  AuthPasswordReset = 'auth/password-reset',
  AuthUsedBackupCode = 'auth/used-backup-code',
  AuthVerificationCode = 'auth/verification-code',
  OrganizationsInvitation = 'organizations/invitation',
  UsersDeactivated = 'users/deactivated',
  UsersMergeRequest = 'users/merge-request',
  UsersPasswordChanged = 'users/password-changed',
}
