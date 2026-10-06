export interface SendTextMessageParams {
  phoneNumber: string;
  text: string;
}

export interface TextMessageBody {
  phoneNumber: string;
  content: string;
  messageType?: string;
  senderId?: string;
}

export interface TextServiceConfig {
  region: string;
  configurationSetName?: string;
}
