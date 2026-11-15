# ADR-068: 删除 evaluation 主体的 scope 坐标，身份收敛为 `(kind, subjectKey)`

状态：已采纳（2026-11-15 用户批准）
日期：2026-11-14

> 归属：registry 契约变更（`packages/modules/evaluation` 的表结构与端口形状）→ 本仓。宿主实施（枚举入口、对外 API、存量数据迁移）归 nightwatch-backend，随本决策同步改造。

Supersedes: ADR-020 D1 中 `EvaluationSubject` 的「`kind` + 泛化坐标（`scopeType`/`scopeId`）」与 D4 的 `SubjectProvider` 端口行，以及背景第 2 段「泛化坐标沿用 ADR-018 先例」的理由；ADR-031 的审核层四元组——删除 `reviewedByRef` 后只剩 `reviewStatus` / `reviewedAt` / `reviewNote`（D6）。ADR-020 其余章节（D2 结论形态、D3 零宿主依赖、D5 不变量）保持生效。

修订：ADR-022、ADR-024、ADR-026、ADR-027 中「宿主实现 `SubjectProvider` 并给出 scope 坐标」的表述（另含 ADR-022 第 53 行资产清单「加 `naturalKey` 与泛化 scope 坐标」，该表由 D7 整表删除）；ADR-039「跨宿主 / 演进检验」表中「`scopeType`/`scopeId` 保持泛化无 FK」与「归属记在 provenance」两句（后者由 D8 删除该表取代）；ADR-058「跨宿主 / 演进检验」表中「主体坐标 = 模块常量 `platform:deployment` 不变」一行，以及 D2.3 的负缓存键存储（`${kind}:${subjectKey}` 单列字符串 → `subjectKind` + `subjectKey` 两列，逻辑键不变）；ADR-045 中「per (knowledge item, scope)」的 scope 表述（`scopeKey` 拆为 `subjectKind` + `subjectKey`，键语义不变）。上述 ADR 正文不改，新语义由本 ADR 承接。

## 背景

**契约前提：evaluation 与 project 完全解耦，模块不认识 project。** 骨架只接收「一个 kind 下、key 唯一的主体」，不接收任何宿主来源标识；谁提交了哪个资产、属于哪个项目，全部由宿主自己持有，模块从不过问。这条前提是删除坐标的第一性依据：`scopeType` / `scopeId` 是骨架里唯一能让宿主把「宿主自己的维度」塞进主体身份的槽位，而主体身份本就不该携带宿主维度。

`EvaluationSubject` 的身份是四元组 `(kind, scopeType, scopeId, subjectKey)`（`evaluation/prisma/schema.prisma:135-166`，唯一键 `@@unique([kind, scopeType, scopeId, subjectKey])`）。契约层把这个坐标称为「宿主赋义的泛化作用域」，`EvaluationScope` 出现在 descriptor、subject ref 与 `SubjectProvider` 端口三处（`ports/evaluation.contracts.ts:20-22, 37-38, 49-50`；`ports/subject.provider.ts:14`）。

平台化（ADR-039）之后，这个坐标失去了区分能力，三个取证：

1. **写入侧全是常量。** `SecurityEvaluationAssetService.ingest()` 不读提交方 scope，无条件写 `platform` / `deployment`（nightwatch-backend `assets/security-evaluation-asset.service.ts:97-105`）；`SecurityEvaluationWebOriginService.create()` 相同。security-evaluation 的全部 subject 都落在一个坐标上。
2. **person subject 里 `scopeId` 与 `subjectKey` 同值。** `WorkEvaluationRunService.startRun()` 写 `scopeType: "user"`、`scopeId: user.id`、`subjectKey: user.id`（nightwatch-backend `work-evaluation-run.service.ts:74-80`）。四元组里两个值重复、一个常量、真正提供区分度的只有 `kind` 与 `subjectKey`。
3. **项目维度已经有正规的家。** 谁提交了哪个资产，权威来源是宿主的项目枚举器（`ProjectSubjectProvider`）——模块从不解释 `scopeId`，契约注释自己写明它不携带外键（`evaluation-subject.service.ts:24-27`），`scopeType` / `scopeId` 只是这个宿主维度的无条件影子副本。那个"家"是否还需要在模块内落一份缓存副本，是 D8 回答的问题——结论是不需要，provenance 一并删除。

框架侧的读取面同样是空的：

- `EvaluationRunService.listRuns` 与 `EvaluationFindingService.listFindings` 按主体 scope 过滤（`evaluation-run.service.ts:248-256`；`evaluation-finding.service.ts:217-224`），但宿主两个控制器都不传值：security-evaluation 先用 provenance 解析成 `subjectIds` 再查（`security-evaluation.controller.ts:143-151, 179-187`；D8 后这一步改为按项目枚举主体），work-evaluation 的 runs/findings 请求 DTO 没有 scope 字段。
- `EvaluationSubjectService.syncSubjects()` 是框架内唯一调用 `EvaluationScope` 的地方（`evaluation-subject.service.ts:85-89`），全仓零调用——宿主绕过了端口，直接注入 provider 自己枚举（nightwatch-backend `scheduled-jobs/tasks/security-evaluation.scan.job.ts:92-97`）。
- registry 内没有任何 provider 读 `subject.scopeType` / `subject.scopeId`，只有 `toSubjectRef` 自己在写。

