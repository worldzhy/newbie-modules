export interface EmailMessageCreateInput {
  toAddress: string;
  subject: string;
  html: string;
  text: string;
  sqsMessageId: string;
  sesMessageId?: string;
  sesMessageStatus?: number;
  sesMessageResponse: {};
  updatedAt: Date;
}
