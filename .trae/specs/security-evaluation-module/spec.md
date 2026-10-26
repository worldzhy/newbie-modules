# Spec: security-evaluation 模块落地（evaluation 骨架第二个 feature）

Status: DRAFT — pending approval
Decision sources: ADR-020（骨架契约）、ADR-022（安全板块重建决策）、ADR-018（情报相关性护栏）、ADR-023（run config 透传）、ADR-024（work-evaluation 先例）

## 1. 背景与现状

ADR-022 已决定新建 `security-evaluation`（feature），建在 `evaluation` 骨架上，资产清单成为第一等实体，三种判定机制（DEPENDENCY / CLOUD_CONFIG / INTEL）共用一套 run 与 finding 生命周期，报告多轴、不合成总分。三个旧模块（`dependency-scan` / `aws-audit` / `threat-intelligence`）原样保留、并存运行，本模块只做加法、不迁移旧数据、不混报告。

本 spec 把 ADR-022 落成可执行规格，并切出交付顺序。取证结论（文件:行）：

| 旧模块 | 现表 | 现判定 | 可复用 | 必须解耦 |
| --- | --- | --- | --- | --- |
| `dependency-scan` | `DependencyScan` / `DependencyScanFinding` | `package-lock.json` v2+ 解析 → OSV `querybatch` → `vulns/{id}` 详情；fingerprint `applicationId:package:vulnId`；未复现即 resolved | lockfile 解析、OSV 客户端、severity 提取、fingerprint 语义、`limitations` 诚实声明 | `applicationId` / `projectId` / `github` 直连（改为端口）；进程内 `activeScans` |
| `aws-audit` | `AwsAuditProjectSetting` / `AwsAuditScan` / `AwsAuditFinding` | IAM/S3/EC2-SG/RDS 枚举 + 18 条规则判定；`ruleIdToCisControl`（模块内）与 `CIS_CONTROL_CATALOG`（宿主内）两份清单 | 18 条规则判定函数、资源枚举、`report.limitations`、fingerprint 语义 | `projectId`、aws-identity 凭证解析路径、宿主 compliance 清单 |
| `threat-intelligence` | `ThreatIntelligenceItem` / `ThreatIntelligenceMatch` | 采集 + 硬召回 + LLM 精排（ADR-018 护栏） | 采集管线、硬召回、精排护栏、`ScopeEntitiesProvider` 契约 | 90 天 / 每源 1000 条保留策略（漏洞知识需长期留存） |

## 2. 待拍板决策（3 项）

### 决策 1：骨架 subject 的粒度

- **A（推荐）subject = 资产**：`kind` ∈ `repository` / `cloud-account`，`scopeType`/`scopeId` 由宿主赋义（nightwatch 用 `project`）。一次 run 评一个资产，覆盖率、finding 身份、资产差异天然成立；报告按 scope 聚合。
- **B subject = 项目**：一次 run 评整个项目，资产降为 run 内证据。intel 相关性最接近旧行为，但 finding 指纹必须手工编码资产身份，覆盖率只能算项目级总数。
- 依据：ADR-022「跨宿主检验」表首行明确「被评主体 kind ∈ REPOSITORY / CLOUD_RESOURCE」，且 D2 要求资产是第一等持久化实体。选 B 会让 `EvaluationSubject` 与 `Asset` 语义打架。

### 决策 2：规则目录的落点（Rule 表 vs 准则）

- **A（推荐）规则 = `EvaluationCriterion`**：CIS 规则作为 `family=cis-aws-1.5` 的 ASSERTION 准则，`ruleId` 即 `criterionKey`，`metadata` 携带 `controlId` / `severity` / `factRequirements` / `remediation`。合规报告直接读 criteria + findings，双份清单的第二个来源消失。
- **B 独立 `Rule` 表（ADR-022 D7 字面）**：规则元数据单表，判定逻辑在代码里按 `ruleId` 注册。代价：准则清单与规则清单再次成为两份需要同步的真源，正是 ADR 背景第 4 条要消灭的问题。
- 若选 A，需要在 ADR-022 追加 Errata 一行说明 D7 的 `Rule` 表由 `EvaluationCriterion.metadata` 承载，不改正文。

### 决策 3：第一切片范围

- **A（推荐）资产清单 + DEPENDENCY 判定器 + 单轴报告 + 运行端点**：证明「资产 + 统一 finding 生命周期 + 覆盖率」模型成立，判定逻辑全部机械可复现，验证成本最低。
- **B 资产 + DEPENDENCY + CLOUD_CONFIG 同时**：一次补齐两个确定性判定器，但 CLOUD_CONFIG 需要宿主凭证与云枚举端口，首个里程碑体积翻倍。
- **C 先做 knowledge/ + INTEL**：语义判定不可机械复现，不适合作为证明骨架成立的第一切片。
- 切片 2 = CLOUD_CONFIG（含规则目录收敛、宿主 compliance 读模型）、切片 3 = knowledge/ + INTEL、切片 4 = 多轴报告（合规/情报/趋势/MTTR）与整改绑定。本条只决定第一切片，后续切片在各自里程碑再确认。

