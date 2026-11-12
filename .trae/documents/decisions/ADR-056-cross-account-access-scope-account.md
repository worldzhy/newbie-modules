# ADR-056: AWS 跨账户接入的主作用域由项目收敛为账户

状态：提议中
日期：2026-11-13
关联：ADR-052（两阶段身份替换状态机，本 ADR 保留其状态机、改其作用域键）；ADR-053（binding 词根，本 ADR 沿用）；ADR-002（region 唯一事实源在 binding，本 ADR 沿用其结论）；nightwatch-frontend ADR-005（rotation Lambda ARN 项目级，由本 ADR 取代该单点）；devbie ADR-046（rotation Lambda 产物托管与一键部署）

> 归属：本决策改的是 registry 模块 `aws-identity` 的 schema 与 HTTP 契约，单一源存放于本仓。

## 背景

`AwsCrossAccountBinding` 当前以 `projectId @unique` 为作用域键：一个项目一行，携带身份（`roleArn`/`externalId`/`pendingExternalId`/`awsAccountId`/`roleName`）与作用域（`regions`/`defaultRegion`）。

三个事实说明这个作用域键与资源的真实生命周期不一致：

1. **IAM 角色是账户级资源，但其平台建模是项目级**。前端生成的 CloudFormation 模板把 `RoleName` 与 `stackName` 都写死为 `NightwatchCrossAccountRole`，trust policy 的 `sts:ExternalId` 条件只接受单个值。同一客户 AWS 账户下接入第二个项目时，栈/角色名重复导致部署失败；即便手工复用同一角色，第二个项目的 external ID 不在信任条件内，`AssumeRole` 直接被拒。当前实现隐含"一账户一项目"的前提，而这个前提从未被声明。
2. **region 是账户属性**。ADR-002 已把 region 唯一事实源收敛到 binding，但 binding 挂在项目上，等于同一账户的多份 region 副本。
3. **rotation Lambda 是账户级资源**。SST 部署以 AWS 账户 ID 作为 stage（`newbie secrets deploy-rotation`），一个账户一个栈；而它的 ARN 却被存在宿主的 `Project.awsSecretsManagerRotationLambdaArn` 列上。资源生命周期在账户侧、配置生命周期在项目侧，同一事实被迫复制。

结论：**账户是这些资源的宿主，项目是消费方**；把绑定挂在项目上导致资源身份、作用域、配置三者的生命周期互相错配。

## 候选方案

| 方案 | 数据形状 | 同账户多项目 | 评价 |
|------|----------|--------------|------|
| A. 维持项目级（什么都不做） | `AwsCrossAccountBinding.projectId @unique` | 角色名与 external ID 冲突，无法接入 | 隐含前提不可用，且随账户级资源增加持续恶化 |
| **B. 账户级绑定 + 显式引用表（选定）** | `AwsCrossAccountBinding` 以 `accountId` 为键；新增 `AwsCrossAccountBindingScope`（`scopeId @unique` → `bindingId`） | 一个账户一份绑定，多个项目引用 | 绑定生命周期与 AWS 资源一致；引用关系显式、可查询、可解绑 |
| C. 账户级绑定 + 项目侧裸存 accountId | 某处存字符串引用 | 可行 | 引用完整性靠约定，无唯一约束、无法反查哪些项目在用、解绑无守卫 |
| D. 保留双写（项目级 + 账户级两张表同步） | 两套模型 | 可行 | 同一事实两份副本，必然漂移 |

## 决策

**方案 B**。决定性理由：

1. **主键应声明资源的真实宿主**。IAM 角色、external ID、region 列表、rotation Lambda 都是账户级事实；以 `accountId` 作为绑定的唯一键，让一条记录完整描述"平台与这个客户账户的接入关系"，与 AWS 侧一一对应。
2. **引用关系必须是一等模型，不能是隐式约定**。`AwsCrossAccountBindingScope.scopeId @unique` 既表达"一个项目恰用一套接入"，也让"这个账户被哪些项目使用"可反查——解绑前的占用检查、切换账户时的迁移都依赖它，方案 C 无法提供。
3. **保留 `resolveProjectCredential(projectId)` 签名**。所有消费方（aws-s3 / aws-ses / aws-sms / aws-sqs / aws-secrets-manager / aws-cloudwatch）不变，内部多一跳 scope → binding。作用域键的变更不应扩散为六个模块的签名变更。
4. **ADR-052 的状态机原样保留**。草案身份 / 活动身份、external ID 随身份轮换、两阶段替换，全部成立，只是键从 `projectId` 换成 `accountId`；不做第二套模型。