还有一条既有收敛线：ADR-058 D2.3 已把最需要区分度的键——INTEL 负缓存——改为 `${subject.kind}:${subject.subjectKey}`（`security-evaluation/judgment/intel` 的共享 helper），不再使用 scope 列。当时还在两个地方拼 `platform:deployment` 正是缺陷来源（ADR-058 背景）。删除坐标是沿着这条线走完最后一步。

## 候选方案

- **A 保持现状**：两列继续作为「宿主赋义的泛化作用域」存在，当前全部填常量。代价不是存储，而是每次平台化改造都要绕开它：ADR-058 的 R3-01 就是因为「subject 坐标已迁移、实体供给仍按 project 枚举」而功能 100% 不可用；而且为了给这个槽位填一个不虚构的值，我们已经在讨论 `deployment` 是否恰当。
- **B 合并为单列可辨识联合**：`scope: "platform" | \`project:${string}\``，去掉两列冗余。问题是 `project` 是宿主概念，把它的字面量写进框架契约，等于用另一种形式承认「骨架认识 project」，与解耦前提直接冲突；而且仍然要回答「同 kind 跨 scope 时身份如何唯一」。
- **C 删除坐标，身份 = `(kind, subjectKey)`**，同时下线只为这个坐标存在的主体枚举端口。项目维度的归属问题交给已经在正确建模它的 provenance。

## 前提检验：若宿主不存在项目概念

把 Project 整个拿掉做一次反向检验。此时系统里只剩三类真实存在：外部资源（仓库、AWS 账号、web origin）、人、评估机器，没有「谁声明了它」这个动作，也就没有声明方、没有归属、没有按项目过滤。

结构坍缩为四层（以下为反事实推演：`source` / `enabled` 是本节假想列，现行 schema 中不存在）：

1. **清单层** — `SecurityEvaluationAsset(kind, naturalKey, source, enabled, firstSeenAt, lastSeenAt)`，唯一键 `(kind, naturalKey)`。三个写入者各自全量同步自己那一类（Git 主机、AWS 组织、人工注册），**每个 kind 只有一个权威写入者**——这条约束替代了「多个项目声明同一资源」的设定。（D7 之后此层整表删除：`naturalKey` / `displayName` 随身份归主体，`subjectId` 与两个时间戳也无保留价值，四层坍缩为三层。）
2. **身份层** — `EvaluationSubject(kind, subjectKey)`，与清单层 1:1（D7 后清单层不存在，主体即唯一实体）。person 主体不需要清单，run 由本人触发。
3. **评估层** — run / finding / remediation 只按 `subjectId` 挂载，不携带任何宿主坐标。
4. **消费层** — 结论按主体渲染，没有项目聚合视图。

三条随之消失的问题：

| 原问题 | 无项目时 |
|---|---|
| 扫描范围是什么 | 读 `enabled` 的资产，不再遍历声明。重复 ingest、第二次 `startRun` 撞唯一索引被 `logger.debug` 吞掉、`started/attempted` 按项目累计失真，同时消失 |
| 归属写在哪 | 没有第二方，provenance 的 `sourceId` 失去唯一来源 → 降级为资产上的 `source` 枚举列，N:M 表整个删除 |
| 谁回答「还该不该评」 | `lastSeenAt`：连续 N 次同步未出现即 `enabled=false`，停评但保留 run/finding 历史 |

这也说明 D1 / D3 / D4 / D5 在无项目前提下都是**更彻底的版本**：D3 的 provider 概念整体消失（枚举退化为一次清单查询），D4 的 provenance 表可直接删除，D5 的 `scopeType` / `scopeId` 参数不是改名而是删除。

代价是不能靠资产标签找回的部分：访问控制、通知路由、成本分摊，以及「同一仓库对 A 在范围内、对 B 不在」。因此这条假设只在一个组织、且看结论的人不需要按业务线切分时成立。

**边界线：Project 可以作为 evaluation 的消费者（读结论、做聚合、发通知）存在，不能作为身份维度，也不能作为声明来源。** 它一旦进入 `(kind, …)` 或 provenance 的 `sourceId`，本次删掉的东西就会以另一种名字长回来。

nightwatch 当前仍是有项目的宿主，所以 D1–D5 仍按「项目存在、只作消费者」的形态落地；本节记录的是这条边界线的依据，不代表要把项目从宿主里移除。

## 决策

选 **C**。

决定性理由：身份必须由「是什么」决定，而不是由「挂在谁下面」决定。当前数据里「挂在谁下面」要么是常量（security-evaluation），要么与「是什么」重复（work-evaluation）。一个恒为常量或恒等于 `subjectKey` 的列不承担任何唯一性职责，却要求每个新宿主、每个新 kind 都为它编造一个取值——它的存在本身在制造虚假的设计选择。

### D1. 数据模型

