# ADR-070: security-evaluation 素材目录内聚到模块（repository / aws-account）

状态：已采纳
日期：2026-11-15
归属：框架层（registry `packages/modules/security-evaluation`）；宿主侧实施另起 nightwatch-backend ADR
关联：newbie-modules ADR-066（web-origin subject kind）、ADR-068（无 scope 的 subject 身份）、ADR-069（subject ownership type）、ADR-027（CLOUD_CONFIG 端口）；nightwatch-backend ADR-037（Layer 1 subjectKey，本 ADR 部分取代）、ADR-039（平台级建模）、ADR-044（web-origin 宿主实施）
决策记录：2026-11-15 用户「我想把 repository、weborigin、aws-account 都存到 se 模块里」；三个决策点拍板：形态 = A 素材目录、subjectKey = 自然键、退役 = 清空数据库。

## 背景

三个 subject kind 的素材身份当前分散在三处（取证见下表），导致模块无法自持"评估谁"：

| 素材 | 身份真源 | subjectKey | 归属 |
| --- | --- | --- | --- |
| web-origin | `SecurityEvaluationWebOrigin` | 规范化 origin | 已在模块（ADR-066） |
| repository | 宿主 `Repository`（`@@schema("application")`，被 `Application.repositoryId` 外键引用） | `repository.id` | 宿主 |
| aws-account | aws-identity 的 `AwsCrossAccountBinding`（多模块共用凭证真源） | `binding.accountId` | registry `aws-identity` |
| subject 本体 | `EvaluationSubject`（`module/evaluation`） | — | registry `evaluation`（通用契约） |

后果：`RepositoryAccess` / `RepositorySnapshotAccess` 的宿主实现必须读宿主 `Repository` 表才知道 provider 与 URL；`AwsConfigAccess` 必须解析宿主凭证策略。每个接入 SE 的宿主都要重写一遍这些读取，模块无法做到"加模块即用"。

## 候选方案

1. **什么都不做**：只有 web-origin 在模块，宿主继续提供全部访问实现。
2. **A 素材目录**：模块新增 repository / aws-account 素材表，以自然键去重；宿主 `Repository` 与 `AwsCrossAccountBinding` 仍作为各自领域的真源保留。
3. **B 物理搬迁真源表**：`Repository` 从宿主 `application` schema、`AwsCrossAccountBinding` 从 aws-identity 搬入 SE。

## 决策

选定 **A + 自然键 + 退役走清库**。

决定性理由：B 会把 aws-identity 的凭证真源变成 SE 的从属，迫使 cloudwatch / s3 / ses / sqs / secrets-manager / cloudformation 六个消费者跨模块读 SE 的 schema，模块表所有权被破坏；A 在不改变任何消费者数据源的前提下，把"评估谁"收进模块。

### D1. 模块新增两张素材表

与 `SecurityEvaluationWebOrigin` 同构：只存"评估特有"字段，身份仍落在 `EvaluationSubject`（`subjectType = "security-evaluation"`、`kind`、`subjectKey`、`displayName`、`credentialRef`），不复制通用身份。

```prisma
model SecurityEvaluationRepository {
  id        String   @id @default(uuid()) @db.Uuid
  // EvaluationSubject.id in "module/evaluation"; scalar, no FK
  subjectId String   @unique @db.Uuid
  provider  String   @db.VarChar(32)   // github | bitbucket | …
  // Vendor-neutral split of the repository coordinate: GitHub owner/org/user
  // and Bitbucket workspace both map to namespace.
  namespace String   @db.VarChar(255)  // lowercase
  name      String   @db.VarChar(255)  // lowercase
  url       String?  @db.VarChar(255)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([provider, namespace, name])
  @@schema("module/security-evaluation")
}

model SecurityEvaluationAwsAccount {
  id            String   @id @default(uuid()) @db.Uuid
  subjectId     String   @unique @db.Uuid
  accountId     String   @unique @db.VarChar(12)
  defaultRegion String?  @db.VarChar(32)
  regions       String[]
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@schema("module/security-evaluation")
}
```

`credentialRef` 不复制到素材表：它在 `EvaluationSubject` 上已有唯一位置，模块只作不透明指针透传。

### D2. subjectKey 改为自然键

| kind | subjectKey | 说明 |
| --- | --- | --- |
| `repository` | `${provider}:${namespace}/${name}` | provider、namespace、name 全部小写规范化；displayName 保留原始大小写 |
| `aws-account` | `accountId` | 已是自然键，不变 |
| `web-origin` | 规范化 origin | 不变（ADR-066） |