## 3. 模块定义

- key：`security-evaluation`；layer：`feature`；className：`SecurityEvaluationModule`
- `moduleDependencies`：`["evaluation", "security"]`（切片 2 追加 `aws-identity`；切片 3 追加 `llm`）
- Prisma schema：`module/security-evaluation`，模型前缀 `SecurityEvaluation`（`Asset` / `AssetFact` 为全局命名空间里的通用词，必须带前缀）
- 路由前缀 `/security-evaluation/...`；subject kind：`repository` / `cloud-account`（小写 kebab，沿用骨架 `work` 的先例；ADR 正文的大写写法视为概念名而非字面值）
- 准则 family：`dependency-osv`（切片 1）、`cis-aws-1.5`（切片 2）、`threat-intel-relevance`（切片 3）
- installation token / 宿主鉴权：沿用 `security` 模块的 platform JWT 权限矩阵，不新造 token 体系

## 4. 数据模型（切片 1）

```prisma
// 资产清单：与骨架 EvaluationSubject 一对一，本模块持有资产侧生命周期
model SecurityEvaluationAsset {
  id          String   @id @default(uuid()) @db.Uuid
  subjectId   String   @unique @db.Uuid   // 标量，无跨 schema relation
  naturalKey  String   @db.VarChar(512)   // repo: owner/name；cloud: accountId
  displayName String   @db.VarChar(255)
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())    // 最近一次被 run 观测到
  facts       SecurityEvaluationAssetFact[]
  @@index([naturalKey])
  @@schema("module/security-evaluation")
}

// 资产事实：当前态清单（非历史流水），历史由 result.manifest 快照承担
model SecurityEvaluationAssetFact {
  id            String   @id @default(uuid()) @db.Uuid
  assetId       String   @db.Uuid
  factType      String   @db.VarChar(64)    // "package" | "resource" | ...
  factKey       String   @db.VarChar(512)   // "npm:lodash@4.17.20" / resource arn
  value         Json?     @db.JsonB          // 小体量固有值：isDev、version、region、encryption…
  observedAt    DateTime
  asset SecurityEvaluationAsset @relation(fields: [assetId], references: [id], onDelete: Cascade)
  @@unique([assetId, factType, factKey])
  @@index([assetId, factType])
  @@schema("module/security-evaluation")
}
```

- 事实不带 `lastSeenRunId`：`EvidenceProvider` 契约拿不到 runId（收集先于 run 编排），run 归属由 `result.manifest` 快照表达。

- 事实是**当前态**：收集时 upsert，未再观测到的事实只保留旧 `observedAt`（自然暴露陈旧），不删除；「上次覆盖这次未覆盖」的差异由两份 `result.manifest` 对比得出。
- 切片 3 新增漏洞知识表（长期留存、按披露周期刷新），与旧 `ThreatIntelligenceItem` 的 90 天保留策略分离，不复用同一张表。
- 切片 4 的整改绑定直接用骨架 `EvaluationRemediationPlan`，本模块不建表。
- **不生成 migration 文件**（nightwatch 未上线，2026-10-26 规则）：schema 直接改片段，消费仓 `prisma db push` 对齐。

## 5. 端口实现

### 5.1 骨架四端口（按 kind 绑定）

| 端口 | 绑定方 | 切片 1 实现 |
| --- | --- | --- |
| `SubjectProvider` | 宿主 | 列出 scope 下的 repository / cloud-account |
| `CriteriaProvider` | 本模块 | 选择该 kind 已发布的最新 family 版本 |
| `EvidenceProvider` | 本模块 | 按 kind 收集资产事实并组装 manifest |
| `JudgmentPort` | 本模块（一个 dispatcher，按 `criteriaVersion.family` 路由） | `dependency-osv` → DEPENDENCY 判定器 |

骨架的 kind-scoped token 只允许一个绑定，因此 3 个 family 必须由同一 `SecurityEvaluationJudgmentService` 按 `criteriaVersion.family` 分派，不允许在 token 上想办法。

### 5.2 本模块自有的资产访问端口（宿主实现）

模块不直连 GitHub、不读宿主表、不持有云凭证：

```text
RepositoryAccessPort   getFile(asset, path): string | null        // 宿主用 github 模块实现
CloudAccountAccessPort enumerate(asset, regions): resource[]      // 切片 2，宿主用 aws-identity + SDK
```

