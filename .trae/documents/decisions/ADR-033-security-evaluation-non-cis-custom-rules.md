# ADR-033: security-evaluation 非 CIS 自定义规则族（保留 IAM policy 分析）

状态：已采纳
日期：2026-10-26
归属：框架层（newbie-modules registry，`packages/modules/security-evaluation`）
关联：ADR-027（CLOUD_CONFIG 与 CIS 初始集，本 ADR 扩展其控制集范围）、ADR-032（run 事件）、ADR-036（宿主切换）

## Background

用户对切换口径的选择是 **D2-B：以 CIS 为唯一合规口径**，同时给出硬约束：**不得丢失 IAM policy 分析**。两者并不冲突，只是需要把"合规口径"和"检测项集合"分开。

取证结论（定论，来自旧模块源码）：

- `aws-audit` 的 `ruleIdToCisControl` 映射表覆盖 18 条规则，映射到 10 个 CIS 控制项（1.4 / 1.5 / 1.8 / 1.13 / 1.15 / 2.1.1 / 2.1.2 / 2.3.1 / 4.1 / 4.2）——与 ADR-027 已落地的 10 条 CIS 控制项**恰好一一对应**。
- 另有 **10 条规则故意不映射**（注释原文："Rules without a direct CIS equivalent are intentionally unmapped (null) so compliance reports can distinguish 'covered by CIS' from 'custom rule'"）。旧模块的 `cisControlId` 因此可空，合规报告靠 null 区分基准覆盖与自定义规则。

也就是说：旧模块自己就不认为 IAM policy 分析是 CIS 控制项。把它塞进 `cis-aws-1.5` 等于伪造基准覆盖，会污染合规口径。

## Decision

### D1. 两个规则族，同一 subject kind

| family       | kind            | 定位                                       | 合规轴可见 |
| ------------ | --------------- | ------------------------------------------ | ---------- |
| `cis-aws-1.5` | `cloud-account` | CIS AWS Foundations Benchmark v1.5 控制项  | 是         |
| `aws-custom`  | `cloud-account` | 无 CIS 等价项的自定义检测（旧模块等价物）  | 否         |

`aws-custom` 命名理由：直接继承旧模块已使用的 "custom rule" 词汇，语义自解释。候选 `aws-iam-policy` 被否——该族跨 IAM/S3/RDS/EC2，名字过窄；`aws-extended` 被否——"extended" 相对什么扩展不可判定。

### D2. 范围 = 全部 10 条未映射规则

D1-B 的切换闸门是**能力等价**。只补 4 条 policy 规则、丢掉另外 6 条，会让"等价"失去可判定性，也让被丢掉的 6 条无据可查。因此 10 条全收：

| 旧 ruleId（即新 criterionKey）  | 判定所需事实                                          |
| ------------------------------- | ----------------------------------------------------- |
| `iam.access-key-no-usage`       | access key 的最近使用时间                             |
| `iam.access-key-old`            | access key 的创建时间                                 |
| `iam.user-multiple-access-keys` | 每用户活跃 key 数量                                   |
| `iam.policy-notaction`          | 策略文档中 Allow + NotAction 语句                     |
| `iam.policy-star-on-star`       | Allow + Action `*` + Resource `*`                     |
| `iam.policy-service-wildcard`   | 以 `:*` 结尾的 action 且 Resource `*`                 |
| `iam.policy-sensitive-action`   | 敏感 action（PassRole/AssumeRole/Decrypt/GetSecret）且 Resource `*` |
| `rds.master-password-not-managed` | RDS MasterUserSecret 是否由服务托管                |
| `s3.no-versioning`              | 桶版本控制是否开启                                    |
| `ec2.public-ip-with-public-ingress` | 实例公网 IP + 子网是否自动分配公网 IP             |

### D3. criterionKey 沿用旧 ruleId，指纹可追溯

