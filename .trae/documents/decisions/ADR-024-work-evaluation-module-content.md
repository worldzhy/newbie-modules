# ADR-024: work-evaluation 模块内容与多模型判定

状态：已采纳
日期：2026-10-26

> 归属：registry 模块内容决策 → 本仓。ADR-021 决定了命名与被评对象界定，并显式留下「模块内容（准则内容、证据采集范围、是否采集代码与 IDE skills）」未决；本 ADR 收口这些内容决策。骨架侧的配套契约扩展见 ADR-023。

## 背景

`work-evaluation` 是 ADR-020 骨架的第一个 feature。`people-evaluation`（冻结，ADR-021 D1）是事实规格：约 2300 行，含 rubric 管理、周期管理、home-ground 声明、installation/token 证据上报管线（workspace/session/document + ClickHouse 会话全文）、LLM 判定、结果读取与 PipPlan。需要在动代码前决定三件事：第一片的切片范围、旧结果行上评审字段的处置、多模型判定的形态。

## 候选方案

1. **切片范围**：A 完整移植 ingest 管线（installation/token、三类证据表、ClickHouse store、ingest 端点全进第一片，worklog 仅切 endpoint 前缀）；B 最小闭环无 ingest（证据靠种子注入，ingest 第二片）。
2. **评审工作流**（旧 `PeopleEvaluationResult.reviewedByUserId/reviewedAt/reviewNote`）：A 第一片砍掉；B feature 侧新增评审表与端点。
3. **多模型判定**：A 一等能力——运行级 config 选择 llm scope（ADR-023），同一 subject 可顺序跑多个模型，按 `result.metadata` 对比；B 砍掉（旧实现本为可选开关）。

## 决策

三项均选 **A**（2026-10-26 用户拍板）。决定性理由：

1. ingest 是证据驱动评估的唯一证据来源——没有 ingest 的第一片没有真实证据可跑，E2E 只能伪造，worklog 无切换目标；移植是机械工作，不构成拆分理由。
2. 评审写在结果行上与骨架「结果不可变」不变量直接冲突（ADR-020 D5.1）；决策对象已由 verdict + remediation plan 承载，评审属读模型/产品层，后补不阻塞。
3. 多模型对比是判定质量的验收手段——「用不同 LLM 跑、对比输出质量」要求模型选择是运行级参数而非绑定时常量；机制由 ADR-023 的 run config 透传承载。

### D1. 骨架承载的部分（不再自建）

rubric 版本/维度 → `EvaluationCriteriaVersion`（metadata 承载 `floorRules` 与 `companyDirectionStatement`）+ `EvaluationCriterion`（SCORED，metadata 承载 `anchorLow/anchorHigh/fullLoadBaseRef/calibrationExamples`）；run 状态机与并发约束；结果（manifest/contentHash/coverage/verdicts）；整改对象 → 骨架 `EvaluationRemediationPlan`，**不移植** `PeopleEvaluationPipPlan` 表（ADR-021 D3）。

### D2. feature 自带的表与管线

- `WorkEvaluationPeriod`：COLLECTION/REVIEW 类型、UPCOMING/ACTIVE/CLOSED 状态、起止窗口、`criteriaVersionId` 标量引用（跨 schema 禁 FK，先例 aws-audit）、REVIEW 期的 `collectionPeriodIds` 汇总引用。
- `WorkEvaluationHomeGround`：每 evaluatee 每期一份的专精维度声明（无权重，仅上下文）。
- 证据 ingest：`WorkEvaluationInstallation`（随机 UUID token、SHA-256 存储、明文仅创建/轮换时返回一次、软吊销）、`WorkEvaluationWorkspace`、`WorkEvaluationSession`（索引行）、`WorkEvaluationDeclaredDocument`，加 ClickHouse 表 `work_evaluation_session_messages`（会话全文）。ingest 载荷不携带 evaluatee 身份——installation token 解析唯一 evaluatee。
- 评审工作流不建表（决策 2）；多模型不单建表，`result.metadata` 承载（决策 3 + ADR-023 D2）。

