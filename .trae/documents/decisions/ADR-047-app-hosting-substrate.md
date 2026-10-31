# ADR-047: aws-cloudformation 重构为可复用的应用托管基础设施适配层

状态：已采纳（2026-10-31）
日期：2026-10-31
归属：框架层（newbie-modules registry，`packages/modules/aws-cloudformation`）
关联：nightwatch ADR-012（生产拓扑）、nightwatch ADR-038（宿主部署编排）

## 背景

nightwatch 要把"客户系统上线"收敛成平台内的一键操作，部署目标是每项目独立 EC2 + Docker Compose，构建走 GitHub Actions，环境访问走 AssumeRole，敏感值存 Secrets Manager。基础设施能力落在 registry，而不是宿主。

现有 `aws-cloudformation` 模块无法承担这个角色，有三处实质阻碍：

1. **环境模型存静态长期密钥**：`AwsEnvironment` 的 `awsAccessKeyId` / `awsSecretAccessKey` 加签名 token 配置，与"去静态密钥、统一凭证链"规则冲突。
2. **栈模板在仓外**：所有栈类型通过 `getStackTemplate()` 返回 S3 上的 `quickstart-*` 模板地址，模板内容不可评审、不可版本化；`fargate-cicd` 等模板从未在本仓验证过。
3. **只发起、不核对**：`createStack` / `destroyStack` 调用后立即写成 PROCESSING，没有 describe 轮询与终态判定，调用方无法知道栈是否真的可用。
4. **遗留栈类型带宿主词汇**：`MESSAGE_TRACKER`、`PRODUCT_*` 等与模块准入标准（不得携带宿主业务词汇）直接冲突，且当前无消费方。

作用域说明：ADR-012 中"不沉淀为 newbie-modules 能力、starter 不引入 AWS 部署资产"约束的是 **nightwatch 自身的生产拓扑**。本 ADR 决定的是"把任意客户系统部署到 AWS"的通用厂商适配能力，与 ADR-012 并行成立，不构成对其的取代。

## 候选方案

### A. 什么都不做，宿主直接调 AWS SDK

nightwatch 在 `src/application/` 内直接使用 CloudFormation / SSM / ECR SDK。短期可行，但 AWS 凭证获取、栈创建等待、命令轮询这些厂商细节会与"部署"业务语义混在一起；第二个宿主出现时只能复制一遍。

### B. 维持模块现状，仅补轮询

保留静态 AK/SK 与 S3 模板，只加 describe 轮询。状态判断问题解决，但两个制度性问题（长期密钥、模板不可评审）仍在，且 Fargate 外部模板继续作为不可验证资产存在。

### C. 重构为通用应用托管适配层

环境只存 `awsAccountId` / `awsRegion` / `roleArn`（可选 `externalId`），每次操作由宿主实例角色 AssumeRole 拿临时凭证；栈模板作为模块内资源以 `TemplateBody` 提交；原语收敛为幂等的 `getOrCreateStack` / `describeStack` / `deleteStack` / `sendCommand`；新增通用 `APP_HOST` 栈类型，删除所有宿主词汇与外部 S3 模板依赖。

## 决策

采用 **C**。决定性理由：**适配层的契约必须与"谁在部署、部署什么"无关**。静态密钥与仓外模板不是风格问题，而是两个无法被代码审查拦截的风险点——前者让凭证长期驻留在数据库，后者让实际生效的模板不在任何 diff 里。把它们换掉之后，"部署"这一业务语义才能留在宿主，模块只回答"AWS 上这个栈现在是什么状态、这条命令执行结果如何"。

### 契约

1. **环境与凭证**
   - `AwsEnvironment`：`name`、`awsAccountId`、`awsRegion`、`roleArn`、`externalId`；移除 `awsAccessKeyId`、`awsSecretAccessKey` 与 `AWS_CLOUDFORMATION_SECRETKEY_TOKEN_SECRET` 配置及签名服务。
   - 所有 AWS 调用使用 `AssumeRoleCommand` 得到的临时凭证；宿主实例角色只被授予 `sts:AssumeRole` 到环境角色。
   - 系统未上线，无迁移要求：直接改模型后 `prisma db push` 重置，不写 migration。

2. **栈定义**
   - 模板以 `TemplateBody` 从模块内文件读取并提交，CloudFormation 不再需要 S3 暂存桶（`s3ForCloudformation` 移除）。
   - 只保留 `APP_HOST` 一个栈类型；删除 `Null`、`NetworkHipaa`、`ProductMessageTracker`、`Cicd*`、`ComputingFargate` 等无人消费或携带宿主词汇的栈与 S3 引用。
   - `APP_HOST` 模板参数：`projectKey`、`environmentName`、`domain`、`hostedZoneId`、`vpcId` / `subnetIds`（或 `CreateVpc`）、`instanceType`、`repositoryFullName`、`branch`。模板包含：单台 EC2（IMDSv2、禁用终止、只开 80/443、无 SSH）、EIP 与安全组、实例角色（ECR 拉取 + 本前缀 Secrets Manager 只读 + CloudWatch 日志）、ECR 仓库（应用镜像）、OIDC CI 角色（信任指定仓库与分支）、Route53 记录与健康检查、可选快照与备份桶。
   - 模板不包含任何产品业务策略；需要额外权限时由参数注入，而不是写死。

3. **原语与状态**
   - `getOrCreateStack`：先 `DescribeStacks`；不存在则 `CreateStack` 并等待 `CREATE_COMPLETE`，存在则按状态返回当前终态或失败原因。
   - `deleteStack`：等待 `DELETE_COMPLETE`；不存在视为成功。
   - `sendCommand`：`SendCommand` + 轮询 `GetCommandInvocation` 直至成功/失败，返回标准化退出码与输出。
   - 所有原语幂等、带超时；模块只回报 AWS 事实，不定义"部署成功"的业务判定。

4. **敏感值**
   - 应用环境变量（上报地址、令牌、数据库凭据）不属于本模块；由宿主在 AssumeRole 得到的权限内写入 Secrets Manager，实例角色按项目前缀只读。模块只保证凭证可用。

## 跨宿主 / 演进检验

- 模块内不出现 project / deployment / customer 等宿主词汇；`APP_HOST` 是厂商能力名，参数全部通用。
- 换一个宿主消费：装配模块、建一条 `AwsEnvironment`（账号 + 区域 + 角色），调用四个原语即可；宿主自行决定何时创建、部署什么。
- 若未来需要 Fargate 等另一种拓扑，以新增栈类型表达，不在现有栈内分支；不把某一种拓扑写进原语。

## 影响

- nightwatch 通过 `newbie modules add aws-cloudformation` 装配；`modules.json` 与 Prisma schema 随之更新。
- 依赖新增 `@aws-sdk/client-ssm`、`@aws-sdk/client-ecr`、`@aws-sdk/client-sts`；移除签名 token 服务及其配置/环境变量。
- 旧栈类型删除后，任何历史 `AwsResourceStack` 记录失去对应类型；系统未上线，直接清库重置。
- 后续义务：`APP_HOST` 模板需要真实部署一次作为验收证据；模板参数变更属于契约变更，必须同步本 ADR 或新 ADR。
