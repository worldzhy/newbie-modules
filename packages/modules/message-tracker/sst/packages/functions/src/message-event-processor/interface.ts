export interface EmailMessageEvent {
  eventType: string;
  mail: {
    timestamp: string;
    source: string;
    sourceArn: string;
    sendingAccountId: string;
    messageId: string;
    destination: string[];
    headersTruncated: boolean;
    headers: Object[];
    commonHeaders: Object;
    tags: Object;
  };
  open: {};
  click: {};
}

export interface EmailMessageEventCreateInput {
  eventType: string;
  eventTime: Date;
  event: {};
  mail: {};
  sesMessageId: string;
  messageId?: number;
}

export interface TextMessageEvent {
  eventType: string;
  eventVersion: string;
  eventTimestamp: number;
  isFinal: boolean;
  originationPhoneNumber: string;
  destinationPhoneNumber: string;
  isoCountryCode: string;
  messageId: string;
  messageRequestTimestamp: number;
  messageEncoding: string;
  messageType: string;
  messageStatus: string;
  messageStatusDescription: string;
  totalMessageParts: number;
  totalMessagePrice: number;
  totalCarrierFee: number;
  protectConfiguration: {
    protectConfigurationId: string;
    protectStatus: string;
  };
}

export interface TextMessageEventCreateInput {
  eventType: string;
  eventTime: Date;
  event: {};
  isFinalEvent: boolean;
  messageStatus: string;
  messageStatusDescription: string;
  smsMessageId: string;
  messageId?: number;
}
