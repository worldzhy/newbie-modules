# Message Tracker Microservice

A microservice for tracking and managing message delivery status across multiple channels.

## Features

- Multi-channel support (Email, SMS)
- Real-time message tracking
- Message template management
- Rate limiting and throttling

## File structure

message-tracker/
├── message-tracker.controller.ts # Controller
├── message-tracker.module.ts # Module definition
├── message-tracker.service.ts # Service layer
├── cloudformation/ # AWS CloudFormation templates
├── sample-data/ # Sample data
│ └── message-event-samples  
├── sst/ # Serverless Stack (SST) implementation
│ ├── sst.config.ts # SST configuration
│ ├── packages/
│ │ ├── core/ # Shared core code
│ │ │ ├── src/
│ │ │ │ ├── database/ # Database access
│ │ │ │ ├── pinpoint/ # Email and SMS services
│ │ │ │ ├── s3/ # Storage service
│ │ │ └── package.json
│ │ ├── functions/ # Lambda functions
│ │ │ ├── src/
│ │ │ │ ├── message-sender/ # Message sending
│ │ │ │ ├── message-event-processor/ # Event processing
│ │ │ │ └── failed-message-processor/ # Failed message handling
│ │ │ └── package.json
│ └── .sst/ # SST build files
└── .newbie/ # Project configuration

## Getting Started

Overall Steps:

Step 1. Database

- Make sure ./.newbie/message-tracker.schema is loaded in the database.

Step 2. SES and SMS

- Enable SES from AWS console.
- Create identity.
- (Configuration set will be created by CloudFormation.)

- Enable End User Messaging SMS from AWS console.
- Create registration.
- Create a configuration set for tracking messages.

Step 3. Prepare lambda codes for CloudFormation template

- Create S3 bucket.
- Upload ./infrastructure/lambda-codes/\* to the bucket.

Step 4. Create stack from CloudFormation console

- Use ./infrastructure/cloudformation/message-tracker-v2.template.json

### Develop Lambda

1. Install dependencies:

```bash
cd ./sst
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

3. Develop Lambda functions:

```bash
npm run dev
```

4. Deploy Lambda functions:

```bash
npm run deploy
```

5. Download Lambda functions code.zip

6. Upload code.zip to production Lambda functions.

7. Update code.zip in ./infrastructure/lambda-codes/\*

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
