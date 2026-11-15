# ADR-059: AWS CloudWatch 监控数据的作用域由项目收敛为 AWS 账户

状态：已采纳（2026-11-13 用户拍板：页面放账户详情页签、授权沿用角色权限、存量按 usage 映射且无归属行删除）
日期：2026-11-13
关联：ADR-056（跨账户接入主作用域由项目收敛为账户，本 ADR 把同一结论扩展到监控数据面）；ADR-002（region 唯一事实源在 binding，本 ADR 沿用）；ADR-017（scope 名称由装饰器移到宿主配置，本 ADR 只改宿主的 scoped 资源清单）；ADR-048（scoped 授权优先级，本 ADR 把这批资源移出 scoped 轨道）

> 归属：本决策改的是 registry 模块 `aws-cloudwatch` 的 schema 与 HTTP 契约，单一源存放于本仓；宿主的授权清单、权限种子与前端路由由 nightwatch 侧按本文实施。

## 背景

`aws-cloudwatch` 的两个清单模型目前都以项目为作用域键：

- `Ec2Instance` / `RdsInstance` 带 `projectId`（纯列、无外键），`RdsInstance` 的唯一键是 `[name, region, projectId]`。
- 列表、同步（`/fetch`）、关注开关（`syncWatch`）与指标查询（`/ec2-metric`、`/rds-metric`）全部以 `projectId` 入参。
- 凭据解析调用 `AwsCrossAccountBindingsService.resolveProjectCredential(projectId)`，即"项目 → usage → 账户绑定"一跳。

ADR-056 已经把接入关系收敛为账户级：`AwsCrossAccountBinding` 以 `accountId` 为唯一作用域键，项目只是通过 `AwsCrossAccountBindingUsage` 引用账户的消费方。EC2/RDS 清单随后的建模没有跟上这一步，导致：

1. **同一账户被两个项目引用时，清单与关注列表各存一份副本**。AWS 侧是同一个实例集合，平台侧按项目分裂，同步时间不同即漂移；关注状态（决定 CloudWatch 指标采集范围）无法跨项目共享。
2. **数据作用域与凭据作用域不一致**。ACS 凭据是账户级的（一次 AssumeRole 覆盖整个账户 + 账户声明的 region 列表），但清单行按项目隔离，`fetch` 只能"按项目重建自己那份副本"。
3. **项目成为访问监控数据的必要条件，即便项目与账户毫无关系**。没有 usage 的项目配置不出凭据，页面只能渲染空列表；而账户本身在 `/aws-accounts` 是可管理的。
4. 生产实测印证了第 3 点：绑定 `975050274643` 只被 Solidcore 引用，Nightwatch 项目无 usage，因此后者永远看不到该账户的实例——这不是缺陷，而是作用域键选错的必然结果。

结论：**EC2 实例、RDS 实例、关注标记都是 AWS 账户侧的事实，项目只是"引用了这个账户"**。

## 候选方案

| 方案 | 数据形状 | 同账户多项目 | 评价 |
|------|----------|--------------|------|
| A. 维持项目级（什么都不做） | `projectId` 为作用域键 | 清单与关注列表多份副本，必然漂移 | 与 ADR-056 已确立的账户级接入关系持续错配 |
| **B. 账户号直接作作用域键（选定）** | `accountId String` 纯列，无外键 | 一份清单、一份关注列表，多项目共享 | 作用域与 AWS 资源、凭据、`/aws-accounts` 路由三者一致 |
| C. 以 `bindingId` 作外键 | `bindingId @db.Uuid` + 关系 | 一份清单 | 依赖 binding 行生命周期：解绑并删除账户后行随外键悬空或级联删除，而清单是可再同步的派生数据，不应被身份行绑定 |
| D. 保留项目表 + 账户级视图表 | 两张表 | 视图需同步维护 | 同一事实两份副本，回到方案 A 的漂移问题 |

## 决策

**方案 B**。决定性理由：