```prisma
model EvaluationSubject {
  id            String   @id @default(uuid()) @db.Uuid
  kind          String   @db.VarChar(64)    // 对象是什么：repository | aws-account | web-origin | developer
  subjectKey    String   @db.VarChar(255)   // 列宽不变（现为 VarChar(255)，不是 512）
  displayName   String   @db.VarChar(255)
  credentialRef String?  @db.VarChar(255)   // 宿主凭据指针，模块不解析
  metadata      Json?    @db.JsonB
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  runs             EvaluationRun[]
  results          EvaluationResult[]
  findings         EvaluationFinding[]
  remediationPlans EvaluationRemediationPlan[]

  // scopeType / scopeId 删除；原 @@index([kind, scopeType, scopeId]) 一并删除，
  // 唯一键的 kind 前缀已覆盖单列查询，不重建 @@index([kind])
  @@unique([kind, subjectKey])
}
```

`subjectKey` 保持 `VarChar(255)`：这次改动只删列，不趁机调整列宽。若 web-origin 的规范化 origin 将来超限，那是另一个决策。

`toSubjectRef` 与 `EvaluationSubjectRef` 同步删除 `scopeType` / `scopeId`。`EvaluationSubjectDescriptor` 只保留 `kind` / `subjectKey` / `displayName` / `metadata` / `credentialRef`。

### D2. 读路径

- `ListEvaluationSubjectsInput`：`kind` + 可选 `subjectKey` + 分页。
- `listRuns` / `listFindings`：删除 `scopeType` / `scopeId` 形参与对应的 `subject` where 分支。按主体收窄统一走 `subjectId` / `subjectIds`；`subjectIds` 由宿主解析后传入——D8 删除 provenance 后，宿主用 `ProjectSubjectProvider` 枚举出 `subjectKey` 集合，再换算为 `EvaluationSubject.id`，模块不做这一步。

### D3. 主体枚举：删除 `SubjectProvider` 端口与 `syncSubjects`（端口去留方案 b）

- 删除 `ports/subject.provider.ts`（含 `subjectProviderToken`）、`EvaluationProviderRegistry.getSubjectProvider()`、`EvaluationSubjectService.syncSubjects()`、`SyncEvaluationSubjectsInput`、`EvaluationScope`。
- 宿主 `security-evaluation.scan.job.ts` 直接注入 `ProjectSubjectProvider`，方法签名改为 `listSubjects(projectId: string, kind: string)`；`EvaluationWiringModule` 去掉 token 别名，直接 provide/export 该类。
- 理由：端口只因 `syncSubjects` 存在，而 `syncSubjects` 零调用。保留一个没有框架调用者的 SPI，等于把「谁拥有主体枚举」这个已由事实回答的问题继续悬空。骨架只负责**存取已经提交的主体**，枚举归宿主。

### D4. schema 迁移与数据处置（nightwatch-backend 执行）

**前提：生产库数据可弃。** nightwatch 仍处于调试期，evaluation / security-evaluation / work-evaluation 三个 schema（`module/evaluation`、`module/security-evaluation`、`module/work-evaluation`）的数据没有保留价值。因此本决策**不做存量归并**——原方案里逐表处理 `subjectId` 唯一约束碰撞、`triggerIds` 重写等工序全部取消，直接重建。

1. **迁移文件仍然必须生成。** schema 版本化是 ADR-036 的纪律，与数据是否有价值无关：`npx prisma migrate dev --name evaluation-subject-identity` 生成并提交 `prisma/migrations/**`（含 `migration_lock.toml`），CI 的 `migrate diff --exit-code` 必须为 0。禁止 `db push`。
2. **数据重建顺序**：清空上述三个 schema → 应用迁移 → 宿主重新提交主体（`newbie modules apply` 后触发一次 security-evaluation 扫描、一次 work-evaluation run，让 subject 与其下的 knowledge item / web-origin 重新落库；provenance 已由 D8 删除、asset 已由 D7 删除，均无落库动作）。
3. **明确放弃的东西**：生产上的 run 历史、finding 生命周期（含人工 suppress 的 `suppressionNote`）、`firstSeenAt` 基线、web-origin 的验证状态与 token。调试期接受这些丢失；上线后若再遇到同类 schema 变更，必须回到逐表归并方案。
4. **回滚**：迁移前的 PG 快照仍然建议保留（成本近零），但它不再是正确性依赖——正确性依赖是"数据可弃"这一前提本身。

### D5. 对外 API（宿主）

| 接口 | 变更 |
|---|---|
| `GET /work-evaluation/subjects` | 请求 DTO 删必填 `scopeType`；`scopeId` 改为可选 `subjectKey`（`work-evaluation.dto.ts:677-689`） |
| `GET /security-evaluation/assets` | 随 D7 整接口下线，连同 `listAssets` 与 `SecurityEvaluationAssetResponseDto`；本 ADR 不保留过渡期 |
| `GET /security-evaluation/runs`、`/findings`、`/report` | `scopeType`/`scopeId` 本来就不是主体坐标，而是既有 provenance 列 `sourceType`/`sourceId` 的 wire 别名（`assets/security-evaluation-asset.service.ts:136-140`）；它们随 scope 列一起删除的是「主体坐标」这一语义，不是参数本身——D8 删除 provenance 后失去数据来源，随之下线 |

