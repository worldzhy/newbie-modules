import {S3Handler} from 'aws-lambda';
import {Database} from '@message-tracker/core/database';
import {S3Service} from '@message-tracker/core/s3';
import moment from 'moment';
import {
  EmailMessageEvent,
  EmailMessageEventCreateInput,
  TextMessageEvent,
  TextMessageEventCreateInput,
} from './interface.js';

export const handler: S3Handler = async event => {
  if (!event.Records || event.Records.length <= 0) {
    return;
  }

  // Initialize database connection
  const db = new Database();
  const s3 = new S3Service();

  // Function to store message events in the database
  const storeEmailMessageEvents = async (
    events: Array<EmailMessageEventCreateInput>
  ) => {
    if (events.length === 0) return;

    for (const event of events) {
      await db.sql`
        INSERT INTO "microservice/message-tracker"."EmailMessageEvent" ${db.sql(
          event
        )}`;
    }
  };

  const storeTextMessageEvents = async (
    events: Array<TextMessageEventCreateInput>
  ) => {
    if (events.length === 0) return;

    for (const event of events) {
      await db.sql`
        INSERT INTO "microservice/message-tracker"."TextMessageEvent" ${db.sql(
          event
        )}`;
    }
  };

  const updateTextMessageFinalStatus = async (params: {
    smsMessageId: string;
    status: string;
    statusDescription: string;
  }) => {
    await db.sql`
      UPDATE "microservice/message-tracker"."TextMessage"
      SET "status" = ${params.status},
          "statusDescription" = ${params.statusDescription}
      WHERE "smsMessageId" = ${params.smsMessageId}
    `;
  };

  // Main processing logic
  try {
    // Fetch the event stream file from S3
    const s3Bucket = event.Records[0].s3.bucket.name;
    const s3Key = decodeURIComponent(
      event.Records[0].s3.object.key.replace(/\+/g, ' ')
    );
    const response = await s3.getObject({bucket: s3Bucket, key: s3Key});
    const eventStreamContent = await response.Body?.transformToString();

    if (!eventStreamContent) {
      throw new Error('Failed to read S3 object content');
    }

    // Split the event stream content into individual events
    const eventStrings = eventStreamContent.split('\n');
    const originalEvents: (EmailMessageEvent | TextMessageEvent)[] = [];
    for (const eventString of eventStrings) {
      if (eventString.length > 0) {
        originalEvents.push(JSON.parse(eventString));
      }
    }

    // Process each original event to extract relevant information
    const emailMessageEvents: Array<EmailMessageEventCreateInput> = [];
    const textMessageEvents: Array<TextMessageEventCreateInput> = [];

    for (const originalEvent of originalEvents) {
      if ('mail' in originalEvent) {
        const mailEvent = Object.fromEntries(
          Object.entries(originalEvent).filter(
            ([key]) => key !== 'mail' && key !== 'eventType'
          )
        );
        emailMessageEvents.push({
          eventType: originalEvent.eventType,
          eventTime: moment(mailEvent.timestamp).toDate(),
          event: mailEvent,
          mail: originalEvent.mail,
          sesMessageId: originalEvent.mail.messageId,
        });
      } else if (originalEvent.eventType.startsWith('TEXT_')) {
        textMessageEvents.push({
          eventType: originalEvent.eventType,
          eventTime: moment(originalEvent.eventTimestamp).toDate(),
          event: originalEvent,
          isFinalEvent: originalEvent.isFinal,
          messageStatus: originalEvent.messageStatus,
          messageStatusDescription: originalEvent.messageStatusDescription,
          smsMessageId: originalEvent.messageId,
        });

        // If this is a final event, update the message status in the database
        if (originalEvent.isFinal) {
          await updateTextMessageFinalStatus({
            smsMessageId: originalEvent.messageId,
            status: originalEvent.messageStatus,
            statusDescription: originalEvent.messageStatusDescription,
          });
        }
      } else {
        console.warn('Unknown event type:', originalEvent.eventType);
        continue;
      }
    }

    // Assign message IDs then store emailMessageEvents
    const sesMessageIds = emailMessageEvents
      .filter(event => event.sesMessageId !== undefined)
      .map(event => event.sesMessageId);
    const emailMessages = await db.sql`
      select "id", "sesMessageId" from "microservice/message-tracker"."EmailMessage"
      where "sesMessageId" in ${db.sql(sesMessageIds)}
    `;
    const emailMessageMap = new Map(
      emailMessages.map(msg => [msg.sesMessageId, msg.id])
    );
    emailMessageEvents.forEach(event => {
      const messageId = emailMessageMap.get(event.sesMessageId);
      if (messageId) {
        event.messageId = messageId;
      }
    });
    await storeEmailMessageEvents(emailMessageEvents);

    // Assign message IDs then store textMessageEvents
    const smsMessageIds = textMessageEvents
      .filter(event => event.smsMessageId !== undefined)
      .map(event => event.smsMessageId);
    const textMessages = await db.sql`
      select "id", "smsMessageId" from "microservice/message-tracker"."TextMessage"
      where "smsMessageId" in ${db.sql(smsMessageIds)}
    `;
    const textMessageMap = new Map(
      textMessages.map(msg => [msg.smsMessageId, msg.id])
    );
    textMessageEvents.forEach(event => {
      const messageId = textMessageMap.get(event.smsMessageId);
      if (messageId) {
        event.messageId = messageId;
      }
    });
    await storeTextMessageEvents(textMessageEvents);
  } catch (error) {
    console.error('Error processing events:', error);
    throw error;
  } finally {
    await db.close();
  }
};
