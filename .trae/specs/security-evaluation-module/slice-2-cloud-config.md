# Slice 2 实施规格：CLOUD_CONFIG（tasks.md Phase 4.1）

Status: 待批准
设计真源：ADR-027（已采纳方向，用户 2026-10-26 "执行吧" 批准）；本文件只固化实施级决策，不重复论证。

## 实施级决策（ADR-027 未细化的点）

### E1. 端口返回采集信封而非裸数组

ADR-027 D1 的 `collectFacts(subject) → CloudConfigurationFact[]` 是形状速写；为承载 D6 的"单控制项失败 → skipped"，端口实际返回：

```text
CloudConfigurationFactCollection {
  facts: CloudConfigurationFact[];              // { factType, factKey, value }
  failures: { factType: string; factKey?: string; reason: string }[];
}
```

`factKey` 缺失 = 该 factType 整体失败（账号级）；携带 = 单资源失败（如某个 bucket 的子调用报错）。

### E2. skipped 桶条目身份

骨架 `validateCoverageStats` 要求 skipped.total > 0 时必须有 note 且 items.length === total。条目格式：

- 账号级失败：`<criterionKey>`（如 `cis-1-13`）
- 资源级失败：`<criterionKey>:<factKey>`（如 `cis-2-1-1:my-bucket`）

由 evidence provider 按 rulebook 的 `requiredFactTypes` 把 failures 映射到控制项。judgment 不再重复记录 skipped（缺失的 fact 天然不产 finding）。

### E3. run FAILED 的精确条件

- `facts.length === 0 && failures.length > 0` → evidence provider 抛 BadRequestException（全部不可采集，禁止真空洁净）。
- `collectFacts` 整体抛错（凭证未配置/AssumeRole 失败）→ 原样传播 → run FAILED。
- 采集成功但账号零资源不算失败：IAM 两个账号级 fact（password-policy 的 exists:false 也是 fact、root-credential）保证成功采集时 facts ≥ 2。

### E4. 事实 payload 契约（模块拥有，宿主照产）

| factType | factKey | value |
|---|---|---|
| `aws.iam.account-password-policy` | `account-password-policy` | `{ exists, minimumPasswordLength: number\|null, maxPasswordAgeDays: number\|null, expirePasswords: boolean }`（全局） |
| `aws.iam.root-credential` | `root` | `{ passwordEnabled, mfaActive, activeAccessKeyCount }`（全局） |
| `aws.iam.user-credential` | userName | `{ userName, passwordEnabled, mfaActive }`（全局，per user） |
| `aws.s3.bucket-security` | bucketName | `{ bucketName, region, publicAccessBlock: { configured, blockPublicAcls, ignorePublicAcls, blockPublicPolicy, restrictPublicBuckets } \| null, policyIsPublic, aclPublic, encryptionEnabled }` |
| `aws.rds.instance-security` | identifier | `{ identifier, region, publiclyAccessible, storageEncrypted }` |
| `aws.ec2.security-group-ingress` | groupId | `{ groupId, region, publicIngress: [{ protocol, fromPort: number\|null, toPort: number\|null, cidr }] }` — 只收公网 CIDR（0.0.0.0/0、::/0）规则，空数组 = 无公网入站 |

manifest item：`id = cloud:<factType>:<factKey>`，`layer="fact"`，`source="cloud-account"`，`payload = { factType, ...value }`。

### E5. 十条控制项的判定语义（rulebook 纯函数，PASS 不产 finding）

| criterionKey | severity | requiredFactTypes | FAIL 条件 | resourceKey |
|---|---|---|---|---|
| cis-1-4 | HIGH | root-credential | activeAccessKeyCount > 0 | `root` |
| cis-1-5 | HIGH | root-credential | passwordEnabled && !mfaActive | `root` |
| cis-1-8 | MEDIUM | user-credential | per user: passwordEnabled && !mfaActive | userName |
| cis-1-13 | MEDIUM | account-password-policy | !exists \|\| (minLength ?? 0) < 14 | `account-password-policy` |
| cis-1-15 | MEDIUM | account-password-policy | !exists \|\| !expirePasswords \|\| !maxPasswordAgeDays | `account-password-policy` |
| cis-2-1-1 | MEDIUM | bucket-security | per bucket: !encryptionEnabled | bucketName |
| cis-2-1-2 | HIGH | bucket-security | per bucket: PAB 缺失/任一旗 false \|\| policyIsPublic \|\| aclPublic | bucketName |
| cis-2-3-1 | HIGH | instance-security | per instance: publiclyAccessible \|\| !storageEncrypted | identifier |
| cis-4-1 | HIGH | security-group-ingress | per SG: 存在 protocol="-1" 或覆盖敏感端口(22,3389,3306,5432,6379,27017,9200)的公网规则 | groupId |
| cis-4-2 | MEDIUM | security-group-ingress | per SG: publicIngress 非空 | groupId |

fingerprint = `aws:<criterionKey>:<resourceKey>`（版本无关）。finding.metadata = `{ controlId, resourceKey, factType, region?, urgency }`。severity 从 criterion.metadata 读（seed 与 rulebook 同源，测试断言一致）。urgency = deriveUrgency(severity, "internal")。

### E6. exposure 词汇扩展

`SecurityEvaluationExposure` 增加 `"internal"`；`deriveUrgency` 仅 development 有一档 relief，internal 与 production 同权重。改动 urgency.ts 里"cloud reachability lands with the next judgment family"的注释。

### E7. 宿主 SubjectProvider 改名

