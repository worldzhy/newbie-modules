// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SST generates this reference to its platform config types
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "message-tracker",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    // Environment variable configuration. Unset optional values are dropped so
    // the Lambda keeps falling back to the default credential chain.
    const environment = Object.fromEntries(
      Object.entries({
        DB_HOST: process.env.DB_HOST || "localhost",
        DB_PORT: process.env.DB_PORT || "5432",
        DB_USER: process.env.DB_USER || "postgres",
        DB_PWD: process.env.DB_PWD || "password",
        DB_NAME: process.env.DB_NAME || "message_tracker",
        DB_SSL: process.env.DB_SSL || "false",

        AWS_S3_REGION: process.env.AWS_S3_REGION,
        AWS_S3_ACCESS_KEY_ID: process.env.AWS_S3_ACCESS_KEY_ID,
        AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY,

        AWS_SES_REGION: process.env.AWS_SES_REGION,
        AWS_SES_ACCESS_KEY_ID: process.env.AWS_SES_ACCESS_KEY_ID,
        AWS_SES_SECRET_ACCESS_KEY: process.env.AWS_SES_SECRET_ACCESS_KEY,
        AWS_SES_CONFIGURATION_SET_NAME: process.env.AWS_SES_CONFIGURATION_SET_NAME || "",
        FROM_EMAIL_ADDRESS: process.env.FROM_EMAIL_ADDRESS,
        ADMIN_EMAIL_ADDRESS: process.env.ADMIN_EMAIL_ADDRESS || "",

        AWS_SMS_REGION: process.env.AWS_SMS_REGION,
        AWS_SMS_ACCESS_KEY_ID: process.env.AWS_SMS_ACCESS_KEY_ID,
        AWS_SMS_SECRET_ACCESS_KEY: process.env.AWS_SMS_SECRET_ACCESS_KEY,
        AWS_SMS_CONFIGURATION_SET_NAME: process.env.AWS_SMS_CONFIGURATION_SET_NAME || "",
      }).filter(([, value]) => value !== undefined) as [string, string][],
    );

    // Create the email sender function
    const emailSender = new sst.aws.Function("EmailSender", {
      handler: "packages/functions/src/email-sender/index.handler",
      runtime: "nodejs20.x",
      timeout: "60 seconds",
      environment,
      permissions: [{ actions: ["ses:SendEmail"], resources: ["*"] }],
    });

    const textSender = new sst.aws.Function("TextSender", {
      handler: "packages/functions/src/text-sender/index.handler",
      runtime: "nodejs20.x",
      timeout: "60 seconds",
      environment,
      permissions: [{ actions: ["sms-voice:SendTextMessage"], resources: ["*"] }],
    });

    // Create the event stream processor function
    const messageEventProcessor = new sst.aws.Function("MessageEventProcessor", {
      handler: "packages/functions/src/message-event-processor/index.handler",
      runtime: "nodejs20.x",
      timeout: "120 seconds",
      environment,
      permissions: [{ actions: ["s3:GetObject"], resources: ["*"] }],
    });

    // Create the failed message processor function
    const failedMessageProcessor = new sst.aws.Function("FailedMessageProcessor", {
      handler: "packages/functions/src/failed-message-processor/index.handler",
      runtime: "nodejs20.x",
      timeout: "60 seconds",
      environment,
      permissions: [{ actions: ["ses:SendEmail"], resources: ["*"] }],
    });

    return {
      emailSenderArn: emailSender.arn,
      textSenderArn: textSender.arn,
      messageEventProcessorArn: messageEventProcessor.arn,
      failedMessageProcessorArn: failedMessageProcessor.arn,
    };
  },
});
