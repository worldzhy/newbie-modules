# ADR-002: AWS region scope 收敛到 credential 平面，移除 AWS Monitor tab

状态：已采纳（2026-10-12 用户批准）
日期：2026-10-12
副本注记：本决策原件存于 nightwatch-backend `.trae/documents/decisions/`（nightwatch-backend 侧编号 ADR-003、newbie-modules 侧编号 ADR-002，同文）。

## 背景

项目当前存在两份独立的 AWS region 列表，语义相同、来源与消费方分裂：

| 列表 | 存储 | 编辑入口 | 消费方 |
|---|---|---|---|
| binding.regions | aws-identity `AwsCrossAccountBinding.regions` | AWS Credential tab | aws-audit 逐 region 迭代审计（aws-audit.service.ts L454）；secrets-manager 取 defaultRegion；STS verify 取 regions[0] |
| AwsAccount.regions | aws-cloudwatch 模块自有 schema | AWS Monitor tab | aws-cloudwatch-credential.service.resolve() → ec2/rds-instance discovery 逐 region 迭代 |

两份列表由两个 tab 分别编辑，互不引用、互不校验子集关系；契约层已出现为桥接两个概念而生造的词（`ProjectListItemDto.hasAwsMonitor` 的 Swagger 描述 "AWS monitor account"）。AWS Monitor tab 还承担第二个职责：EC2/RDS per-instance watch 开关（`isWatching`，被 `getWatchingInstanceIds` 的指标采集消费）。

为什么必须在写代码前决定：数据模型（drop 列 + migration）、模块间依赖方向、跨仓契约（前端 tab 移除 + apits regen）同时变动，属架构决策点。

## 候选方案

### 方案 A：单一 scope 收敛到 credential，移除 AWS Monitor tab（本 ADR 提议）

region 的唯一事实源是 aws-identity `binding.regions`（AWS Credential tab 为唯一编辑入口）；discovery 改为迭代 binding.regions；AWS Monitor tab 整体移除；watch 开关迁至 servers/databases 实例列表页。

### 方案 B：保留两层 scope + 子集校验

credential regions = 最大范围，AwsAccount.regions = 监听子集，强校验子集关系。仅在"审计需全覆盖、监控需 region 级节流"时自洽；region 级筛选在已有 per-resource watch 粒度下是冗余层，子集校验是纯守门逻辑。

### 方案 C：什么都不做

维持双源，文案澄清互指。双源分歧继续渗漏（生造词先例：hasAwsMonitor 描述）。

## 决策

采纳**方案 A**。决定性理由：两份列表承载同一语义（"本项目 AWS region 范围"），双源是对该语义的重复编码——任何一处修改都使另一处过时，这不是可以靠校验弥补的偏好问题，是数据模型错误。region 子集筛选的真实需求已由 per-resource watch 开关覆盖（更细粒度、同一交互面）。

实施细则（约束实现，不再另行决策）：

1. **regions 源切换**：`aws-cloudwatch-credential.service.resolve()` 的 regions 从 AwsAccount 行改为 `resolveProjectCredential()` 返回的 binding regions（该服务已依赖 AwsCredentialsService，依赖方向不变，无新增跨模块依赖）。
2. **AwsAccount 实体整体删除**：AwsAccount 是纯冗余锚点——aws-identity 的 `AwsCrossAccountBinding` 已持有 `projectId` 与 12-digit `awsAccountId`，实例无需经中间表间接关联项目。Ec2Instance/RdsInstance 的 `awsAccountId` FK 列替换为 `projectId` 直接列（plain column，无 FK——host scope 由宿主应用拥有，非本模块职责）；`Project.awsAccountId` 列删除；`hasAwsMonitor` 改名 `hasAwsCredential`（语义=项目配了 cross-account binding）；AwsAccount 表 + `aws-account/` controller/dto 删除（migration，pre-launch instance 行 truncate 无回填负担）。
3. **HTTP 面**：`GET /awsAccounts/:id`、`POST /awsAccounts`、`PATCH /awsAccounts/:id` 全部删除（AwsAccount 实体已不存在）；前端消费的实例列表/watch 端点不变。
4. **前端**：AWS Monitor tab 移除（page.tsx `TAB_KEYS`、monitor.tsx 删除、setup-guide "AWS Monitor" 步骤删除、其余步骤 tabIndex 重排对齐）；watch 开关与实例 sync 迁至 servers/databases 列表页；apits 重生成；`hasAwsMonitor` 改名 `hasAwsCredential`（语义=配了 cross-account binding），projects 列表徽章文案从 "Monitor" 改为 "AWS"。
5. **registry 流程**：aws-cloudwatch 属 newbie-modules 装配模块，改动走 registry 仓 + assemble，禁止直改 nightwatch-backend/src/modules 装配产物；`newbie dev lint` 确认模块依赖显式声明。

## 跨宿主 / 演进检验

- aws-cloudwatch 对 aws-identity 的依赖从"凭证"扩展为"凭证 + 其 regions"，两者都是 binding 的通用字段（非 nightwatch 宿主概念）；任何宿主装配 aws-cloudwatch 的前提本就是拥有 per-host AWS 身份（同 aws-audit/secrets-manager 先例），跨宿主成立。
- AwsAccount 实体删除后，aws-cloudwatch 模块不再自有任何 "account" 概念，"monitor account" 生造词从契约层彻底消除。实例直接以 projectId 关联项目，模块依赖方向不变（仍依赖 aws-identity 的 binding 解析），任何宿主装配 aws-cloudwatch 的前提本就是拥有 per-host AWS 身份。
- servers/databases 页承载 watch 交互是宿主产品表面，不涉及框架仓（newbie/fewbie/SDK 零影响）。

## 影响

**变得更容易**：region 单一编辑入口，新客户配置路径从两 tab 降为一 tab；Swagger 与真实数据源一一对应；"AWS monitor" 生造词与 tab 命名歧义（与 web-monitor/backend-monitor 撞词）一并消除；AwsAccount 中间表删除后实例直接 projectId 关联，无 lazy-ensure 间接层。

**变得更难 / 代价**：三仓联动（newbie-modules registry + nightwatch-backend 装配 + nightwatch-frontend）；drop-table + drop-column + add-column migration（pre-launch instance 行 truncate）；`hasAwsMonitor` → `hasAwsCredential` 契约改名涉及前端 apits 重生成。

**验收项**：

1. registry 改动后 assemble 产物与 registry 一致；`newbie dev lint` 通过；nightwatch-backend `tsc --noEmit` + `nest build` 通过。
2. 前端容器内 `tsc --noEmit` 通过；settings 页无 AWS Monitor tab；servers/databases 页可 sync + watch；watch 后指标采集正常（E2E 取证）。
3. setup-guide 无 AWS Monitor 残留，步骤跳转 tabIndex 对齐；全仓 grep `AWS Monitor`/`aws-monitor` 清零（记忆与历史 spec 快照除外）。
4. Living 设计文档同 PR 回写（grep `.trae/documents` 中描述 AwsAccount.regions / monitor scope 的段落）；三仓各自提交并推送 dev。
