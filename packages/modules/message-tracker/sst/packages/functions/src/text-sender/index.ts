import {SQSHandler} from 'aws-lambda';
import {Database} from '@message-tracker/core/database';
import {
  TextMessageService,
  SendTextMessageParams,
} from '@message-tracker/core/sms';
import {TextMessageCreateInput} from './interface.js';
import {checkTextMessageBody} from '../utils.js';

export const handler: SQSHandler = async event => {
  if (!event.Records || event.Records.length <= 0) {
    return;
  }

  // Initialize services
  const db = new Database();
  const sms = new TextMessageService();
  const storeMessage = async (params: TextMessageCreateInput) => {
    await db.sql`INSERT INTO "microservice/message-tracker"."TextMessage" ${db.sql(
      params
    )}`;
  };

  // Process each SQS record
  try {
    for (const sqsRecord of event.Records) {
      const sqsMessageBody = JSON.parse(
        sqsRecord.body
      ) as SendTextMessageParams;

      // Validate received message body
      if (!checkTextMessageBody(sqsMessageBody)) {
        continue;
      }

      // Send message
      const response = await sms.sendText(sqsMessageBody);

      // Store response
      await storeMessage({
        phoneNumber: sqsMessageBody.phoneNumber,
        text: sqsMessageBody.text,
        sqsMessageId: sqsRecord.messageId,
        smsMessageId: response.MessageId,
        smsMessageStatus: response.$metadata.httpStatusCode,
        smsMessageResponse: response.$metadata,
        updatedAt: new Date(),
      });

      // Delay for SMS sending
      await sleep(1000);
    }
  } catch (error) {
    console.error('Error processing messages:', error);
    throw error;
  } finally {
    await db.close();
  }
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