- `criterionKey` = 旧 ruleId 原样（如 `iam.policy-star-on-star`）。
- finding fingerprint = `aws:<ruleId>:<resourceKey>`（沿用 ADR-027 指纹形态）。
- criterion `metadata` 含 `severity`（镜像旧规则字面量，逐条比对后固化）、`remediation`，并**不含** `controlId` / `benchmark`——缺失即表达"非 CIS"，不写 null 字段冒充。

### D4. 事实层扩展：3 个新 factType + 2 个 payload 字段

端口仍只产原始事实（ADR-027 D1），策略文档解析与判定全部留在判定器内。

| factType                    | factKey     | value 要点                                                                    |
| --------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `aws.iam.access-key`        | `accessKeyId` | `{ userName, accessKeyId, status, createdAt, lastUsedAt \| null }`          |
| `aws.iam.policy-document`   | `policyArn`   | `{ arn, name, isAttached, defaultVersionId, document }`（document 为原始 JSON）|
| `aws.ec2.instance-network`  | `instanceId`  | `{ instanceId, region, publicIpAddress \| null, subnetAutoAssignPublicIp }`   |

payload 扩展（既有 factType，JSON 追加字段）：
- `aws.s3.bucket-security` += `versioningEnabled: boolean`
- `aws.rds.instance-security` += `masterUserSecretManaged: boolean`

不新增 `aws.iam.policy-attachment` 之类的中间事实：策略是否挂载已由 `isAttached` 表达，避免事实碎片化。

### D5. 合规轴按 family 过滤，自定义族不得混入

`report` 的合规维度（及任何"基准覆盖"统计）**必须**按 `family = cis-aws-1.5` 过滤。`aws-custom` 的 finding 正常出现在 findings 列表与 severity/urgency 统计中，但不得计入 CIS 覆盖率——否则等于把自定义规则伪装成基准达标。

### D6. 版本化机制不变

两条族各自版本化：CIS 规则改动 → `cis-aws-1.5` v2；自定义规则改动 → `aws-custom` v2。均不原地改（ADR-022）。判定器不复制判分循环：同一 `SecurityEvaluationCloudConfigJudgment` 按 `criteriaVersion.family` 选择对应 rulebook 集与指纹前缀，公共部分（coverage、evaluatedRefs、urgency）只写一份。

## Cross-host check

| 维度       | 框架层（security-evaluation 模块）                                                                 | 宿主层（nightwatch-backend）                                                       |
| ---------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 规则族     | 两个 family 与 20 条 criterion 全部由 rulebook 代码定义并幂等播种                                  | 不定义规则；只提供采集实现                                                         |
| 事实契约   | 3 个新 factType + 2 个扩展字段写进模块 README 的 fact 表                                            | `AwsCloudConfigurationAccess` 采集并填这些事实（policy 文档、access key、实例网络） |
| 判定语义   | rulebook 内完成（文档解析、敏感 action 列表、端口敏感度等）                                         | 不判定；采集器只报原始值                                                           |
| 合规口径   | `metadata` 不写 controlId/benchmark 表达非 CIS；report 按 family 过滤                                | 前端合规卡片只读 CIS 维度                                                          |
| 可移植性   | 任意 AWS 宿主装上采集器即可复用全部 20 条规则；非 AWS 宿主不受影响（kind 隔离）                     | 采集实现含 AWS SDK 词汇，留在宿主（ADR-027 既有分工）                              |

## Consequences

- CIS 口径保持纯净：合规报表不会因为保留自定义规则而虚增基准覆盖。
- 切换闸门可判定：旧 28 条规则 → 新 10 条 CIS + 10 条自定义，逐条有对应。
- 采集面变大：IAM 需 `ListAccessKeys` + `ListPolicies`/`GetPolicyVersion`，EC2 需补充实例网络；这些调用都属只读，但要计入采集耗时预算（分页与并发、失败进 `skipped` 的语义沿用 ADR-027 D6）。
- 策略文档作为事实入库会显著增大 fact payload；manifest 归档已有容量约束，需要在实现时验证单账号 policy 文档的总体积。
