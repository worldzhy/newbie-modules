export interface SendEmailMessageParams {
  toAddress: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendTextMessageParams {
  phoneNumber: string;
  text: string;
}