**契约变更（机械部分）**：

- `AwsCrossAccountBinding`：移除 `projectId`；`awsAccountId` 提升为作用域键并改名 `accountId`（`@unique`，非空）；新增 `rotationLambdaArn String?`。
- 新增 `AwsCrossAccountBindingScope`：`id`、`scopeId String @unique`（host scope 标量，无外键、无 Prisma relation，延续 ADR-052 的宿主无关约束）、`bindingId`、时间戳。
- `externalId` 语义从 per-project 变为 per-account：一个账户一份身份、一份信任策略。这与 ADR-052 决策 2"External ID 与角色一对一"一致，且修正了现状中"同一角色被多个 external ID 争用"的不可能性。
- HTTP 面：`/aws-cross-account-bindings/accounts/:accountId`（身份与作用域 CRUD、verify、rebind、rotate-external-id）+ `/aws-cross-account-bindings/scopes/:scopeId`（引用/解绑）。`projects` 段不再出现在路由中——它是宿主 scope 的一个实例，不应固化进契约。
- 宿主侧删除 `Project.awsSecretsManagerRotationLambdaArn`，读取改为经 scope → binding 取 `rotationLambdaArn`。

**待批准项（命名）**：引用表命名。倾向 `AwsCrossAccountBindingScope`（与 ADR-002 的 "region scope"、ADR-048 的 scoped authorization 词汇一致）；备选 `AwsCrossAccountBindingUsage`（更强调引用而非作用域）。若选 `Usage`，则 `scopeId` 列改 `projectId` 以外的泛称 `hostScopeId`。

## 跨宿主 / 演进检验

| 维度 | 结论 |
|------|------|
| 宿主无关性 | 引用表的键是 `scopeId` 泛称（项目 / 租户 / 组织皆可），不含宿主业务词汇；绑定表只描述外部账户接入 |
| 换宿主成立性 | 单租户 SaaS 以 organization 为 scope 时，形状成立：`AwsCrossAccountBindingScope.scopeId = orgId`，一个组织引用一个账户 |
| 厂商边界 | `accountId`、`roleArn`、`externalId`、`rotationLambdaArn` 是 AWS 概念，但本模块本身就是 AWS 适配器，厂商词汇不向其他模块泄漏 |
| 消费方面 | 六个消费模块调用签名不变（`resolveProjectCredential(projectId)`）；只改内部解析，业务逻辑零改动 |
| 演进路径 | 若出现"一个项目需访问多个账户"，只需放宽 `scopeId` 唯一约束为 `@@unique([scopeId, bindingId])` 并让解析接受账户参数；本决策不堵这条路 |
| 安全边界 | 同账户多项目共享一个角色后，AWS 侧隔离降为账户边界，项目间隔离由平台授权层承担。这是账户级建模的固有取舍，必须在模块 README 与接入页文案中明示 |

## 影响

**更容易**：一账户一次接入，多个项目复用；role 名与 external ID 不再冲突；rotation Lambda ARN 与所属账户绑定，换 Lambda 只改一处；region 列表单一副本。

**更难 / 后续工作**：

- schema 迁移：nightwatch 已上线，必须走 `prisma migrate dev`。存量 `AwsCrossAccountBinding` 行需按 `awsAccountId` 归并为账户级行，并为原 `projectId` 生成 scope 行；`awsAccountId` 为空的行（草案期）需人工确认归属，不能静默丢弃。
- 前端接入页从"项目配置"改为"账户接入 + 项目引用"两段式；rotation Lambda ARN 与一键部署入口迁到账户卡片；readiness 的 Security 行语义变为"该项目所指账户已配置 rotationLambdaArn"。
- 旧 ADR 状态：ADR-052 状态改为「已采纳（作用域键部分由 ADR-056 取代）」，正文不改；nightwatch-frontend ADR-005 中 rotation ARN 项目级一句加 `Superseded by: newbie-modules ADR-056` 注记。
- 契约测试：新增"同账户两项目共享一份绑定"与"解绑被占用账户被拒绝"两条行为测试，属于本决策的交付定义。
