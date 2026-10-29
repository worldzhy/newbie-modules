# ADR-037: security-evaluation 评估定义模型与契约修正

状态：已采纳
日期：2026-10-27（2026-10-29 修订：新增 D9 判定输入材料契约）
归属：框架层（newbie-modules registry，`packages/modules/evaluation` + `packages/modules/security-evaluation`）
关联：ADR-020（骨架）、ADR-027（CLOUD_CONFIG）、ADR-033（非 CIS 自定义规则族）、ADR-036（宿主切换）

## Background

ADR-033 决定了 `cis-aws-1.5` 与 `aws-custom` 两个 family，并把合规归属放进 `family` 维度。在评审 4.6 方案时，对旧 `aws-audit` 28 条规则逐条对账，发现：

1. **`family` 词义不清**：骨架 schema 注释写 "feature-defined group"，但实际承担的是"一次独立评估"的身份（criteria 版本、finding 生命周期、run 边界都以 `family` 为界）。词不达意。
2. **归并准则的 severity 失真**：`cis-2-1-2` 归并了 `pab-missing`(medium)、`pab-partial`(high)、`policy-public`(high)、`acl-public`(high)；`cis-1-15` 归并了 `user-password-expired`(high) 与 `rotation-unclear`(medium)。当前判定器 severity 只按 criterion 元数据取单值，被归并的旧规则 severity 无法表达。自定义侧 `iam.policy-service-wildcard` 旧实现按服务动态定级（iam/sts/kms/organizations=high，其余 medium），固定 criterion severity 同样无法镜像。
3. **政策分析发现单元漂移**：旧实现按挂载点出 finding（同一策略挂 3 个主体出 3 条），ADR-033 只采 `policyArn` 按策略判，发现粒度变化未声明，且 inline 策略合成 key 缺失。
4. **`cis-1-15` 漏判两条旧条件**：新准则只判账号密码策略是否配置过期，旧 `iam.user-password-expired` / `iam.user-password-rotation-unclear` 判每个用户 credential report 的 `password_next_rotation`；当前 `UserCredentialFactPayload` 无该字段。
5. **`ec2.public-ip-with-public-ingress` 判定条件不等价**：ADR-033 写"实例公网 IP + 子网自动分配公网 IP"，旧实现是"有公网 IP 且挂载的 SG 有 0.0.0.0/0 或 ::/0 入站"。
6. **coverage 虚报**：判定器把全部 evidence 当作 evaluatedRefs，引入新 factType 后会把无关事实计入覆盖率。

用户对四项决策点拍板：(1) CIS 与 custom 为两个独立 Evaluation（family 维度不变）；(2) `family` 重命名为 `evaluationKey`；(3) 类目归属由模块表达，不加 schema 字段；(4) 资产级事实库存 + 共享采集 + freshness。

## Decision

### D1. `family` → `evaluationKey`（骨架契约改名）

骨架把 `family` 改为 `evaluationKey`，覆盖：Prisma 字段 `EvaluationCriteriaVersion.evaluationKey`、`EvaluationFinding.evaluationKey`；DTO 字段 `EvaluationCriteriaVersionRef.evaluationKey`；服务层所有 `family` 变量；唯一键 `(subjectId, evaluationKey, fingerprint)`。

语义：一个 `evaluationKey` = 一次独立评估的规则集血缘（如 `cis-aws-1.5`、`aws-custom`、`dependency-osv`）。版本化、finding 生命周期、run 边界都以此为界。系统未上线，直接 `prisma db push` 对齐，不写迁移。

### D2. 两个 Evaluation 模型确认（ADR-033 D1/D6 维持）

`cis-aws-1.5` 与 `aws-custom` 是两个独立 Evaluation：证据契约不同（custom 新增 access key / policy 文档 / 实例网络）、版本血缘独立、合规语义不同。一个 cloud-account subject 产生两次 run，各自的 coverage、manifest、finding 生命周期独立。合规轴 = `evaluationKey = 'cis-aws-1.5'` 过滤。

### D3. 类目归属由模块表达