1. **作用域键声明资源的真实宿主**。EC2 实例、RDS 实例、CloudWatch 指标都属于客户 AWS 账户；ADR-056 已判定账户是接入关系的宿主，监控数据面没有理由停在项目级。
2. **`accountId` 是已有契约里的稳定键**。`/aws-cross-account-bindings/accounts/:accountId`、`AwsCrossAccountBinding.accountId @unique`、`ResolvedAwsCredentials.accountId` 都使用它；监控接口以同一键寻址，前端无需在账户页再做一次"项目 → 账户"翻译。
3. **派生数据不绑定身份行**。清单可由 `fetch` 随时重建，使用账户号而非 `bindingId`，避免身份行删除（解绑后的账户清理）连带处置派生数据；同一账户重新接入后，旧关注列表自然复用。
4. **注意状态（`isWatching`）语义收敛为账户级**。它决定哪些实例参与指标采集；采集本身按账户凭据进行，账户级关注列表与采集范围一致。

**契约变更（机械部分）**：

- `Ec2Instance`：`projectId` → `accountId String`（AWS 12 位账户号，纯列、无外键）；`instanceId` 的全局 `@unique` 改为 `@@unique([instanceId, accountId])`（实例 ID 的唯一性以账户为界，多账户接入后全局唯一不再成立）；索引改为 `@@index([accountId])`。
- `RdsInstance`：`projectId` → `accountId String`；`@@unique([name, region, projectId])` → `@@unique([name, region, accountId])`；索引同步。
- HTTP 面（四个控制器，入参 `projectId` 全部换成 `accountId`，校验从 `@IsUUID("4")` 改为 12 位数字串）：
  - `GET /ec2-instances?accountId&status&isWatching`
  - `GET /ec2-instances/fetch?accountId`
  - `PATCH /ec2-instances/syncWatch`（body `accountId`）
  - `GET /ec2-metric?accountId&metricName&...`
  - RDS 四条同构。
  - `PATCH /ec2-instances/watch/:ec2InstanceId`、`PATCH /rds-instances/watch/:rdsInstanceId` 路径不变，授权口径随资源改档（见下）。
- 服务层：`fetch` 的"删除 AWS 已不存在行"与 upsert 条件按 `accountId` 收敛；upsert 唯一键改为复合键。
- `aws-identity` 新增 **`resolveAccountCredential(accountId)`**（与 `resolveProjectCredential(projectId)` 对称，返回同一个 `ResolvedAwsCredentials`）；`resolveProjectCredential` 签名与其六个存量消费方（aws-s3 / aws-ses / aws-sms / aws-sqs / aws-secrets-manager / aws-audit）不变。

**授权口径（已决：角色权限）**：

- `Ec2Instance`、`RdsInstance` 从 `HOST_SCOPED_RESOURCES_LIST` 移出，`SCOPE_ROLE_PERMISSION_MATRIX` 删除对应 rank 行，宿主 `scope-resolvers.ts` 删除 `ec2-instance` / `rds-instance` 两个解析器。
- 二者与 `AwsCrossAccountBinding` 同档：系统级资源，按角色权限判定（请求中没有项目上下文，也无从解析）。
- 权限种子：`module/aws-cloudwatch` 命名空间授权从 `Projects` 组移到 `AWS Accounts` 组（账户页签与账户生命周期同权）。
- 明确取舍：账户级建模后，AWS 侧隔离降为账户边界，项目成员之间不再有实例级隔离；这与 ADR-056「安全边界」一节的结论一致，需在账户页文案中明示。

**UI 归属（已决：账户详情页签）**：

- `/aws-accounts/[accountId]` 增加 `EC2` / `RDS` 两个页签，与现有账户概览并列；页面数据源改为账户号，凭据前置条件由"项目已挂载"改为"账户已配置角色"。
- 移除项目侧入口：`/projects/[projectId]/ec2`、`/projects/[projectId]/rds` 及其在项目布局中的菜单项；项目设置的 Cross-Account Role 页签保持"只做挂载/解绑"的职责（ADR-056 UI 归属修订不变）。

