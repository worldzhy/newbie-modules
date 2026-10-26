# ADR-027: security-evaluation 切片 2 —— CLOUD_CONFIG 端口契约与 CIS 目录收敛

状态：提议中
日期：2026-10-26
前置：ADR-020（evaluation 骨架）、ADR-022（security-evaluation 重建，已采纳）

## 背景

切片 1 已交付并三仓推送：资产清单 + DEPENDENCY 判定 + 单轴报告 + 运行端点（registry `dc53541` / backend `60caec2` / frontend `0ed2f29`）。切片 2 的范围在 spec Phase 4.1 已定：CLOUD_CONFIG 判定器 + CIS 规则目录收敛 + 宿主 compliance 读模型。

宿主（nightwatch）现状取证：

- 只有 AWS 一家云。`aws-identity` 提供 per-project 凭证解析：`AwsCredentialsService.resolveProjectCredential(projectId)` → `ResolvedAwsCredentials`（懒加载 STS assumeRole 临时凭证）。
- `aws-audit` 是存量 CIS 风格扫描器：约 30 条规则覆盖 IAM/S3/RDS/EC2，维护 `ruleIdToCisControl`（CIS AWS Foundations Benchmark v1.5）映射。按 ADR-022「并存与切换边界」，旧模块原样保留并存，切片 2 不迁移、不混报告。
- 命名结论（2026-10-26 用户确认）：subject kind `cloud-account` 与机制名 CLOUD_CONFIG 保持框架通用，AWS 特异性由 criteria family `cis-aws-1.5` 与宿主实现类名（`Aws*`）承载——与切片 1 `RepositoryAccess` / `GitHubRepositoryAccess` 的端口分层同构。

本 ADR 只决定切片 2 的端口契约与目录收敛；实现细节以代码为准。

## 候选方案

- **A. 端口产原始配置事实，规则目录与判定在模块内**：宿主端口返回账号配置的只读事实投影（不产结论），CIS 控制项作为 criteria 入表，判定逻辑是模块代码。与 DEPENDENCY 完全同构（端口产事实、judgment 判定、criteria 版本化）。
- **B. 端口产 aws-audit 已判定的合规结论，模块做映射**：判定实质留在旧模块，规则目录不是模块资产，finding 的 severity/urgency 派生被旧模块语义绑架。违反 ADR-022 D4（判定按可否机械复现分配、入模块）与 D7（规则元数据入表、判定逻辑留在代码），且实质是包装旧模块混报告，spec 明确禁止。仅作对照列出，不采纳。

## 决策

### D1. 新端口 `CloudConfigurationAccess`：产事实，不产结论

- 接口形状镜像 `RepositoryAccess`：`collectFacts(subject) → CloudConfigurationFact[]`，token `securityEvaluationCloudConfigurationAccessToken`，按 kind 消费，宿主必须显式绑定；未绑定时 evidence collection 抛错（与切片 1 RepositoryAccess 未绑定的失败语义一致）。
- 端口返回值即 spec 所称「宿主 compliance 读模型」：账号配置的**事实**投影（密码策略对象、bucket 的 PAB/加密状态、安全组入站规则……），不是 pass/fail 结论。判定全部发生在模块内。

### D2. 事实词汇（factType）与区域维度

| factType | payload 要点 | 服务的 CIS 控制项 |
|---|---|---|
| `aws.iam.account-password-policy` | 策略是否存在、最小长度、过期等字段 | 1.13 / 1.15 |
| `aws.iam.root-credential` | root 访问密钥数量、MFA 启用 | 1.4 / 1.5 |
| `aws.iam.user-credential` | 用户名、MFA、密码龄、密钥龄 | 1.8 / 1.15 |
| `aws.s3.bucket-security` | bucket 名、PAB 四旗、默认加密、公有的 policy/ACL | 2.1.1 / 2.1.2 |
| `aws.rds.instance-security` | 实例 id、公开可达、存储加密 | 2.3.1 |
| `aws.ec2.security-group-ingress` | 组 id、区域、入站 CIDR/端口 | 4.1 / 4.2 |

- 区域型事实（EC2/RDS；S3 bucket 按其实际区域）在 payload 带 `region`；全局事实（IAM）不带。
- 资产事实层复用切片 1 的 `AssetFact` 行：asset = 云账号本身，factType 即上表，观测即同步，不新增表。

### D3. CIS 目录收敛：一项控制 = 一项 ASSERTION criterion