第一处是 wire 变更，需 `npm run apits` 重新生成并同步前端消费点；D7 的 `/assets` 与 D8 的三个接口下线是第二批 wire 破坏性变更。

### D6. 字段命名、类型与冗余列收敛（2026-11-15 定稿）

四条规则，后面所有改名都由它们推出：

1. **`*Ref` 只指「宿主持有的不透明引用」**——本模块存字符串、不解析、不建外键。装本 schema 行 id 的用 `*Id`；装宿主用户 id 的用 `<动词>By`。
2. **`*At` 是时刻，`*On` 是日历日**（`@db.Date`）。让命名约定变成数据库约束，看类型就能判断粒度。
3. **限定词只在名词离开所属表时加**。`EvaluationSubject.kind` 保持 `kind`（表本身就是主体，`subjectKind` 重复表名）；`EvaluationRuleSetVersion.kind` 是「这套判据适用于哪类主体」→ 改 `subjectKind`；`EvaluationCriterion.kind` 是判据种类（SCORED / ASSERTION），与主体无关，保持 `kind`。
4. **操作者身份列只在值不可推导时存在**。若一列的写入值恒等于 `request.user.userId`，它不是业务事实，而是请求元数据的副本——直接删除，操作者归审计层。

**module/evaluation**

| 旧 | 新 | 理由 |
|---|---|---|
| `EvaluationRuleSetVersion.kind` | `subjectKind` | 引用的是主体类型，不是自己的种类 |
| `EvaluationRuleSetVersion.evaluationKey` | `standardKey` | 在 `module/evaluation` 里重复模块名；值是标准族（rubric、aws-cis-1.5） |
| `EvaluationRun.config` | `judgmentConfig` | 与框架的模块 `config` 撞词 |
| `EvaluationRun.error` | `failureReason` | 装的是文案，不是异常对象 |
| `EvaluationRun.requestedByRef` | `requestedBy` | 发起者 id，人（宿主用户 id）或调度器标识；唯一有差异化写入的操作者列 |
| `EvaluationResult.manifest` | `evidenceManifest` | 与 `manifestHash` 成对自解释 |
| `EvaluationResult.contentHash` | `manifestHash` | 原名为文件内容 hash 的通用词，与本表语义不一致 |
| `EvaluationResult.reviewedByRef` | 删除 | 值恒等于请求者，见下「删除三个操作者身份列」 |
| `EvaluationFinding.evaluationKey` | `standardKey` | 与 `RuleSetVersion` 同源同值，同步改 |
| `EvaluationFinding.detail` | `description` | 全 schema 只此一处用 `detail` |
| `EvaluationFinding.suppressedByRef` | 删除 | 同上 |
| `EvaluationRemediationPlan.triggerRefs` | `triggerIds` | 装的是本 schema 行 id，`Ref` 在此语义错 |
| `EvaluationRemediationPlan.deciderRef` | `decider` | 问责的决策人（名词） |
| `EvaluationRemediationPlan.decidedByRef` | 删除 | 同上；本表只保留 `decider` 与 `decidedAt` |
| `EvaluationRemediationPlan.startDate` / `dueDate` | `startOn` / `dueOn` | 二者都是日粒度，`*On` 与 `*At` 区分；格式从「动词不一致」变为同位 |

**module/security-evaluation**

| 旧 | 新 | 理由 |
|---|---|---|
| `SecurityEvaluationThreatKnowledgeItem.source` | `feed` | 全仓 `source` 有四种含义，这列是情报源 |
| `SecurityEvaluationThreatKnowledgeItem.fetchedAt` | `firstSeenAt` | 原注释承认它永远停在首次抓取时间，与 `lastSeenAt` 成对 |
| `SecurityEvaluationThreatVerdictCache.scopeKey` | 拆为 `subjectKind` + `subjectKey` | 不再拼 `"<kind>:<subjectKey>"` 字符串；两列与主体唯一键同构 |
| `SecurityEvaluationCodeScanVerdictCache.findings` | `cachedFindings` | 与 `EvaluationFinding` 表撞词 |
| `SecurityEvaluationCodeScanVerdictCache.ruleSetVersion` | `ruleSetVersionLabel` | 唯一用字符串而非 id 的版本列，标明它是标签 |
| `SecurityEvaluationWebOrigin.verificationFailures` | `verificationFailureCount` | 仓内计数一律 `*Count` |

`ThreatVerdictCache` 的拆列不改变逻辑键：ADR-058 的 `${kind}:${subjectKey}` 由一列字符串变为 `(subjectKind, subjectKey)` 两列，唯一约束同构，缓存仍能在主体行删除后命中。

**module/work-evaluation**