### D3. 四端口的绑定

- `SubjectProvider`：宿主实现（nightwatch 成员体系），subject `kind = "work"`，`subjectKey` 为（成员, 周期）复合身份（ADR-021），`metadata.periodId` 供证据采集定位窗口。
- `CriteriaProvider("work")`：解析 `subject.metadata.periodId` → period → 其 pin 的 criteria version，返回 `{family, version}`。
- `EvidenceProvider("work")`：按（evaluatee, period 窗口）从 D2 的表与 ClickHouse 采集 workspace/session/document 三层证据；采集不到的部分进 `skipped` 桶并注明原因（ADR-020 D5.2）。
- `JudgmentPort("work")`：LLM 判定，经 llm 模块 scope 调用；盲评（模型只见 `subject-{uuid}` 不见真实身份）、锚点与 calibration examples 进 prompt、`promptVersion` 随判定注记。模型选择：`run.config.modelScope` 优先，缺省回退 feature 默认 scope；实际 model/scope/promptVersion 写入判定 metadata（ADR-023 D2）。判定预算截断进 `judgment.skipped`，绝不静默截断。

### D4. 命名与路由

模块键 `work-evaluation`；Prisma 模型前缀 `WorkEvaluation`；路由前缀 `/work/...`（`/work/evidence/{workspaces,sessions,documents}`、`/work/installations`、`/work/periods`、`/work/home-ground`、criteria 管理、run 触发与结果读取）。DTO 命名沿用 people-evaluation README 的命名规则节（`<Operation>WorkEvaluation<Concept>RequestDto` 等）。README Vocabulary 段固定一句：`worklog` 是采集 agent 的产品名，`work` 是被评对象，二者不在同一层（ADR-021 要求）。

### D5. 证据范围

第一片采集范围 = 旧模块现有三类（workspace / session / declared document）。**是否采集代码与 IDE skills 作为证据：第一片不做**——旧模块从未实现过该采集，属新增能力而非移植，留待后续单独决策。

## 跨宿主 / 演进检验（registry 模块设计必填）

| 维度 | 框架层（本模块） | 宿主层 |
| --- | --- | --- |
| 被评主体 | `kind = "work"`，（成员, 周期）复合 subjectKey | 注入 `SubjectProvider`，成员身份与周期语义属宿主身份体系 |
| 证据 | 三类证据表 + ClickHouse 全文 + installation token 管线 | installation agent（worklog）部署在成员侧 |
| 准则 | rubric 经骨架版本化只读发布 | 不参与 |
| 判定 | llm 模块 scope；`run.config.modelScope` 选择模型 | 宿主装配 llm scope 清单与默认 scope |
| 整改 | 骨架 remediation plan | 读模型与 UI |

模块内不出现 `user`/`member` 之外的宿主词汇；evaluatee 是不透明标量 id，无 FK。

## 未在此 ADR 决定的事

- 断言型准则（finding 产出）引入哪些具体条目（ADR-021 D2 只确立契约）。
- 评审工作流的产品形态与回补时点。
- 代码与 IDE skills 证据的采集。
- 旧 `people-evaluation` 的切换与处置（ADR-021 Errata：长期并存，由用户后续单独决定）。

## 影响

更容易：worklog 切前缀即接入新模块；多模型对比成为运行级能力而非特殊开关；整改对象第一次有了骨架承载的可关闭形态。

更难：与 people-evaluation 并存期间存在两套 ingest 端点与两张会话索引表，必须抵抗「双写」诱惑——第一片不做任何双写/迁移，切换由用户后续拍板。

后续工作：行为级测试随代码交付（证据采集的 skipped/declaredUnlinked 口径、installation token 生命周期、period 状态机、config 透传与 metadata 回填）。