"security" 是类目，由 feature 模块归属表达（`security-evaluation` 模块承载所有安全类 Evaluation），不在 schema 加 category 字段。出现第二个非安全类目时再引入声明式注册表。

### D4. per-draft severity（准则默认，草稿覆盖）

`CloudConfigFindingDraft` 增加可选 `severity` 字段；判定器取值顺序为 `draft.severity ?? criterion.metadata.severity`。归并准则的各触发条件可携带各自 severity，镜像旧规则字面量。

### D5. policy-as-finding-unit

发现单元是策略本身，不是挂载点。finding 身份 `aws:<criterionKey>:<policyIdentity>`，`metadata.attachments` 携带挂载主体列表作为上下文。policy 事实契约扩展：

| 字段 | 说明 |
| --- | --- |
| `kind` | `managed` / `inline` |
| `identity` | managed = ARN；inline = `inline:user:<userName>:<policyName>` / `inline:group:<groupName>:<policyName>` / `inline:role:<roleName>:<policyName>` |
| `document` | 原始策略 JSON |
| `attachments` | `[{ principalKind, principalName }]` |

### D6. 采集契约扩展（5 项）

| 类型 | factType / 扩展 | 要点 |
| --- | --- | --- |
| 新 | `aws.iam.access-key` | `{ userName, accessKeyId, status, createdAt, lastUsedAt \| null }`；仅 ACTIVE key 参与判定 |
| 新 | `aws.iam.policy-document` | 见 D5 |
| 新 | `aws.ec2.instance-network` | `{ instanceId, region, publicIpAddress \| null, securityGroupIds: string[] }` |
| 扩展 | `aws.iam.user-credential` | += `passwordNextRotation: string \| null`（credential report `password_next_rotation`） |
| 扩展 | `aws.s3.bucket-security` | += `versioningEnabled: boolean` |
| 扩展 | `aws.rds.instance-security` | += `masterUserSecretManaged: boolean` |

自定义规则判定条件（与旧实现一致）：

| criterionKey | 条件 |
| --- | --- |
| `iam.access-key-no-usage` | ACTIVE key 无 `lastUsedAt` 记录 |
| `iam.access-key-old` | ACTIVE key `createdAt` 距今 > 90 天 |
| `iam.user-multiple-access-keys` | 用户 ACTIVE key 数 > 1 |
| `iam.policy-notaction` | Allow + NotAction 语句 |
| `iam.policy-star-on-star` | Allow + Action `*` + Resource `*` |
| `iam.policy-service-wildcard` | action 以 `:*` 结尾且 Resource `*`；severity 按服务定级（iam/sts/kms/organizations=high，其余 medium） |
| `iam.policy-sensitive-action` | 敏感 action（PassRole/AssumeRole/Decrypt/GetSecretValue）且 Resource `*` |
| `rds.master-password-not-managed` | `masterUserSecretManaged = false` |
| `s3.no-versioning` | `versioningEnabled = false` |
| `ec2.public-ip-with-public-ingress` | `publicIpAddress` 非空且 `securityGroupIds` 中存在 0.0.0.0/0 或 ::/0 入站的 SG |

### D7. coverage 按 requiredFactTypes 计算

判定器的 `evaluatedRefs` 改为只含被至少一个准则的 `requiredFactTypes` 消费的事实；未被任何准则消费的事实进入 `unconsumed` 桶。两个 Evaluation 各自的 coverage 只统计自身准则消费的事实，互不干扰。

### D8. 资产级事实库存 + 共享采集 + freshness

事实是资产当前态（spec §4），由 `AwsCloudConfigurationAccess` 一次性采集并 upsert。两个 Evaluation 的 EvidenceProvider 各自声明所需 factType，共享采集器；采集按 freshness 策略（同窗口内复用已采集事实，避免重复 AWS 调用）。

### D9. 判定输入材料契约（knowledge / evidence / 结论）

D8 只定义了资产事实库存，未回答"三个 evaluationKey 的输入材料是否同一概念"。定稿如下：