| 旧 | 新 | 理由 |
|---|---|---|
| `evaluateeUserId`（6 表 / 5 个唯一键 / 3 个索引） | `developerId` | 同一个人在本模块有三个名字（`kind=developer`、`evaluatee`、注释里的 `member`）；选说「是什么」的那个。不用 `developerUserId`（重复限定），不用 `developerRef`（`*Ref` 专指不透明字符串，这里是确定的 `User.id`） |
| `WorkEvaluationPeriod.type` | `phase` | COLLECTION / REVIEW 是阶段，不是类型 |
| `WorkEvaluationSession.source` | `transcriptSource` | 区分原始转录与 IDE 摘要，且与情报源的 `feed` 脱钩 |
| `WorkEvaluationSession.model` | `modelId` | 与 `CodeScanVerdictCache.modelId` 统一 |
| `WorkEvaluationDeclaredDocument.refPath` | `path` | 该列是路径，`Ref` 无含义 |

**保持不变（附理由，避免下一轮再讨论）**

- `firstSeenAt` / `lastSeenAt`：registry 多数派约定，health、backend-monitor、module-hub、security 的 installation 表都用这一对表示首次/末次上报。只改 evaluation 三兄弟会造出第五套词汇。含义统一为「首次/末次被系统观察到」。
- `credentialRef`：值形如 `aws-binding:<uuid>`，确由宿主 `resolveCredentialByRef()` 解析，是 schema 里唯一真正的引用。
- `EvaluationSubject.kind`、`EvaluationCriterion.kind`。

**`kind` 取值**：`repository` | `aws-account` | `web-origin` | `developer`。`developer` 是对象名而不是关系名——`evaluatee` 是「评估的对象叫被评估者」的循环命名，身份应由「是什么」决定。

**随本决策一起做的两处结构修正**（不属于改名）

- `EvaluationFinding.suppressedAt DateTime?`：现有 `resolvedAt` 没有对称的抑制时间，抑制时刻只能从 `updatedAt` 推断。
- `EvaluationFinding.firstSeenRunId` / `lastSeenRunId` 补 `@relation`（`onDelete: SetNull`）：同 schema 内的行 id 不应是裸标量。

**删除三个操作者身份列**（不属于改名）

`EvaluationResult.reviewedByRef`、`EvaluationFinding.suppressedByRef`、`EvaluationRemediationPlan.decidedByRef` 三列在写入侧恒等于 `request.user.userId`，在读取侧只是原样回传——没有筛选条件、通知或 read model 使用它们。按规则 4，它们不是业务事实，是请求元数据的副本，一并删除。

删除后的语义收敛：

| 表 | 保留 | 失去 |
|---|---|---|
| `EvaluationResult` | `reviewStatus` / `reviewedAt` / `reviewNote` | 「谁审的」 |
| `EvaluationFinding` | `suppressionNote` / `suppressedAt` | 「谁抑制的」 |
| `EvaluationRemediationPlan` | `decider` / `decidedAt` / `decisionNote` | 「谁点的关闭」 |

可追溯性边界（规则 4 依赖的前提，须写明）：宿主已有全局 `http-access.interceptor.ts`，审计行覆盖「谁在何时调用了哪个接口」，而判断内容本身就是业务列（`reviewStatus` / `reviewNote` / `suppressionNote` / `decisionNote`）——两者按「请求者 + 对象 id + 时间」拼接即可还原「谁写了这条结论」。代价是追溯要查两处、且受审计保留期约束。如果某个宿主要求结论行自证操作者，正确做法是它在本层用 `AuditLogService` 落一条业务审计，而不是让模块存一份请求元数据副本。三个模块的应用层目前都没有引入 `AuditLogService`，所以「归审计层」指的是 HTTP 访问审计已经覆盖的事实，不是承诺另有业务审计。

`EvaluationRun.requestedByRef` **不删**，它是唯一不可推导的操作者列：调度任务写入 `"scheduler:security-evaluation.intel"` 与 `"scheduler:security-evaluation.scan"`（`application/scheduled-jobs/tasks/security-evaluation.intel.job.ts:86`、`security-evaluation.scan.job.ts:128`），宿主的 copilot skill 也读取它（`application/copilot/skills/work-evaluation.skill.ts:38`）。按 D6 改名 `requestedBy`。

**wire 影响**：`standardKey`、`subjectKind`、`developerId`、`startOn` / `dueOn` 都会经 DTO 出现在响应里；判据列表接口的 `kind` 查询参数同批改 `subjectKind`。三个被删列同时从 `EvaluationResultResponseDto` / `EvaluationFindingResponseDto` / `EvaluationRemediationPlanResponseDto` 消失（`evaluation-decision.dto.ts:174,193,225`），security-evaluation 与 work-evaluation 复用这些响应 DTO 的映射点同步删（`security-evaluation.dto.ts:235`、`work-evaluation.dto.ts:622,668`）。全部需 `npm run apits` 重新生成并同步前端。

### D7. 删除 `SecurityEvaluationAsset`（2026-11-15 定稿）

整表删除，三个引用列改指主体：