宿主在装配时绑定 `securityEvaluationRepositoryAccessToken`。未绑定即报错（与骨架一样视为装配错误，不是运行时状态）。

### 5.3 准则种子

代码定义准则内容，模块初始化时幂等 seed：`(kind, family, version)` 不存在则创建并发布。`dependency-osv` 版本常量 `SECURITY_EVALUATION_DEPENDENCY_CRITERIA_VERSION`，准则一条 ASSERTION：`criterionKey=dependency-vulnerability`，`metadata={ ecosystem: "npm", osvApi: "https://api.osv.dev" }`。已发布版本永不原地修改；改准则即升版本。

## 6. DEPENDENCY 判定器（切片 1）

- **证据收集**（EvidenceProvider，kind `repository`）：
  - 经 `RepositoryAccessPort` 依次探测 `LOCKFILE_CANDIDATES`，解析 `package-lock.json` v2+ 的 `packages` 映射（只取 `node_modules/` 路径、去重 `name@version`、记录 `dev`）。
  - 每条事实 `factType="package"`、`factKey="npm:<name>@<version>"`、`value={ version, isDev }`；upsert 到 `SecurityEvaluationAssetFact`。
  - manifest item：`id="pkg:npm:<name>@<version>"`、`layer="fact"`、`source="lockfile"`、`summary` 只含包名+版本，`payload` 只放 `{ name, version, ecosystem, isDev }`。
  - `declaredUnlinked`：`package.json` 声明但 lockfile 未解析到的依赖（有 `package.json` 时才计算），带 note + item ids。
  - `skipped`：仅在判定阶段 OSV 批量查询失败的包（由判定端口产生）。**lockfile 缺失、解析失败、或解析出 0 个包时 run 直接失败**（`BadRequestException`），不产出空 evidence——空 evaluated 集合会被读成"干净"，而实际是没看到材料。
- **判定**（JudgmentPort）：
  - OSV `POST /v1/querybatch`（分批）→ 对命中包 `GET /v1/vulns/{id}` 取详情；结果按 `(package, vulnId)` 归并。
  - 每个命中产一条 finding candidate：`fingerprint="<ecosystem>:<packageName>:<vulnId>"`（不含 version —— 升级到仍受影响版本时 finding 保持 open，与旧模块语义一致）；`criterionKey="dependency-vulnerability"`；`severity` 从 OSV `database_specific.severity` / `severity[]` 提取，缺失即 `INFO` 并在 metadata 标注 `severitySource="unknown"`。
  - `metadata={ packageName, packageVersion, ecosystem, vulnerabilityId, isDev, aliases, fixedVersion, urgency, severitySource, detailAvailable }`。
  - `evaluatedRefs` = 实际完成查询的包 item ids；OSV 批量失败时把该批包列入 `skipped`（note 带 HTTP 状态），不静默丢弃。
  - `metadata`（result 级）= `{ osvQueriedAt, ecosystem, packagesQueried, packagesSkipped, vulnerabilityLookupFailures }`。
- **urgency 派生**（纯函数，`security-evaluation-urgency.ts`）：`urgency = f(severity, exposure)`；`exposure` 来自事实（`isDev=false` 视为生产暴露）。切片 1 只处理「生产依赖」这一个暴露因子，切片 2 扩展公网可达；不引入综合分。
- `limitations` 口径沿用旧模块（只解析 lockfile v2+、severity 来自 OSV 元数据、数据源 osv.dev），写进 result summary 与报告。

## 7. 报告读模型（切片 1，单轴）

`GET /security-evaluation/report?scopeType=&scopeId=` 返回：

- `assets`：资产数、最近观测时间、`staleAssets`（超过 `ASSET_STALE_AFTER_DAYS` 未观测）。
- `coverage`：取最新 result 的 `coverageStats`（evaluated / declaredUnlinked / skipped）与 manifest 计数。
- `findings`：按 severity、urgency、status 计数；`open` 列表按 urgency 降序。
- `trend`：按 `firstSeenAt` / `resolvedAt` 的周桶计数。
- `mttr`：`avg(resolvedAt - firstSeenAt)`，无已解决项时为 null。

不含总分字段、不做跨 family 加权合并（ADR-020 D5.3 / ADR-022 D6）。

## 8. HTTP 端点（切片 1）

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| POST | `/security-evaluation/subjects/sync` | platform JWT | 触发宿主 SubjectProvider 同步资产（幂等） |
| GET | `/security-evaluation/assets` | platform JWT | 资产清单（scope 过滤 + 分页） |
| GET | `/security-evaluation/assets/:assetId/facts` | platform JWT | 资产事实（factType 过滤 + 分页） |
| POST | `/security-evaluation/runs` | platform JWT | `{ subjectId, criteriaVersionId?, config? }` → 202，fire-and-forget |
| GET | `/security-evaluation/runs` | platform JWT | 按 subjectId 倒序查运行 |
| GET | `/security-evaluation/results` | platform JWT | 读归档结果（manifest / coverage / verdicts） |
| GET | `/security-evaluation/findings` | platform JWT | 发现列表（status / severity / family 过滤 + 分页） |
| GET | `/security-evaluation/report` | platform JWT | §7 读模型 |