**存量迁移（已决：usage 映射，无归属删除）**：

1. 新增 `accountId` 可空列；
2. 按 `Ec2Instance.projectId` / `RdsInstance.projectId` 连接 `AwsCrossAccountBindingUsage` → `AwsCrossAccountBinding.accountId` 回填；
3. 无 usage（无法归属账户）的行删除——清单是可再同步的派生数据，不做人工归属；
4. 置 `NOT NULL`、删除 `projectId` 与其索引、重建唯一约束。

生产事实：绑定 `975050274643` 的 usage 仅 Solidcore，其 EC2/RDS 行可全部回填；Nightwatch 无 usage 且清单为空，迁移不丢有效数据。

**账户删除与派生数据**：账户删除在引用存在时已被 `ConflictException` 拒绝；解绑全部消费方后删除账户，`aws-cloudwatch` 的存量行**不做级联清理**。理由是清单为派生缓存，账户页消失后这些行不可达，同一账户重新接入时还可持续复用关注列表；下一次 `fetch` 会按 AWS 现状校正。跨模块删除事件不在本决策范围内。

## 跨宿主 / 演进检验

| 维度 | 结论 |
|------|------|
| 宿主无关性 | `projectId` 从模块 schema 与契约中完全消失；`accountId` 是 AWS 概念，而 `aws-cloudwatch` 本身就是 AWS 适配器，厂商词汇不向其他模块泄漏 |
| 换宿主成立性 | 单租户 SaaS 若一个组织只接一个账户，`accountId` 仍是正确寻址键；多租户下账户与租户的对应关系由宿主 `AwsCrossAccountBindingUsage` 表达，模块不感知 |
| 消费方面 | 只有 `aws-cloudwatch` 改为账户寻址；其余六个 AWS 消费模块的 `resolveProjectCredential(projectId)` 签名与行为不变 |
| 演进路径 | 若将来需要"同一账户在不同业务视图下不同的关注列表"，再引入账户视图/订阅表；本决策不堵这条路，但当前不为假设需求预留结构 |
| 安全边界 | 授权从项目级降为角色级（系统级资源），项目间实例隔离消失；这是账户级建模的固有取舍，与 ADR-056 的安全边界结论一致 |

## 影响

**更容易**：一个账户一份清单、一份关注列表，多项目共享且不再漂移；账户页签与账户生命周期同址，凭据前置条件直观；接口键与 `/aws-accounts` 路由键一致。

**更难 / 后续工作**：

- 迁移是破坏性契约变更：DTO/控制器、`@/api` 生成物、前端页面同时改，`projectId` 入参不能保留兼容分支（宿主与 registry 同版本交付）。
- 项目成员默认失去监控入口，必须由角色获得 `AWS Accounts` 组权限；生产环境权限种子需重新执行。
- registry 与宿主两侧都要改：registry 侧 `aws-identity` + `aws-cloudwatch`，宿主侧 prisma 迁移、授权清单、权限种子、前端路由；按仓库约定先在 nightwatch 验证，再机械 back-port registry。
- 项目侧文档/文案中"项目服务器 / 项目数据库"的表述需改为账户维度。

## 落地清单

1. `aws-identity`：新增 `resolveAccountCredential(accountId)` + 行为测试（账户未配置角色时抛错、缓存命中不重复 AssumeRole）。
2. `aws-cloudwatch`：schema、DTO、四个控制器、四个服务、指标 DTO 全量换键；补"同账户两项目共享一份关注列表"的契约测试。
3. nightwatch-backend：`npx prisma migrate dev --name cloudwatch_scope_account`（含回填与删行）、`host-scoped-resources.ts` / `scope-role-permission.matrix.ts` / `scope-resolvers.ts` 收敛、权限种子迁移、`npm run apits`。
4. nightwatch-frontend：账户详情页签、移除项目路由与菜单、i18n 文案、查询键按 `accountId`。
5. 验证后立即机械 back-port registry（`diff -rq` 为空）。
