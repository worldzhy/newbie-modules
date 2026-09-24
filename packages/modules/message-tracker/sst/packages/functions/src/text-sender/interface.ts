export interface TextMessageCreateInput {
  phoneNumber: string;
  text: string;
  sqsMessageId: string;
  smsMessageId?: string;
  smsMessageStatus?: number;
  smsMessageResponse: {};
  updatedAt: Date;
}
