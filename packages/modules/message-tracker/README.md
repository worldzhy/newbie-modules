# Message Tracker Microservice

A microservice for tracking and managing message delivery status across multiple channels.

## Features

- Multi-channel support (Email, SMS)
- Real-time message tracking
- Message template management
- Rate limiting and throttling

## File structure

message-tracker/
├── message-tracker.controller.ts # 控制器
├── message-tracker.module.ts # 模块定义
├── message-tracker.service.ts # 服务层
├── cloudformation/ # AWS CloudFormation模板
├── sample-data/ # 示例数据
│ └── message-event-samples  
├── sst/ # Serverless Stack (SST)实现
│ ├── sst.config.ts # SST配置
│ ├── packages/
│ │ ├── core/ # 共享核心代码
│ │ │ ├── src/
│ │ │ │ ├── database/ # 数据库操作
│ │ │ │ ├── pinpoint/ # 邮件和短信服务
│ │ │ │ ├── s3/ # 存储服务
│ │ │ └── package.json
│ │ ├── functions/ # Lambda函数
│ │ │ ├── src/
│ │ │ │ ├── message-sender/ # 消息发送
│ │ │ │ ├── message-event-processor/ # 事件处理
│ │ │ │ └── failed-message-processor/ # 失败消息处理
│ │ │ └── package.json
│ └── .sst/ # SST构建文件
└── .newbie/ # 项目配置

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