```prisma
// module/security-evaluation
model SecurityEvaluationWebOrigin {
  // EvaluationSubject.id in "module/evaluation"; scalar, no FK
  subjectId String @unique @db.Uuid
  // …其余列不变
}

model SecurityEvaluationAwsConfigKnowledgeItem {
  // EvaluationSubject.id in "module/evaluation"; scalar, no FK
  subjectId String @db.Uuid
  // …其余列不变
  @@unique([subjectId, type, key])
  @@index([subjectId, type])
}

model SecurityEvaluationNpmPackageKnowledgeItem {
  // EvaluationSubject.id in "module/evaluation"; scalar, no FK
  subjectId String @db.Uuid
  // …其余列不变
  @@unique([subjectId, type, key])
  @@index([subjectId, type])
}
```

论证分两步。

**第一步：资产表里的非主体列本身就该删。**

1. **`naturalKey` / `displayName` 恒等于主体列。** 唯一写入点是 `getOrCreateAsset(subject)`，写入动作就是把 `subject.subjectKey` 和 `subject.displayName` 复制过来（`security-evaluation-asset.service.ts:148-162`）。删除坐标后主体成了唯一身份来源，这两列变成必须每次 ingest 同步刷新的副本；一旦漏刷，同一资产就有两个可能不一致的名字。身份只留一处。
2. **`@@index([naturalKey])` 是死索引。** 全模块对 `naturalKey` 只有写入与展示读取，没有任何 `where naturalKey`；按主体收窄一律走 `subjectId`，按名称搜索从未存在。

**第二步：删掉这两列之后，剩下的不是数据，是 `subjectId` 的重复。**

`subjectId @unique` 本身就是主体引用，两个时间戳都可由已有行推出：

| 列 | 替代来源 |
|---|---|
| `subjectId` | 主体自身 |
| `firstSeenAt` | `EvaluationSubject.createdAt`——主体与资产行在同一次 ingest 内创建，差值在毫秒级 |
| `lastSeenAt` | repository / aws-account：两张 knowledge item 表的 `max(observedAt)`；web-origin：`lastVerifiedAt ?? createdAt`。两者都是该 kind 本来就有的「末次被看到」证据 |

一张只剩「指向主体 + 两个可推导时间戳」的表不承担任何查询职责（按主体查走 `subjectId`，按 kind 查走主体唯一键的前缀），它只是身份层的缓存副本。删掉它，前提检验一节里的四层坍缩为三层：清单就是主体，`kind` / `displayName` / 生命周期全部只存在一处。

代价：

- **`GET /security-evaluation/assets` 接口下线**，`listAssets`（现实现为「先分页 asset、再批量补 `kind` 与 `displayName`」）与 `SecurityEvaluationAssetResponseDto` 一并删除。宿主若要保留资产清单页，改为主体分页；`naturalKey` 字段同时消失，前端改读 `subjectKey`。
- `SecurityEvaluationWebOriginService` 的六处 `row.asset.naturalKey`（提示文案、DNS challenge、token 比对）与一处 `row.asset.displayName` 改为读主体；跨 schema 无 FK，无法用 `relation` 一次带出，需显式二次查询或把主体随行一并 select。
- 现行的 `onDelete: Cascade`（asset → knowledge item / web-origin）随之消失：改指主体后跨 schema 无 FK，主体删除不再级联，落库残留的处置归主体生命周期（见未决事项第 2 条）。
- 「资产是否还出现在最近一次同步里」从读单列 `lastSeenAt` 变成按 kind 聚合 `observedAt`；「停评开关」本身仍无承载列（同上未决事项）。

### D8. 删除 `SecurityEvaluationAssetProvenance`（2026-11-15 定稿）

整表删除。`IngestSecurityEvaluationSubjectInput` 的 `sourceType` / `sourceId` 一并删除，`ingest` 退化为「subject 的纯 upsert」，提交不再携带任何宿主来源。

依据：

1. **声明是枚举的影子。** 宿主已拥有「哪些主体属于哪个项目」的唯一真源——`ProjectSubjectProvider` 按项目枚举，而 D3 已把枚举权正式交还宿主。provenance 是这个真源在模块里的第二份副本，靠每次 ingest 重新盖章来维持同步；D7 已删除资产表，它是模块内最后一份宿主维度副本。
2. **它不承担授权。** 表注释自己写明 provenance「never an authorization boundary」，只用于展示与路由；而展示所需的「项目 → 主体」可以由宿主按需枚举得到，不必落库。
3. **删除后模块内不再有任何宿主维度。** subject 只有 `(kind, subjectKey)`，其余表只按 `subjectId` 挂载，ingest 无宿主参数。这是 D1 契约前提的完整形态：模块只存「一个 kind 下 key 唯一的主体」，连「谁提交的」都不再过问。

**补偿路径（宿主侧必须同批完成）**：`SecurityEvaluationSubjectProvenanceService` 整类删除，其 8 个消费者——`project/security/compliance.service.ts`、`risk-snapshot.service.ts`、`security-evaluation-read-model.service.ts`、`notifications/security-evaluation/security-evaluation-report.service.ts`、`notifications/security-evaluation-intel/*`、`copilot/skills/datasource/{dependency,aws,security-evaluation}.datasource.ts`、`web-origin.controller.ts`——改为调用 `ProjectSubjectProvider.listSubjects(projectId, kind)` 得到 `subjectKey` 集合，再用 `evaluationSubject.findMany({ where: { kind, subjectKey: { in } } })` 换回 id。这是「实时枚举」替换「存储副本」：多一次枚举调用，但单一真源，不会再出现「项目侧删了资产、provenance 仍留着」的漂移。

