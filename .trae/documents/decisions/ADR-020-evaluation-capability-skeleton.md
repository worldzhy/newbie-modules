# ADR-020: 抽象 evaluation 能力骨架（registry capability）

状态：已采纳
日期：2026-10-25

> 归属：registry 框架契约决策 → 本仓（按 ADR-019 模板的归属规则：治理的代码在 registry 里）。宿主侧实施（主体来源、证据采集、判定器、通知与调度装配）归各宿主与上层 feature 模块，不在本 ADR 决定。本 ADR 不取代任何既有 ADR。

## 背景

`people-evaluation`（`layer: capability`）与安全评估板块的 `aws-audit` / `dependency-scan` / `threat-intelligence`（`layer: feature`）在构造同一件事：以一个被评对象为起点，用一组版本化准则评判一批证据，产出可追溯的结论，并跟踪问题的整改。但两边各自实现了一遍运行态、快照、覆盖率与并发约束，且质量不一致。

盘点出的同构与差距（代码证据）：

1. **快照与可解释性**。`PeopleEvaluationResult` 已带 `manifest` + `contentHash` + `coverageStats`，逐维度给出 `confidence` / `coverage` / `evidenceRefs` / `rationale`，且 schema 注释明确「there is deliberately no composite score」。安全侧三张 scan 表都没有 contentHash、没有覆盖率结构、没有置信度字段。
2. **运行并发**。`PeopleEvaluationRun` 把并发下沉到数据库：`(evaluateeUserId, collectionPeriodId)` 上的部分唯一索引（迁移里手写 raw SQL，Prisma 无法表达部分索引）让第二个并发请求在任何副本上都在插入时失败。`DependencyScanService` 用进程内 `activeScans: Set<string>` 判断重复扫描——多副本部署即失效。
3. **结论表重复**。`AwsAuditFinding` 与 `DependencyScanFinding` 的 11 个字段中有 9 个完全相同（`status` / `severity` / `title` / `detail` / `firstSeenAt` / `lastSeenAt` / `resolvedAt` / `createdAt` / `updatedAt`），只有身份键与专属载荷不同。
4. **准则版本化**。`PeopleEvaluationRubricVersion` 有 ex-ante 冻结版本；安全侧 CIS 规则没有版本概念，且 `ruleIdToCisControl`（模块内）与 `CIS_CONTROL_CATALOG`（宿主 compliance 子域内）是两份必须手工同步的清单——服务代码注释自己写着「Keep this list in sync」。
5. **整改闭环**。`PeopleEvaluationPipPlan` 有 checkpoints / 决策人 / 决策结论；安全侧到 `status=open/resolved/suppressed` 就结束，没有整改对象。

需要在动代码前决定：这组共同契约是否抽成 registry capability 模块，以及骨架与 feature 的边界——哪些表与端口归骨架，哪些归 feature。

## 候选方案

- **A 抽象 evaluation 能力骨架**：新增 `evaluation`（`layer: capability`）模块，持有准则版本、准则、主体、运行、结论（verdict）、发现（finding）、整改计划七张表与四组端口；`work-evaluation`（ADR-021）与 `security-evaluation`（ADR-022）作为 feature 模块建在其上。
- **B 不抽象**：两个 feature 各自实现运行态、快照、覆盖率与整改。代价不是「多写一遍」，而是同一组不变量在两侧以不同强度实现，并已经实证漂移（见背景第 1/2/3 条）。
- **C 只抽共享 helpers（纯函数，不建表不建端口）**：共享覆盖率计算、contentHash、状态流转等纯函数，表结构与端口各 feature 自持。看似轻量，但结论表形状一旦不同，helpers 就必须吃两套输入类型，最终退化成两份相似代码。

## 决策

选 **A**。决定性理由：两个 feature 共享的不是工具函数，而是一组**同构的表与不变量**——结果快照不可变、覆盖率必须可解释、同一主体只允许一个在途运行、准则版本发布后只读。不变量只能由持有状态的一方强制，无状态 helpers（方案 C）对此没有约束力，等于放弃约束。

### D1. 骨架持有七张表

| 表 | 职责 | 关键不变量 |
| --- | --- | --- |
| `EvaluationCriteriaVersion` | 准则版本（ex-ante 冻结） | 发布后只读；被新版本取代而非原地编辑 |
| `EvaluationCriterion` | 准则条目 | `criterionKey` 在版本内唯一；评分型/断言型由元数据声明 |
| `EvaluationSubject` | 被评对象（`kind` + 泛化坐标 + displayName） | 无宿主外键；`scopeType`/`scopeId` 由宿主赋义 |
| `EvaluationRun` | 运行状态机 | 数据库级唯一约束：同一主体 + 同一准则版本同时仅一个在途运行 |
| `EvaluationResult` | 结论快照 | `manifest` / `contentHash` 永不改写；重跑写新行 |
| `EvaluationFinding` | 发现 | 跨 run 存活的 `firstSeenAt` / `lastSeenAt` / `resolvedAt` 生命周期 |
| `EvaluationRemediationPlan` | 整改计划 | `triggerRefs` 必须指向 finding 或 result；决策人必填 |