DTO 命名遵循 `work-evaluation` 既有规则：请求 `ListSecurityEvaluationAssetsRequestDto`，响应 `SecurityEvaluationAssetResponseDto`，列表响应 `ListSecurityEvaluationAssetsResponseDto`；列表统一继承 `CommonListRequestDto` / `CommonListResponseDto`。全部 controller 写全 swagger 装饰器（`@ApiResponse({ type })`）供 apits 生成。

## 9. 调度声明

模块只导出声明常量，不注册 cron：

```text
SECURITY_EVALUATION_SCHEDULES = [
  { family: "dependency-osv", recommendedInterval: "daily", subjectKind: "repository" },
  { family: "cis-aws-1.5",    recommendedInterval: "daily", subjectKind: "cloud-account" },
  { family: "threat-intel-relevance", recommendedInterval: "hourly", subjectKind: "repository" },
]
```

宿主装配决定 cron 与触发条件；模块 README 写明。

## 10. 并存边界

- 不读、不写三个旧模块的任何表；不消费旧模块的 findings。
- 报告不与旧 `project-security` 聚合混入同一份响应或同一评分分母（ADR-022「并存与切换边界」）。
- 旧模块的 `ruleIdToCisControl` / `CIS_CONTROL_CATALOG` 在切片 2 才收敛；切片 1 不触碰。

## 11. 文件清单（切片 1，`packages/modules/security-evaluation/`）

```text
newbie.module.json
prisma/schema.prisma
security-evaluation.module.ts
security-evaluation.constants.ts
security-evaluation.controller.ts
security-evaluation.dto.ts
assets/security-evaluation-asset.service.ts
assets/security-evaluation-asset-sync.service.ts
ports/repository-access.port.ts
criteria/security-evaluation-criteria.provider.ts
criteria/security-evaluation-criteria.seed.ts
evidence/security-evaluation-evidence.provider.ts
judgment/security-evaluation-judgment.service.ts
judgment/dependency/security-evaluation-lockfile.ts        （纯函数）
judgment/dependency/security-evaluation-osv.client.ts
judgment/dependency/security-evaluation-dependency.judgment.ts
judgment/security-evaluation-severity.ts                   （纯函数）
judgment/security-evaluation-urgency.ts                    （纯函数）
reporting/security-evaluation-report.service.ts
README.md
security-evaluation-lockfile.test.ts
security-evaluation-urgency.test.ts
security-evaluation-fingerprint.test.ts
```

## 12. 测试

registry 侧（无 DB，`node --import tsx --test`）：

- lockfile 解析：v2/v3、`dev` 标记、重复路径去重、缺 `packages` 时明确报错。
- fingerprint：同包同 vuln 跨版本稳定；不同 vuln / 不同包不碰撞。
- urgency：severity × isDev 矩阵；未知 severity 降级路径。
- 覆盖率桶组装：复用骨架 `composeCoverageStats`，校验 skipped 必须带 note + items。

消费仓侧（装配后，DB 行为测试，按关键路径覆盖规则）：

- finding 生命周期：首次出现、跨 run 保持 open、未复现即 resolved、复现不覆盖人工 suppression。
- 覆盖率口径：OSV 批次失败 → 包进入 skipped 且 run 仍成功、报告可解释。
- run 并发：同一 subject + version 第二个请求 409（依赖骨架 + 消费仓部分唯一索引）。
- 口径：漏测一个分支即视为未完成。

## 13. 不在本切片

- CLOUD_CONFIG 判定器、CIS 规则目录收敛、宿主 compliance 读模型（切片 2）。
- knowledge/ 采集与 INTEL 判定、漏洞知识长期留存（切片 3）。
- 多轴报告、整改计划端点、通知模板（切片 4）。
- nightwatch-backend / frontend 装配与切换（ADR-022 明确单独排期）。
- 旧模块下线、数据迁移、前端页面。

## 14. 待定（实现时按默认处理，不阻塞）

- `ASSET_STALE_AFTER_DAYS` 默认 7。
- 资产在宿主侧消失后的处置（当前与骨架 subject 一致：不删除；需要删除语义时走新决策）。
- OSV 批量大小 / 并发沿用旧模块常量（`QUERY_BATCH_SIZE` / `VULN_DETAIL_CONCURRENCY`），迁入本模块常量文件。