代价：

- `GET /security-evaluation/runs`、`/findings`、`/report` 的 `scopeType` / `scopeId` 失去数据来源，**必须下线**（见 D5 表格）。宿主若要继续提供「按项目看结论」，改为在应用层先枚举出 `subjectIds` 再调模块接口，或另建以枚举为源的读模型。
- `SecurityEvaluationAssetProvenanceResponseDto` 删除（`SecurityEvaluationAssetResponseDto.sources` 已随 D7 删除该类一并消失）。
- 重复提交不再有第二个写入目标——`ingest` 退化为一次主体 upsert，`displayName` / `credentialRef` 的覆盖交由主体的合并规则处理（见未决事项）；背景中「重复 ingest 撞唯一索引、被 `logger.debug` 吞掉」的缺陷随之消失，因为不再有第二个唯一索引可撞。

## 跨宿主 / 演进检验

| 维度 | 框架层（registry） | 宿主层（实施） |
|---|---|---|
| 表结构 | `EvaluationSubject(kind, subjectKey, displayName, metadata, credentialRef)`，唯一键二元组 | 无自有坐标列；无资产清单表（D7）、无归属表（D8） |
| 身份 | `(kind, subjectKey)`，模块不解释 key 的内部结构 | 自定 key 取值（仓库 id、AWS 账号 id、开发者 id、规范化 origin） |
| 主体枚举 | 模块不枚举；只存取宿主已提交的主体 | 自持枚举器（`ProjectSubjectProvider.listSubjects(projectId, kind)`） |
| 项目维度 | 不感知 | 宿主按需枚举，模块内不存归属；展示与路由在应用层拼接 |
| 可移植性 | 任意宿主提交 `(kind, subjectKey)` 即可接入；无需为 scope 编造取值 | 枚举范围（哪些项目、哪些资产）是宿主业务 |
| 未来多租户 / 同 kind 跨作用域 | 若真需要，用 `subjectKey` 内的命名空间或新表 + 新 ADR 重新引入 | 不得靠恢复无 FK 的 scope 列表达 |

无 nightwatch 词汇进入 registry：表与端口只出现 `kind` / `subjectKey` / `displayName`，不认识 Project / Application / User。

## 影响

更容易：新 kind 不再需要回答「scopeId 填什么」；`platform:deployment` 这类虚构取值随常量一起消失；`deployment` 的命名争议自然终止；宿主枚举成为项目维度的唯一真源；`syncSubjects` 这条空转链路下线；D7 删除资产清单表，`kind` / `displayName` / 生命周期不再有第二份副本；D8 之后连「谁提交的」也不再落库，模块内彻底没有宿主维度。

更难：这是一次**破坏性 schema 变更**，涉及表结构（含删除资产清单表与归属表）、两处端口形状、一个对外 API 必填参数、`/assets` 接口与三个查询参数下线、`listAssets` 与两个响应 DTO 删除；`EvaluationSubjectRef` 少两个字段，所有实现该类型的宿主适配器要同步编译。生产数据可弃，所以没有迁移归并成本，代价落在代码改动与一次数据重建上。D7 让 web-origin 与 knowledge item 改指主体，`SecurityEvaluationWebOriginService` 六处读字段要改成二次查主体。D8 把「项目 → 主体」从存储副本改为实时枚举，宿主 8 个读模型必须同批改造，且三个 `GET` 接口的 `scopeType` / `scopeId` 参数失去意义。放弃「同 kind 在不同作用域下是不同 subject」这一能力——平台化以来（ADR-039 起，ADR-058 背景再次确认）设计已选择跨项目唯一（共享 run 历史、finding、suppress），当前删除与该选择自洽。删除三个操作者列后，「谁审核 / 谁抑制 / 谁关闭」只能从审计层追溯；这三处响应字段随之下线，前端目前只有生成类型、无实际消费，所以没有展示回退。

## 未在此 ADR 决定的事

- 是否保留 `displayName` 的去重/规范化策略（属特征模块）。
- `subjectKey` 的格式约定（`repository|<id>`、规范化 origin 等）由各 feature 自定，模块不校验。

评审已识别、本 ADR 未处理的结构缺口（先记账，不阻塞本决策）：

- **身份合并后的字段冲突策略**：`EvaluationSubjectService.upsert` 目前无条件覆盖 `displayName`，`credentialRef` 后写赢。删除坐标后同一 `(kind, subjectKey)` 的合并会更频繁，谁说了算尚无规则。
- **主体生命周期与删除语义**：`syncSubjects` 的注释承认「retire / archive / cascade to findings 留给第一个真正需要的 feature」，删除坐标后这条更突出——D7 删除清单表后，停机开关没有承载列（主体目前没有 `enabled` 列），「末次被看到」也只能按 kind 聚合 `observedAt` 得出。
- **D4「清空三个 schema」的精确措辞**：须明确是清空行数据、保留表结构与 `_prisma_migrations`，且必须在 `migrate` 之前执行，否则新唯一键会建在重复存量上而失败。

