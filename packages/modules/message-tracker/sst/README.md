# Message Tracker

A message tracking system built with AWS SES (Simple Email Service) and SMS.

## Documentation References

### AWS SES Documentation

- [Event Content Guide](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-firehose-contents.html)
- [Event Examples](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-firehose-examples.html)

### AWS SMS Documentation

- [Event Types Guide](https://docs.aws.amazon.com/sms-voice/latest/userguide/configuration-sets-event-types.html)
- [Event Format Examples](https://docs.aws.amazon.com/sms-voice/latest/userguide/configuration-sets-event-format.html)

## Project Structure

```
sst/
├── package.json           # Root package configuration
├── sst.config.ts         # SST configuration
├── tsconfig.json         # TypeScript configuration
└── packages/
    ├── core/             # Shared core code
    │   ├── src/
    │   │   ├── database/ # Database operations
    │   │   ├── email/    # Email service
    │   │   ├── sms/      # SMS service
    │   │   └── types/    # Type definitions
    │   └── package.json
    └── functions/        # Lambda functions
        ├── src/
        │   ├── message-sender/        # Message sending
        │   ├── message-event-processor/ # Event processing
        │   └── failed-message-processor/ # Failure handling
        └── package.json
```

## Lambda Functions

### 1. Message Sender

- Processes messages from SQS queue
- Handles email and SMS delivery
- Uses `postgres` client for database operations
- Integrates with AWS SES and SMS services

### 2. Failed Message Processor

- Handles message delivery failures
- Generates HTML failure reports
- Sends alerts to configured email addresses

### 3. Message Event Processor

- Processes S3 and EventBridge events
- Parses message delivery events
- Stores email and SMS events separately

## Environment Setup

1. Set AWS credentials with AdministratorAccess on your local

- https://sst.dev/docs/iam-credentials/

2. Create .env file

```bash
cp .env.example .env
```

## Development

1. Install dependencies:

```bash
npm install
```

2. Local development:

```bash
npm run dev
```

## Production:

1. Download code.zip from the Lambda sst deployed.

```bash
npm run build
npm run deploy
```

2. Upload code.zip to the Lambda you actually use.

## Tech Stack

- **SST (Serverless Stack)**: Infrastructure as code
- **AWS Lambda**: Serverless computing
- **AWS SQS**: Message queuing
- **AWS SES**: Email service
- **AWS SMS**: SMS service
- **PostgreSQL**: Database
- **postgres**: Database client
- **TypeScript**: Type-safe JavaScript
- **Workspace**: Monorepo package management

## Database Schema

The database schema is defined in `../.newbie/message-tracker.schema` using Prisma schema format. It includes:

- Message tracking and management
- Message event tracking
- Message group handling
- Support for both email and SMS messages
- Delivery status tracking
- Event correlation

For detailed schema information, please refer to the schema file at:
`../.newbie/message-tracker.schema`

## Development Notes

The project uses a workspace architecture with shared code in `packages/core`:

- **Database Service**: PostgreSQL operations using `postgres` client
- **Email Service**: AWS SES integration with template support
- **SMS Service**: AWS SMS integration
- **Type Definitions**: Shared TypeScript types

All Lambda functions depend on the core package for consistency and code reuse.
