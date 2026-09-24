import {SQSHandler} from 'aws-lambda';
import {Database} from '@message-tracker/core/database';
import {EmailService} from '@message-tracker/core/ses';
import {checkEmailMessageBody, checkTextMessageBody} from '../utils.js';
import {SqsMessageStatus} from './interface.js';

export const handler: SQSHandler = async event => {
  if (!event.Records || event.Records.length <= 0) {
    return;
  }

  // Initialize services
  const db = new Database();
  const email = new EmailService();
  const adminEmailAddress = process.env.ADMIN_EMAIL_ADDRESS!;

  // Function to store SQS message in the database
  const updateEmailMessages = async (sqsMessageIds: string[]) => {
    await db.sql`
        update "microservice/message-tracker"."EmailMessage"
        set "sqsMessageStatus" = ${SqsMessageStatus.FAILED}
        where "sqsMessageId" in ${db.sql(sqsMessageIds)}
    `;
  };

  const updateTextMessages = async (sqsMessageIds: string[]) => {
    await db.sql`
        update "microservice/message-tracker"."TextMessage"
        set "sqsMessageStatus" = ${SqsMessageStatus.FAILED}
        where "sqsMessageId" in ${db.sql(sqsMessageIds)}
    `;
  };

  try {
    // Collect failed messages
    const failedEmailMessages: {
      sqsMessageId: string;
      toAddress: string;
      subject: string;
      text: string;
    }[] = [];
    const failedTextMessages: {
      sqsMessageId: string;
      phoneNumber: string;
      text: string;
    }[] = [];

    for (const sqsRecord of event.Records) {
      const sqsMessageId = sqsRecord.messageId;
      const sqsMessageBody = JSON.parse(sqsRecord.body);

      // Validate received message body
      if (checkEmailMessageBody(sqsMessageBody)) {
        failedEmailMessages.push({
          sqsMessageId,
          toAddress: sqsMessageBody.toAddress,
          subject: sqsMessageBody.subject,
          text: sqsMessageBody.text,
        });
      } else if (checkTextMessageBody(sqsMessageBody)) {
        failedTextMessages.push({
          sqsMessageId,
          phoneNumber: sqsMessageBody.phoneNumber,
          text: sqsMessageBody.text,
        });
      } else {
        console.warn(`Invalid message body: ${sqsRecord.body}`);
        continue;
      }
    }

    // Update messages status in database
    await updateEmailMessages(failedEmailMessages.map(msg => msg.sqsMessageId));
    await updateTextMessages(failedTextMessages.map(msg => msg.sqsMessageId));

    // If there are failed messages, send an email with the list
    if (failedEmailMessages.length > 0 || failedTextMessages.length > 0) {
      const content = generateAlarmEmailHTML(
        failedEmailMessages,
        failedTextMessages
      );
      const emailParams = {
        toAddress: adminEmailAddress,
        subject: 'Failed Messages',
        html: content,
        text: content,
      };

      await email.sendEmail(emailParams);
    }
  } catch (error) {
    console.error('Error processing alarm messages:', error);
    throw error;
  } finally {
    await db.close();
  }
};

// 生成告警邮件的 HTML 内容
function generateAlarmEmailHTML(
  emailMessages: Array<{
    toAddress: string;
    subject: string;
    text: string;
  }>,
  textMessages: Array<{
    phoneNumber: string;
    text: string;
  }>
): string {
  let htmlStr = `
    <!doctype html>
    <html>
        <head>
            <title>Send Failed List</title>
            <meta charset="utf-8" />
        </head>
        <body>
        <h2>Failed Email Messages</h2>    
        <table>
                <tr>
                    <td>To Address</td>
                    <td>Subject</td>
                    <td>Text</td>
                </tr> 
    `;
  for (const message of emailMessages) {
    htmlStr += `
            <tr>
                <td>${message.toAddress}</td>
                <td>${message.subject}</td>
                <td><pre>${message.text}</pre></td>
            </tr>
        `;
  }
  htmlStr += `
            </table>
            <h2>Failed Text Messages</h2>
            <table>
                <tr>
                    <td>Phone Number</td>
                    <td>Text</td>
                </tr>
    `;
  for (const message of textMessages) {
    htmlStr += `
            <tr>
                <td>${message.phoneNumber}</td>
                <td><pre>${message.text}</pre></td>
            </tr>
        `;
  }
  htmlStr += `
            </table>
        </body>
    </html>
    `;

  return htmlStr;
}
