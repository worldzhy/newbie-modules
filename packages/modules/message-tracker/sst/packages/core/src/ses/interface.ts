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
    [key: string]: any;
  };
}

export interface EmailServiceConfig {
  accessKeyId?: string;
  secretAccessKey?: string;
  region: string;
  configurationSetName?: string;
  fromAddress: string;
}