## 后续工作

> 状态（2026-11-15）：第 1–3 项已完成——registry `253f620`，宿主 `d7ad6af`（nightwatch-backend，含迁移 `20261115033006_evaluation_subject_identity`）与 `90106b0`（nightwatch-frontend wire 同步），back-port `diff -rq` 除 registry 独有的 `work-evaluation/clickhouse-migrations` 外为空。第 4–10 项待办。

1. registry 侧：改 `evaluation` 模块（schema、contracts、subject service、run/finding 查询、删除端口与 `syncSubjects`、`evaluation-provider.registry.ts` 与 `evaluation.module.ts` 中「四组端口」的注释降为三组）、`work-evaluation` 与 `security-evaluation` 的调用点、**十余处**测试字面量（registry：stale-reaper / run-concurrency / runner-events；宿主：intel / web-origin / source-filter / aws-config-evidence / criteria-provider / judgment-composition 等，多数是 `scopeId: "deployment"` 或 project 坐标）。
2. 宿主侧：`newbie modules apply` 重装装配产物 → `prisma migrate dev` 生成并提交迁移 → 清空三个模块 schema 并重建 → tsc / lint / test / build → 重启并冒烟（work-evaluation 触发一次 run、security-evaluation 触发一次仓库扫描，让主体与其下的 knowledge item / web-origin 重新落库）。
3. 反向机械 back-port 到 registry，`diff -rq` 为空即完成；registry 侧不重复验证。
4. 生效后把 ADR-020 / ADR-022 / ADR-024 / ADR-026 / ADR-027 / ADR-031 / ADR-039 / ADR-045 / ADR-058 的状态行更新为「某章节由 ADR-068 取代」（逐条对应头部 Supersedes 与修订行）。
5. `developer` / `developerId`（D6）：`kind` 取值加 `developer`；`evaluateeUserId` 改 `developerId`（6 表 / 5 个唯一键 / 3 个索引；registry 约 140 处 / 16 文件，宿主约 187 处 / 20 文件）。ClickHouse 的 `V20261026120000__init_work_evaluation_tables.sql` 不可回改，须新增前向迁移文件执行 `ALTER TABLE ... RENAME COLUMN`。
6. D6 其余改名：registry 侧改 schema、contracts、DTO 与测试；宿主侧 `newbie modules apply` 落库后 `npm run apits` 重新生成并同步前端。体量最大的是 `standardKey`（约 235 处 / 40 文件）与 `developerId`，建议分两次提交。
7. `@db.Date`（`startOn` / `dueOn`）与 `suppressedAt`、`firstSeenRunId` / `lastSeenRunId` 外键随同一次迁移生成。
8. D7 删表：删 `SecurityEvaluationAsset` 模型；`SecurityEvaluationWebOrigin.assetId`、`SecurityEvaluationAwsConfigKnowledgeItem.assetId`、`SecurityEvaluationNpmPackageKnowledgeItem.assetId` 改 `subjectId`（唯一键与索引随之改列）；`getOrCreateAsset` 与 `listAssets` 删除；`SecurityEvaluationWebOriginService` 六处 `row.asset.naturalKey` 与一处 `displayName` 改读主体；`GET /security-evaluation/assets` 下线、`SecurityEvaluationAssetResponseDto` 删除（`npm run apits` 同步前端）；改写该模块 `README.md` 与 `schema.prisma` 中已失效的注释——`SecurityEvaluationWebOrigin` 上「the asset carries the identity (`naturalKey` is the normalized origin, `displayName` the label)」与「provenance rows carry who attributed it」两句（D7 + D8 后均不成立）。
9. D8 删表：删 `SecurityEvaluationAssetProvenance` 模型、`IngestSecurityEvaluationSubjectInput.sourceType` / `sourceId`、`listSubjectIdsBySource` 与其 DTO；`SecurityEvaluationAssetProvenanceResponseDto` 删除；`/runs`、`/findings`、`/report` 的 `scopeType` / `scopeId` 参数下线（`npm run apits` 同步前端）；宿主删除 `SecurityEvaluationSubjectProvenanceService` 并把 8 个消费者改为 `ProjectSubjectProvider` 实时枚举。
10. 删除三个操作者列（D6 规则 4）：registry 删 schema 三列、`evaluation-result.service.ts` 的 `reviewedByRef` select 与写入、`evaluation-finding.service.ts.suppressFinding` 与 `evaluation-remediation.service.ts.decidePlan` 的入参与必填校验、`evaluation-decision.controller.ts` 两处 actor 传参；DTO 三处字段删除（`evaluation-decision.dto.ts:174,193,225`），security-evaluation / work-evaluation 复用这些响应 DTO 的映射点同步删；`evaluation-result-review.test.ts` 中「re-review 覆盖 `reviewedByRef`」的断言改为断言 `reviewedAt`；`README.md` 的 `*ByRef` 命名段落改写为「只有 `requestedBy` 一个操作者列」。