```
Knowledge（判定输入池，跨 run 复用，落表）
  ├── asset-scoped knowledge   ← SecurityEvaluationAssetFact（D8）
  └── world-scoped knowledge   ← SecurityEvaluationKnowledgeItem（intel）
            ↓ 每次 run 选取/采集本次涉及的子集
Evidence（本次 run 的输入切片，EvaluationResult.manifest）
            ↓ judge()
Verdict / Finding（结论）
```

1. **两类 knowledge 同族、物理分表。** 唯一键语义（`assetId + factType + factKey` vs `source + externalId`）、保留策略（不主动删除、仅随资产级联清理，靠 `observedAt` 判陈旧 vs 90 天 / 每源 1000 条清理）、是否绑定 asset 三项约束互斥，不合并为一张表。`AssetFact` 概念上归入 knowledge 家族（改名如 `AssetKnowledgeItem`）是术语债，不改表结构。
2. **evidence 是本次 run 的登记全量输入切片，与是否命中无关。** npm 每个包、AWS 每条配置各产一条 evidence，无论是否产生 finding。"全量"指**登记全量**：每条候选材料必须落到 `evaluated` 或 `skipped`，不要求每条都实际参与比对（预算截断允许但必须记账）。若只有命中才登记 evidence，coverage 的 `evaluated` 桶失去意义（"没命中"与"没评估"不可区分），并违反 ADR-020 D5 第 2 项（被截断的内容不得静默丢弃）。命中产出的是 finding。
3. **`JudgmentInput` 契约收紧。** 判定器只吃 `input.evidence`，不得旁路读库——包括直接查 knowledge 表、注入 provider 读项目画像等任意库外输入；`subject.kind` 已由 `judgmentPortToken(kind)` 路由，入参应收窄为 `Omit<EvaluationSubjectRef, "kind">`（未落地），禁止同一 evaluationKey 在不同 kind 下分支——那会使同一 key 的 finding 不可比，R1 的静态声明失真。
4. **intel 补账方向（未落地）。** 把窗口内候选情报条目投影成 `EvaluationEvidenceItem`（`layer: "knowledge"`，`layer` 为开放 string，无需改骨架类型），因预算未比对条目进 `skipped` 桶并登记数量（登记全量，见第 2 条）；使 coverage 可区分"没命中"与"没评估"，finding 的 `evidenceRefs` 可回指情报条目。intel 当前的第二处旁路（注入 provider 读 `project` 表构造匹配实体）同样要收敛：实体应经 `input.subject` / `input.evidence` 传入或显式登记为外部来源。

**落地状态**：第 1–2 条为现状语义确认，无需改代码；第 3–4 条为技术债，由宿主侧 ADR-037 同步登记。

## Cross-host check

| 维度 | 框架层 | 宿主层 |
| --- | --- | --- |
| 评估身份 | `evaluationKey` 字段，两个 family 各自版本化 | 不定义；run API 传 `criteriaVersionId` |
| severity | per-draft 覆盖 | 不判定 |
| 发现单元 | policy 身份 + attachments metadata | 采集器提供 attachments |
| 采集契约 | fact 表写进 README | `AwsCloudConfigurationAccess` 实现采集 |
| coverage | 按 requiredFactTypes | 不干预 |
| 共享采集 | EvidenceProvider 声明 factType | 采集器实现 freshness 缓存 |
| 判定输入材料 | knowledge 两类（asset-scoped / world-scoped）分表；evidence 为 run 切片 | 落 AssetFact / KnowledgeItem 表，投影成 evidence item |

## Consequences

- `family → evaluationKey` 改名覆盖骨架 + security-evaluation + work-evaluation，系统未上线直接 db push。
- 18 条 CIS 旧规则归并为 10 条准则，每条归并点的 severity 通过 per-draft 保留。
- 政策风险按策略去重，不再按挂载点复制；挂载关系降级为 finding 上下文。
- 10 条自定义规则 + 5 项采集扩展补齐规则等价闸门。
- 一个 cloud-account 两次 run，合规轴只取 CIS run。