`EvaluationSubject` 用泛化坐标（`scopeType` + `scopeId`，无 FK），沿用 newbie-modules ADR-018 D1 与 aws-identity 的无外键作用域列先例，不引入 `project` / `application` / `member` 等任何宿主概念。

### D2. 两种结论形态并存，不合并

- **verdict**（`EvaluationResult` 内的逐准则判读）：评分型准则的产物，周期冻结、不可关闭、不参与发现计数。
- **finding**（`EvaluationFinding`）：断言型准则的产物，有身份键与跨 run 生命周期，可关闭、可抑制、可统计趋势与 MTTR。

不合并的理由是两种形态的必要属性互相排斥：把评分塞进 finding，「一条缺陷」就变成「一个分数」，失去可关闭性；把断言塞进 result 的 JSON，问题就无法被追踪，`PipPlan.checkpoints` 现在只能用自由文本跟踪正是这个后果。

### D3. 骨架零 `llm` 依赖、零宿主实体依赖

判定器由 feature 通过 `JudgmentPort` 注入，骨架不发起任何模型调用，不 import 任何宿主 Prisma 模型。

这不否定 newbie-modules ADR-018：ADR-018 决定的是 feature 模块（threat-intelligence）**可以**依赖 `llm`，骨架不依赖 llm 与它不冲突。恰恰相反——只有骨架不依赖 llm，确定性判定（版本区间、配置事实）才不会被拖进 LLM 栈，也才能保证骨架被任意宿主零改动装配。

### D4. 四组端口

| 端口 | 输入 | 输出 | 实现方 |
| --- | --- | --- | --- |
| `SubjectProvider` | scope 坐标 | 主体列表（`kind` + 标识 + displayName） | 宿主 |
| `EvidenceProvider` | 主体 | 证据清单 + manifest 条目 + 覆盖率口径 | feature |
| `CriteriaProvider` | 主体 kind | 适用的准则版本 | feature |
| `JudgmentPort` | 证据 + 准则 | verdict 判读 / finding 候选 | feature |

### D5. 骨架强制的不变量

1. **结果快照不可变**：重跑写新行，旧行的 `manifest` 与 `contentHash` 永不改写。
2. **覆盖率必须可解释**：`coverageStats` 至少区分「已评估 / 已声明未关联 / 被预算截断（skipped）」；被截断的内容不得静默丢弃。
3. **无复合分**：骨架不提供总分字段，也不提供加权合并端点；多轴分属各 feature 的读模型。
4. **运行并发由数据库保证**：用部分唯一索引或等价约束，不用进程内状态。
5. **准则版本发布后只读**：修改等于新版本。

## 跨宿主 / 演进检验（registry 模块设计必填）

| 维度 | 框架层（registry 骨架） | feature 层 | 宿主层 |
| --- | --- | --- | --- |
| 主体 | 只透传 `kind` 与泛化坐标，不定义枚举 | 定义自己的 kind（work / asset） | 自定 `scopeType` 取值与 id 语义 |
| 证据 | 只定义 `EvidenceProvider` 契约与 manifest 条目形状 | 采集并存储证据（workspace / session / document；`Asset` / `AssetFact`） | 提供凭证与外部访问能力 |
| 准则 | 只定义版本化与只读不变量 | 固化准则内容（rubric 维度 / CIS 规则 / 漏洞知识库） | 不参与 |
| 判定 | 只定义 `JudgmentPort` | 确定性判定器或 LLM 判定器 | 需要 LLM 时绑定 llm 模块的 scope |
| 结论 | 两形态与生命周期 | 各自的严重度、紧迫度、评分口径 | 读模型与 UI |
| 可移植性 | 任意 feature 按本 ADR 装配，即获得一致的生命周期、快照、覆盖率与并发约束 | — | — |

无任何宿主词汇进入骨架；骨架 schema 内不出现 `project` / `application` / `member` / `repository` 等概念。

## 未在此 ADR 决定的事

- 是否建立共享的资产台账（`Asset` 归骨架还是各 feature 自持）。当前判断：各 feature 自持，不建共享台账。
- 骨架是否提供 HTTP 端点。当前判断：只出 service 与领域事件，端点由 feature 出。
- 领域事件的具体 payload（`evaluation.run-completed` / `evaluation.finding-changed`）。

## 影响

更容易：新 feature 只需实现四组端口即可获得一致的生命周期、快照、覆盖率与并发保证；整改闭环成为通用能力，绩效改进计划与安全整改共用同一对象模型；`run` 并发从"进程内 Set"升级为数据库约束，多副本部署不再失效。

更难：骨架的不变量会反向约束 feature（例如必须显式记录被预算截断的证据），任何放宽不变量的改动都必须走新 ADR；七张表集中在一处，schema 变更的影响面覆盖所有 feature——这是集中化的预期代价。

后续工作：① 按本 ADR 交付 `evaluation` capability 模块；② `work-evaluation`（ADR-021）与 `security-evaluation`（ADR-022）分别实现四组端口；③ 骨架的行为级测试至少覆盖：快照不可变、覆盖率口径、运行并发唯一约束、准则版本只读。
