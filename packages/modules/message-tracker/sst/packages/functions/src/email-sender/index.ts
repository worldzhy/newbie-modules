import {SQSHandler} from 'aws-lambda';
import {Database} from '@message-tracker/core/database';
import {EmailService, SendEmailParams} from '@message-tracker/core/ses';
import {EmailMessageCreateInput} from './interface.js';
import {checkEmailMessageBody} from '../utils.js';

export const handler: SQSHandler = async event => {
  if (!event.Records || event.Records.length <= 0) {
    return;
  }

  // Initialize services
  const db = new Database();
  const email = new EmailService();
  const storeMessage = async (params: EmailMessageCreateInput) => {
    await db.sql`INSERT INTO "microservice/message-tracker"."EmailMessage" ${db.sql(
      params
    )}`;
  };

  // Process each SQS record
  try {
    for (const sqsRecord of event.Records) {
      const sqsMessageBody = JSON.parse(sqsRecord.body) as SendEmailParams;

      // Validate received message body
      if (!checkEmailMessageBody(sqsMessageBody)) {
        continue;
      }

      // Send message
      const response = await email.sendEmail(sqsMessageBody!);

      // Store response
      await storeMessage({
        toAddress: sqsMessageBody.toAddress,
        subject: sqsMessageBody.subject,
        html: sqsMessageBody.html,
        text: sqsMessageBody.text,
        sqsMessageId: sqsRecord.messageId,
        sesMessageId: response.MessageId,
        sesMessageStatus: response.$metadata.httpStatusCode,
        sesMessageResponse: response.$metadata,
        updatedAt: new Date(),
      });

      // Delay for email sending
      await sleep(100);
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