本决策**部分取代** nightwatch-backend ADR-037 Layer 1 中 `repository` 的 `subjectKey = repository.id`，以及"Repository 表 id 作为 subject 身份"的设计。其余 kind 与三层命名不变。

### D3. ingest 是素材唯一写入口

宿主把"项目里出现的仓库 / 项目绑定的 AWS 账号"上报给模块（扩展现有 `POST /security-evaluation/subjects/sync` 载荷，携带 `provider`/`namespace`/`name` 或 `accountId`），模块按自然键在同一事务内 upsert `EvaluationSubject` + 素材行。模块不反向读宿主表。

### D4. 端口与适配器

- `RepositoryAccess` / `RepositorySnapshotAccess`：契约不变。由于 `subjectKey` 已自带 provider + namespace + name，宿主实现不再需要读宿主 `Repository` 表，退化为"按 provider 调对应 code-host 客户端"。是否把默认实现搬进模块（registry 已有 `github` / `bitbucket`）作为后续实施决策，不在本 ADR 范围。
- `AwsConfigAccess`：仍为端口。凭证解析（跨账号 AssumeRole、externalId）是宿主策略，不在模块复制。
- `VerificationFetchAccess`：仍为端口。出网策略归宿主（ADR-044 §2 不变）。

### D5. 退役语义不设计

素材退役不引入删除 / 归档 / 上报移除语义。切换与清理一律清空数据库重建（2026-11-15 用户拍板：nightwatch 虽已上线，但处于调试期，数据库内容可丢弃）。因此本决策不写数据重写脚本，也不保留旧 subject 历史。

### D6. 宿主真源表保留

`Repository` 继续归宿主（`Application.repositoryId`、provisioning 生命周期不变），`AwsCrossAccountBinding` 继续归 aws-identity。模块素材行是评估侧的独立身份，与宿主表不建 FK、不共享 id，只由 ingest 单向同步（宿主 → 模块）。

### D7. 项目归属不回到模块

`ProjectWebOrigin` 等项目归属继续留在宿主；模块不恢复 provenance / asset-source 表（维持 ADR-068 D8）。

## 跨宿主 / 演进检验（registry 模块设计必填）

| 维度 | 框架层（模块） | 宿主层（nightwatch 等） |
| --- | --- | --- |
| 素材身份 | 自然键 + 模块素材表，无宿主实体名 | 上报 `provider`/`namespace`/`name`、`accountId`；不传主键 |
| subjectKey | `provider:namespace/name` / `accountId` / 规范化 origin | 由 ingest 填写，模块校验与规范化 |
| 凭证 | 只存不透明 `credentialRef` | 解析任意凭证体系（aws-identity、实例角色、静态密钥） |
| 出网 | 端口 | 各自实现（SSRF 守卫、出口策略、sidecar） |
| 退役 | 不做语义 | 清库重建或自行停用素材行 |

换一个宿主：只要它能给出自然键与凭证指针即可接入，不再需要提供 `Repository` 表或 aws-identity 绑定模型。

## 影响

- **取代**：nightwatch-backend ADR-037 Layer 1 的 `repository` subjectKey 格式（部分取代，其余不变）。
- **数据**：`EvaluationSubject` 行按自然键重建；按 D5 清库，不写数据重写脚本。
- **宿主**：`ProjectSubjectProvider` 与 `subjects/sync` 载荷改为自然键 + 素材字段（`Repository.fullName` 无需改表，ingest 时拆成 `namespace`/`name`；GitHub 适配器已有 owner/repo 解析结果）；两个 repository access 实现去掉对 `Repository` 表的依赖。
- **模块**：新增两张素材表、ingest 校验与规范化、行为级测试（自然键幂等、provider/namespace/name 大小写规范化去重、同一仓库多项目上报只产生一行）。
- **风险**：自然键的代价是仓库改名后形成新 subject，历史不自动延续；调试期按 D5 可接受，不设计重命名追踪。宿主真源与模块素材行也可能漂移（改名 / 删除仓库）。缓解：ingest 为唯一写入口，枚举以宿主输入为准；不做反向同步。
- **前端**：无变化（`subjectId` 仍是不透明 id）。

## 非目标

- 不搬 `AwsCrossAccountBinding` 或 `Repository` 进模块。
- 不恢复 provenance / asset-source 表。
- 不做素材删除 / 归档 API。
- 不改 web-origin 已生效的 ADR-066 契约。