`ProjectRepositorySubjectProvider` → `ProjectSubjectProvider`（文件 `project-subject.provider.ts`）：它现在枚举 repository 与 cloud-account 两类 subject，旧名已失真。cloud-account 枚举：`awsCrossAccountBinding`（projectId = scopeId 且 roleArn 非空）→ 每绑定一 subject，`subjectKey = binding.id`，`displayName = awsAccountId ?? roleArn`，`metadata = { awsAccountId, defaultRegion, regions }`。宿主采集器经 `subject.scopeId`（即 projectId）调 `resolveProjectCredential`。

## registry 改动清单（packages/modules/security-evaluation/）

新增：

1. `ports/cloud-configuration-access.port.ts` — token `SECURITY_EVALUATION_CLOUD_CONFIGURATION_ACCESS`、`CloudConfigurationFact`、`CloudConfigurationFactCollection`、`CloudConfigurationAccess.collectFacts(subject)`（未绑定即装配错误，与 RepositoryAccess 同语义）
2. `judgment/cloud-config/security-evaluation-cloud-config.identity.ts` — `cloudConfigFingerprint`、`cloudConfigEvidenceId`
3. `judgment/cloud-config/security-evaluation-cloud-config.rulebook.ts` — 10 条控制定义（criterionKey/controlId/name/severity/remediation/requiredFactTypes）+ 纯判定函数
4. `judgment/cloud-config/security-evaluation-cloud-config.judgment.ts` — 从 evidence items 重建类型化 fact → 逐控制判定 → findings + evaluatedRefs
5. `evidence/security-evaluation-cloud-config-evidence.provider.ts` — ensureAsset → collectFacts → upsert AssetFact + manifest items → failures 映射 skipped（E2）→ E3 全失败护栏 → declaredUnlinked 恒 `{ total: 0 }`
6. `security-evaluation-cloud-config-rulebook.test.ts` — 10 控制 PASS/FAIL 纯函数用例
7. `security-evaluation-cloud-config-judgment.test.ts` — 判定装配（fingerprint 稳定、severity 来自 criterion metadata、evaluatedRefs 归属）
8. `security-evaluation-cloud-config-evidence.provider.test.ts` — failures→skipped 映射、全失败抛错、部分失败并存

修改：

9. `security-evaluation.constants.ts` — 6 个 factType 常量 + `SECURITY_EVALUATION_CLOUD_CONFIG_CRITERIA_VERSION = "v1"`
10. `criteria/security-evaluation-criteria.seed.ts` — 拆出 per-baseline ensure；新增 `ensureCloudConfigBaseline()`（kind=cloud-account、family=cis-aws-1.5、v1、10 条 ASSERTION，metadata 含 controlId/severity/remediation/requiredFactTypes/benchmark）；onModuleInit 播种两条基线
11. `criteria/security-evaluation-criteria.provider.ts` — cloud-account 分支返回 cis-aws-1.5/v1
12. `judgment/security-evaluation-judgment.service.ts` — family 分发追加 cis-aws-1.5
13. `judgment/security-evaluation-urgency.ts` — exposure 加 "internal"（E6）
14. `security-evaluation.module.ts` — 注册新 provider + cloud-account 三个 kind-scoped token 绑定（judgment 用 useExisting 复用同一 dispatcher）
15. `security-evaluation-run.service.ts` — 删除"仅 repository"400 护栏
16. `README.md` — cloud-account 词汇、factType 清单、端口绑定、skipped 口径

骨架（packages/modules/evaluation/）零改动。无 schema 变更、无新 HTTP 端点、无 DTO 变更（前端不动、不重跑 apits）。

## 宿主改动清单（nightwatch-backend src/application/security-evaluation/）

1. 新增 `aws-cloud-configuration-access.ts` — 按 E4 采集：IAM（GetAccountPasswordPolicy 的 NoSuchEntity → exists:false；Generate/GetCredentialReport CSV → root + per-user）、S3（ListBuckets + 逐 bucket 四项子调用，子调用失败 → 该 bucket 进 failures）、RDS/EC2 按 binding.regions 逐区域（DescribeDBInstances / DescribeInstances→DescribeSecurityGroups，只保留公网入站规则）；每组 try/catch 进 failures；SDK client 按 bindingId+service+region 缓存
2. `project-repository-subject.provider.ts` → `project-subject.provider.ts`（E7 改名 + cloud-account 枚举）
3. `security-evaluation-wiring.module.ts` — 引入 AwsIdentityModule（若已 @Global 则免）、绑定 `SECURITY_EVALUATION_CLOUD_CONFIGURATION_ACCESS` → `AwsCloudConfigurationAccess`、更新 provider 名

`src/modules/` 下的一切由 newbie 装配同步，不手改。

## 验证

1. registry：容器内 `npm run format:check` + 三个新测试 + 既有五个测试回归
2. 装配：刷新容器 registry 缓存 → `NEWBIE_MODULES_REF=origin/dev npx newbie modules update -y --force` → registry↔backend `src/modules/security-evaluation` diff 为空
3. `tsc --noEmit` → `nest build` → 干净重启 backend 容器（无 schema 变更，跳过 db push）
4. E2E（真实 AWS 绑定）：sync → 断言 cloud-account subject 出现 → POST run → 轮询至 SUCCEEDED → result coverageStats 三桶取证 → findings 列表（含 fingerprint 形态）→ report。采集不可达路径按 D6 落 skipped 也留证
5. 双仓显式路径提交（registry + backend）→ HTTP/1.1 push → fetch 核对 → 勾 tasks.md 4.1
