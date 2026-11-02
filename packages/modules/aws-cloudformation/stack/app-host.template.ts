/**
 * CloudFormation template for the generic `APP_HOST` stack: one EC2 instance
 * running a containerised web application behind an elastic IP, plus the
 * image repository and the OIDC role CI uses to push images.
 *
 * Kept as a TypeScript object rather than a JSON asset so the template is
 * type-checked, diffable and always present in the compiled output.
 * Parameters carry no host vocabulary: callers pass their own project key,
 * domain and repository.
 */
export const APP_HOST_TEMPLATE = {
  AWSTemplateFormatVersion: "2010-09-09",
  Description: "Single-host web application runtime: EC2 + EIP + ECR + OIDC CI role.",
  Parameters: {
    ProjectKey: {
      Type: "String",
      AllowedPattern: "[a-z0-9][a-z0-9-]*",
      Description: "Lower-case key used to scope secrets, log groups and tags.",
    },
    EnvironmentName: {
      Type: "String",
      AllowedPattern: "[a-z0-9][a-z0-9-]*",
      Description: "Environment name (for example: prod).",
    },
    InstanceType: {
      Type: "String",
      Default: "t3.small",
      Description: "EC2 instance type of the application host.",
    },
    AmiId: {
      Type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
      Default: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64",
      Description: "AMI resolved from the public SSM parameter path.",
    },
    VpcId: {
      Type: "AWS::EC2::VPC::Id",
      Description: "VPC the host is created in.",
    },
    SubnetIds: {
      Type: "List<AWS::EC2::Subnet::Id>",
      Description: "Subnets the host may use; the first one is selected.",
    },
    Domain: {
      Type: "String",
      Default: "",
      Description: "Optional public hostname served by the application.",
    },
    HostedZoneId: {
      Type: "String",
      Default: "",
      Description: "Hosted zone that receives the DNS record when Domain is set.",
    },
    RepositoryFullName: {
      Type: "String",
      AllowedPattern: "[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",
      Description: "GitHub repository (owner/name) allowed to assume the CI role.",
    },
    Branch: {
      Type: "String",
      Default: "main",
      Description: "Git branch allowed to assume the CI role.",
    },
    GitHubOidcProviderArn: {
      Type: "String",
      AllowedPattern: "arn:aws:iam::[0-9]{12}:oidc-provider/token.actions.githubusercontent.com",
      Description: "Existing IAM OIDC provider for token.actions.githubusercontent.com.",
    },
    BackupBucketName: {
      Type: "String",
      Default: "",
      Description: "Optional existing bucket name; when set it is created and writable by the host.",
    },
  },
  Conditions: {
    HasDomain: { "Fn::Not": [{ "Fn::Equals": [{ Ref: "Domain" }, ""] }] },
    HasBackupBucket: { "Fn::Not": [{ "Fn::Equals": [{ Ref: "BackupBucketName" }, ""] }] },
  },
  Resources: {
    WebSecurityGroup: {
      Type: "AWS::EC2::SecurityGroup",
      Properties: {
        GroupDescription: { "Fn::Sub": "Application host ${ProjectKey}/${EnvironmentName}" },
        VpcId: { Ref: "VpcId" },
        SecurityGroupIngress: [
          { IpProtocol: "tcp", FromPort: 80, ToPort: 80, CidrIp: "0.0.0.0/0", Description: "HTTP" },
          { IpProtocol: "tcp", FromPort: 443, ToPort: 443, CidrIp: "0.0.0.0/0", Description: "HTTPS" },
        ],
        Tags: [
          { Key: "ProjectKey", Value: { Ref: "ProjectKey" } },
          { Key: "EnvironmentName", Value: { Ref: "EnvironmentName" } },
        ],
      },
    },
    WebInstanceRole: {
      Type: "AWS::IAM::Role",
      Properties: {
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Service: "ec2.amazonaws.com" },
              Action: "sts:AssumeRole",
            },
          ],
        },
        Policies: [
          {
            PolicyName: "app-host-runtime",
            PolicyDocument: {
              Version: "2012-10-17",
              Statement: [
                { Effect: "Allow", Action: ["ecr:GetAuthorizationToken"], Resource: "*" },
                {
                  Effect: "Allow",
                  Action: ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"],
                  Resource: { "Fn::GetAtt": ["EcrRepository", "Arn"] },
                },
                {
                  Effect: "Allow",
                  Action: ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"],
                  Resource: {
                    "Fn::Sub": [
                      "arn:${AWS::Partition}:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${ProjectKey}/*",
                      {},
                    ],
                  },
                },
                {
                  Effect: "Allow",
                  Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
                  Resource: {
                    "Fn::Sub":
                      "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/${ProjectKey}/${EnvironmentName}:*",
                  },
                },
                {
                  "Fn::If": [
                    "HasBackupBucket",
                    {
                      Effect: "Allow",
                      Action: ["s3:GetObject", "s3:PutObject"],
                      Resource: { "Fn::Sub": ["arn:${AWS::Partition}:s3:::${BackupBucketName}/*", {}] },
                    },
                    { Ref: "AWS::NoValue" },
                  ],
                },
              ],
            },
          },
        ],
        Tags: [
          { Key: "ProjectKey", Value: { Ref: "ProjectKey" } },
          { Key: "EnvironmentName", Value: { Ref: "EnvironmentName" } },
        ],
      },
    },
    WebInstanceProfile: {
      Type: "AWS::IAM::InstanceProfile",
      Properties: { Roles: [{ Ref: "WebInstanceRole" }] },
    },
    WebInstance: {
      Type: "AWS::EC2::Instance",
      Properties: {
        ImageId: { Ref: "AmiId" },
        InstanceType: { Ref: "InstanceType" },
        SubnetId: { "Fn::Select": [0, { Ref: "SubnetIds" }] },
        IamInstanceProfile: { Ref: "WebInstanceProfile" },
        SecurityGroupIds: [{ Ref: "WebSecurityGroup" }],
        DisableApiTermination: true,
        MetadataOptions: {
          HttpEndpoint: "enabled",
          HttpTokens: "required",
          HttpPutResponseHopLimit: 2,
        },
        UserData: {
          "Fn::Base64": {
            "Fn::Sub": [
              "#!/bin/bash\nset -euxo pipefail\nmkdir -p /opt/app\ndnf install -y docker\nsystemctl enable --now docker\nusermod -aG docker ec2-user\n",
              {},
            ],
          },
        },
        Tags: [
          { Key: "ProjectKey", Value: { Ref: "ProjectKey" } },
          { Key: "EnvironmentName", Value: { Ref: "EnvironmentName" } },
        ],
      },
    },
    ElasticIp: {
      Type: "AWS::EC2::EIP",
      Properties: { Domain: "vpc" },
    },
    EipAssociation: {
      Type: "AWS::EC2::EIPAssociation",
      Properties: {
        AllocationId: { "Fn::GetAtt": ["ElasticIp", "AllocationId"] },
        InstanceId: { Ref: "WebInstance" },
      },
    },
    EcrRepository: {
      Type: "AWS::ECR::Repository",
      Properties: {
        RepositoryName: { "Fn::Sub": "${ProjectKey}/${EnvironmentName}" },
        ImageTagMutability: "IMMUTABLE",
        ImageScanningConfiguration: { ScanOnPush: true },
      },
    },
    CiRole: {
      Type: "AWS::IAM::Role",
      Properties: {
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Federated: { Ref: "GitHubOidcProviderArn" } },
              Action: "sts:AssumeRoleWithWebIdentity",
              Condition: {
                StringLike: {
                  "token.actions.githubusercontent.com:sub": {
                    "Fn::Sub": "repo:${RepositoryFullName}:ref:refs/heads/${Branch}",
                  },
                },
              },
            },
          ],
        },
        Policies: [
          {
            PolicyName: "ecr-push",
            PolicyDocument: {
              Version: "2012-10-17",
              Statement: [
                { Effect: "Allow", Action: ["ecr:GetAuthorizationToken"], Resource: "*" },
                {
                  Effect: "Allow",
                  Action: [
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:CompleteLayerUpload",
                    "ecr:InitiateLayerUpload",
                    "ecr:PutImage",
                    "ecr:UploadLayerPart",
                  ],
                  Resource: { "Fn::GetAtt": ["EcrRepository", "Arn"] },
                },
              ],
            },
          },
        ],
        Tags: [
          { Key: "ProjectKey", Value: { Ref: "ProjectKey" } },
          { Key: "EnvironmentName", Value: { Ref: "EnvironmentName" } },
        ],
      },
    },
    WebHealthCheck: {
      Type: "AWS::Route53::HealthCheck",
      Condition: "HasDomain",
      Properties: {
        HealthCheckConfig: {
          IPAddress: { "Fn::GetAtt": ["WebInstance", "PublicIp"] },
          Port: 443,
          Type: "HTTPS",
          ResourcePath: "/healthz",
          RequestInterval: 30,
          FailureThreshold: 3,
        },
        HealthCheckTags: [{ Key: "Name", Value: { "Fn::Sub": "${ProjectKey}-${EnvironmentName}" } }],
      },
    },
    WebDnsRecord: {
      Type: "AWS::Route53::RecordSet",
      Condition: "HasDomain",
      Properties: {
        HostedZoneId: { Ref: "HostedZoneId" },
        Name: { Ref: "Domain" },
        Type: "A",
        TTL: "60",
        ResourceRecords: [{ "Fn::GetAtt": ["WebInstance", "PublicIp"] }],
      },
    },
    BackupBucket: {
      Type: "AWS::S3::Bucket",
      Condition: "HasBackupBucket",
      Properties: {
        BucketName: { Ref: "BackupBucketName" },
        OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
        },
        LifecycleConfiguration: {
          Rules: [{ Id: "expire-backups", Status: "Enabled", ExpirationInDays: 30 }],
        },
      },
    },
  },
  Outputs: {
    InstanceId: { Value: { Ref: "WebInstance" }, Description: "Host instance id." },
    PublicIp: {
      Value: { "Fn::GetAtt": ["WebInstance", "PublicIp"] },
      Description: "Elastic IP of the host.",
    },
    EcrRepositoryUri: {
      Value: { "Fn::GetAtt": ["EcrRepository", "RepositoryUri"] },
      Description: "Image repository pushed by CI.",
    },
    CiRoleArn: { Value: { "Fn::GetAtt": ["CiRole", "Arn"] }, Description: "GitHub Actions OIDC role." },
    AppUrl: {
      Condition: "HasDomain",
      Value: { "Fn::Sub": "https://${Domain}" },
      Description: "Public URL served by the host.",
    },
    HealthCheckId: {
      Condition: "HasDomain",
      Value: { Ref: "WebHealthCheck" },
      Description: "Route53 health check id of the public URL.",
    },
  },
} as const;
