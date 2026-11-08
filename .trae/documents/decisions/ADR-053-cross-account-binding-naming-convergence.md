# ADR-053: aws-identity 的 HTTP 与服务层词根由 credential 收敛为 cross-account-binding

状态：已采纳（2026-11-08 用户拍板：词根收敛 + 精度选 cross-account-binding；次级决策 1/2 均改；执行暂缓，登记于本仓 backlog）
日期：2026-11-08
关联：ADR-052（跨账户绑定的身份两阶段原子替换；本 ADR 将其 binding 词汇延伸到 HTTP/服务层）；nightwatch-backend `.trae/documents/aws-identity-decouple_plan.md`（其"仅统一单复数、保留 credential 词根"的命名选择由本 ADR 取代）；nightwatch-frontend ADR-004（凭证设置引导 UX，引用的路由路径随本决策过期，ADR 快照正文不改）

## 背景

`aws-identity` 模块内部存在词汇分裂：持久层早已全部说 binding——模型 `AwsCrossAccountBinding`、DTO `UpsertAwsCrossAccountBinding`、方法链 `bootstrapBinding/updateBinding/verifyBinding/...`、evaluation 侧引用串 `aws-binding:<id>`；唯独 HTTP 面与服务类仍说 credential——路由 `/aws-credentials/projects/:projectId`、`AwsCredentialsController`、`AwsCredentialsService`，前端 settings tab 与 React Query 缓存键跟随后者。

取证 schema：`AwsCrossAccountBinding` 行的字段为 `roleArn`、`externalId`、`pendingExternalId`、`awsAccountId`、`roleName`、`defaultRegion`、`regions`、`lastVerifiedAt`——零秘密材料。真正的凭证（STS 临时令牌）是运行时 `AssumeRole` 现取（`AwsTemporaryCredentials`），从不落库。持久层存的是"如何获取凭证的授权配置"，不是凭证本身。credential 一词把授权配置误述为凭证，同时模糊秘密/非秘密边界——日志、审计、错误消息里对 "credential" 的脱敏直觉不应被一条 role ARN + externalId 触发。

需要在写代码前决定：HTTP/服务层词根是否改、改成什么、哪些层保留 credential。

## 候选方案

| 方案 | HTTP/服务层 | 运行时解析层 | 评价 |
|------|------------|-------------|------|
| A. 维持 credentials | 不变 | 不变 | 名不副实继续存在；与模块内多数派词汇分裂 |
| **B. 收敛 binding（选定）** | 词根改 `cross-account-binding`，与模型/DTO/方法链对齐 | 保留 credential | 名实相符；向多数派收敛 |
| C. 一刀切全改 binding | 改 | 也改 | 错误——运行时层解析出的就是凭证材料，credential 在那里是正确术语（AWS SDK `AwsCredentialIdentity` 先例），改了反而名不副实 |

## 决策

**方案 B**。决定性理由：

1. **名实相符是命名的第一判据**。持久层存的是跨账户授权配置（角色 ARN + External ID + 区域作用域），凭证是运行时临时产物；把配置叫凭证是误述，且在安全语境下模糊秘密边界。
2. **向模块内多数派收敛，不是新造词**。模型、DTO、方法链、eval 引用串四处的既有口径就是 binding；改 HTTP/服务层是消除分裂，而非引入新词汇。词根精度选 `cross-account-binding` 而非裸 `binding`：模块真名即 `AwsCrossAccountBinding`，裸 binding 在 AWS 语境不自解释。
3. **运行时层保留 credential 同样是名实相符**。`AwsCredentialsProvider`、`AwsTemporaryCredentials`、`resolveProjectCredential`、`AwsCloudwatchCredentialService` 处理的是真实凭证材料，与 AWS SDK 的单数 `AwsCredentialIdentity` 同构，不动。

**命名口径**（机械映射，无决策点）：

- 路由：`/aws-credentials/projects/:projectId` → `/aws-cross-account-bindings/projects/:projectId`（`projects` 宿主 scope 段不变）
- 文件：`aws-credentials.{controller,service,dto}.ts` → `aws-cross-account-bindings.{controller,service,dto}.ts`
- 类：`AwsCredentialsController/Service` → `AwsCrossAccountBindingsController/Service`；DTO 类名不变（已是 binding）
- `awsBindingCredentialRef` → `awsBindingRef`；引用串字面量 `"aws-binding:<id>"` 不变
- 宿主层 wire 字段：`hasAwsCredential` → `hasAwsCrossAccountBinding`（project DTO → apits → 前端 2 消费点，跟随收敛）
- 前端：settings tab 文件/组件/tab value/i18n key 与 7 处 `queryKey` 跟随新路由口径

**UI 文案**：tab 标签由 "AWS Credentials"/"AWS 凭证" 改为 "Cross-Account Role"/"跨账户角色"——用户在 AWS 控制台实际创建的就是 IAM 角色，该词对用户同样自解释，且不再把配置称为凭证。

**被否决的方案**：

- **A**：词汇分裂与名不副实继续存在，且随 ADR-052 落地后 binding 词汇进一步扩张而更刺眼。
- **C**：把正确术语改成错误术语，运行时层处理的确实是凭证材料。

## 跨宿主 / 演进检验

| 维度 | 结论 |
|------|------|
| 宿主无关性 | "跨账户绑定"是任意宿主接入外部账户的通用形状（ADR-052 已论证）；不含宿主业务词汇，`projects` 段是 host scope 泛称的宿主实例化，不在本决策范围 |
| 换宿主成立性 | 单租户 SaaS 以 organization 为 scope 时，同一路由形状成立：`/aws-cross-account-bindings/organizations/:orgId` |
| 厂商边界 | `cross-account` 是 AWS 词汇，但该模块本身是 AWS 适配器，厂商词汇留在模块边界内（同 ADR-052 厂商边界行），不向其他模块泄漏 |
| 消费方面 | registry 内消费方（aws-s3/aws-ses/aws-sms/aws-sqs/aws-secrets-manager/aws-cloudwatch）仅 import 服务类，机械跟随；运行时凭证类型名不变，消费方业务逻辑零改动 |

## 影响

**更容易**：模块词汇全链一致（模型↔DTO↔方法↔路由↔前端）；秘密边界语义清晰，"credential" 字样出现处即真实凭证材料。

**后续工作**：

- registry 侧改名 + 消费方 import 跟随 → 装配到 nightwatch-backend → apits 重生成 → 前端 tab/queryKey/i18n/`hasAwsCrossAccountBinding` 跟随，三仓提交。
- nightwatch-frontend ADR-004 引用的路由路径过期：ADR 为时点快照不改正文，以本 ADR 为当前真源。
- nightwatch-backend `aws-identity-decouple_plan.md` 顶部补 Status 横幅，指向本 ADR。
- nightwatch 未上线，无真实消费方，契约直接改，不保留兼容路由。