- **收敛规则**：事实可确定性采集 + 判定无自由参数。以 aws-audit 既有 `ruleIdToCisControl` 映射为采集可行性证据。
- **初始集（10 项）**：IAM 1.4 / 1.5 / 1.8 / 1.13 / 1.15；S3 2.1.1 / 2.1.2；RDS 2.3.1；EC2 4.1 / 4.2。
- criterionKey 形如 `cis-1-4`；severity 与 remediation 摘要入 criterion `metadata`；family 用既有常量 `cis-aws-1.5`，kind 用 `cloud-account`，首个 criteria version 为 `v1`。目录扩项 = 同 family 新 version，已发布版本永不原地改（沿用切片 1 的版本纪律）。

### D4. Subject 绑定：一个 project 绑定 = 一个 cloud-account subject

- 宿主 `SubjectProvider` 扩展：scopeType `project` 下枚举 `awsCrossAccountBinding`，每条绑定映射为一个 subject：`subjectKey` = 绑定 id，`displayName` = AWS account id，`metadata` 携带区域列表。
- 切片 1 `startRun` 里「仅 repository」的 400 护栏随本切片解除：cloud-account kind 拥有完整四端口后进入正常分发。

### D5. 宿主采集器新建，aws-audit 原样不动

- 新宿主实现 `AwsCloudConfigurationAccess`（`src/application/security-evaluation/`）：经 `AwsCredentialsService.resolveProjectCredential(projectId)` 取凭证，直接调 AWS SDK（IAM/S3/RDS/EC2）采集 D2 的事实。
- **不**从 aws-audit 抽取共享采集层：旧模块按 ADR-022 并存边界保留、切换在切片 4.4 单独决策；给将退役的模块做抽取手术属于 D9 禁止的无谓重写。采集代码的局部相似是演进路径上的正常过渡。

### D6. 覆盖与失败语义沿用骨架三桶，不新增概念

- 单控制项的事实采集失败（权限不足、API 报错）→ 该控制项进 `skipped`（note 带原因、items 列 criterionKey），run 仍完成；全部控制项不可采集 → run FAILED，不报「洁净」。
- 判定 PASS 不产 finding；FAIL 产 finding，fingerprint 为版本无关的 `aws:<criterionKey>:<resourceKey>`（resourceKey 如 bucket 名、安全组 id、用户名；账号级控制项用 account id）。
- `declaredUnlinked` 对本机制无对应概念，恒为空桶（骨架允许空桶）。
- severity 来自 criterion metadata；urgency 沿用切片 1 的 severity × exposure 派生，云账号的 exposure 恒为 `internal` 起步，后续由 metadata 驱动，不在本切片引入新 exposure 来源。

## 跨宿主检验（registry 模块设计必填）

| 维度 | 框架层（registry 模块） | 宿主层（nightwatch） |
|---|---|---|
| 端口签名 | `CloudConfigurationAccess.collectFacts(subject)`，token 由模块导出 | 绑定 `AwsCloudConfigurationAccess`，经 aws-identity 取凭证 |
| 事实词汇 | D2 的 factType/payload 是模块契约 | 宿主按契约产出，不自行发明字段 |
| 规则目录 | CIS 控制项作为 code-defined criteria seed，版本化发布 | 无宿主侧规则数据 |
| finding 身份 | `aws:<criterionKey>:<resourceKey>` 由模块判定器生成 | 宿主不参与 |
| subject 来源 | kind `cloud-account` 与 scope 契约 | `awsCrossAccountBinding` 枚举是宿主特有 |
| 可移植性 | 另一宿主接入其他云时新增自己的 family（如 `cis-gcp-x.y`）与宿主实现，骨架与本模块机制不变；family 名已含 provider + 基准版本，天然不冲突 | — |

## 未在此 ADR 决定的事

- 切片 3（knowledge/ 采集 + INTEL 判定器）与切片 4（多轴报告、整改绑定、通知模板）。
- 旧模块（aws-audit / dependency-scan / threat-intelligence）的切换与处置：由用户单独决策（spec Phase 4.4）。
- CIS 目录超出初始集后的扩项节奏与新 family（新基准版本）的引入时机。

## 影响

- 模块（registry）新增：`ports/cloud-configuration-access.port.ts`、`judgment/cloud-config/`（规则手册 + 判定器）、`evidence` 扩展 cloud-account kind、criteria seed 增加 `cis-aws-1.5` family、factType 常量、行为级测试（规则判定、覆盖三桶、fingerprint）。骨架零改动。
- 宿主新增：`AwsCloudConfigurationAccess`、subject provider 扩展、wiring 绑定；无 schema 变更（事实与 criteria 都是行数据）。
- E2E：依赖本地可用的 AWS 绑定（aws-identity）。采集不可达时按 D6 落 skipped，也属于有效取证路径，但交付以至少一条真实采集链路跑通为准。
