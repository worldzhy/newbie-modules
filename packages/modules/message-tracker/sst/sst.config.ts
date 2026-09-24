import {Function} from 'sst/constructs';

export default {
  config(_input) {
    return {
      name: 'message-tracker',
      region: 'us-east-1',
    };
  },
  stacks(app) {
    app.stack(function Stack({stack}) {
      // 环境变量配置
      const environment = {
        DB_HOST: process.env.DB_HOST || 'localhost',
        DB_PORT: process.env.DB_PORT || '5432',
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PWD: process.env.DB_PWD || 'password',
        DB_NAME: process.env.DB_NAME || 'message_tracker',
        DB_SSL: process.env.DB_SSL || 'false',

        AWS_S3_REGION: process.env.AWS_S3_REGION,
        AWS_S3_ACCESS_KEY_ID: process.env.AWS_S3_ACCESS_KEY_ID,
        AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY,

        AWS_SES_REGION: process.env.AWS_SES_REGION,
        AWS_SES_ACCESS_KEY_ID: process.env.AWS_SES_ACCESS_KEY_ID,
        AWS_SES_SECRET_ACCESS_KEY: process.env.AWS_SES_SECRET_ACCESS_KEY,
        AWS_SES_CONFIGURATION_SET_NAME:
          process.env.AWS_SES_CONFIGURATION_SET_NAME || '',
        FROM_EMAIL_ADDRESS: process.env.FROM_EMAIL_ADDRESS!,
        ADMIN_EMAIL_ADDRESS: process.env.ADMIN_EMAIL_ADDRESS || '',

        AWS_SMS_REGION: process.env.AWS_SMS_REGION,
        AWS_SMS_ACCESS_KEY_ID: process.env.AWS_SMS_ACCESS_KEY_ID,
        AWS_SMS_SECRET_ACCESS_KEY: process.env.AWS_SMS_SECRET_ACCESS_KEY,
        AWS_SMS_CONFIGURATION_SET_NAME:
          process.env.AWS_SMS_CONFIGURATION_SET_NAME || '',
      };

      // Create the email sender function
      const emailSender = new Function(stack, 'EmailSender', {
        handler: 'packages/functions/src/email-sender/index.handler',
        timeout: '60 seconds',
        environment,
        permissions: ['ses:SendEmail'],
      });

      const textSender = new Function(stack, 'TextSender', {
        handler: 'packages/functions/src/text-sender/index.handler',
        timeout: '60 seconds',
        environment,
        permissions: ['sms-voice:SendTextMessage'],
      });

      // Create the event stream processor function
      const messageEventProcessor = new Function(
        stack,
        'MessageEventProcessor',
        {
          handler:
            'packages/functions/src/message-event-processor/index.handler',
          timeout: '120 seconds',
          environment,
          permissions: ['s3:GetObject'],
        }
      );

      // Create the failed message processor function
      const failedMessageProcessor = new Function(
        stack,
        'FailedMessageProcessor',
        {
          handler:
            'packages/functions/src/failed-message-processor/index.handler',
          timeout: '60 seconds',
          environment,
          permissions: ['ses:SendEmail'],
        }
      );

      stack.addOutputs({
        emailSenderArn: emailSender.functionArn,
        textSenderArn: textSender.functionArn,
        messageEventProcessorArn: messageEventProcessor.functionArn,
        failedMessageProcessorArn: failedMessageProcessor.functionArn,
      });
    });
  },
} as const;
