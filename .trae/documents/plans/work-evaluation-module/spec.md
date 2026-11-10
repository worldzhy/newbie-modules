# Spec: work-evaluation 模块落地（evaluation 骨架首个 feature 接入）

Status: DRAFT — pending approval
Decision sources: ADR-020 (skeleton), ADR-021 (work-evaluation 为首个 feature，people-evaluation 冻结), ADR-023 (run config 透传，已实现未提交), ADR-024 (模块内容三项决策)

## 1. 背景与现状

- evaluation 骨架已在 registry 装配（commit a79e4ab），本会话已完成 ADR-023 扩展（`EvaluationRun.config`、`StartEvaluationRunInput.config`、`JudgmentInput.runConfig`、`EvaluationJudgment.metadata` → result.metadata），registry 工作树现有 5 个骨架改动文件 + 2 个新 ADR 未提交。
- nightwatch-backend 工作树有 module-hub 并行会话在途改动（`modules.json`、`.trae/specs/dto-common-base-audit/`）——**不触碰、不提交**。
- 移植源已取证完毕：people-evaluation 模块全部文件（registry）、nightwatch-backend 应用层 `src/application/people-evaluation/`（agent/tools/redaction/builder/runner/controller）、骨架全部端口与服务。

## 2. 已定决策（ADR-024 收口，执行中不再讨论）

1. **完整移植 ingest 管线**（workspace/session/document 三路上报，PG 索引 + ClickHouse transcript）。
2. **砍掉 Result 评审字段**（reviewedBy/reviewNote），不建评审表、不建 PipPlan 表；remediation 端点第一片不暴露。
3. **多模型判定为一等能力**：经 run 级 `config` 透传（ADR-023），顺序多 run 取代旧 dual-model disagreement 逻辑。
4. 不移植：fact 层来源（github/bitbucket/incident）、`list_commits`/`fetch_diff` 等 fact 工具、people-evaluation-identity.service（宿主身份）。

## 3. 模块定义

- key: `work-evaluation`，layer: `"feature"`，className `WorkEvaluationModule`
- moduleDependencies: `["account", "audit", "security", "llm", "clickhouse", "evaluation"]`
- Prisma schema: `module/work-evaluation`，模型前缀 `WorkEvaluation`
- 路由前缀 `/work-evaluation/...`（2026-10-26 拍板：与 module key / token kind / CH 表前缀 / audit resourceType 一名到底；子路径去 evaluation 冗余：`runs` / `results`）；installation token kind = `"work-evaluation"`；subject kind = `"work"`（骨架词汇层，指被评对象，与 HTTP 命名分层）

## 4. 关键设计（执行规格）

### 4.1 subjectKey 约定（feature 定义，写进 README）

kind `"work"` 时 `subjectKey = "<evaluateeUserId>:<collectionPeriodId>"`；`metadata.periodId` 定位判定窗口；可选 `metadata.identityTokens: string[]`（宿主 SubjectProvider 提供，供 drill redactor 维持盲评；displayName 同样加入掩码）。

### 4.2 EvidenceProvider 桶口径

- `items` 全部 `layer: "declared"`；条目 id 沿用 `workspace:<uuid>` / `session:<uuid>` / `document:<uuid>` / `home-ground:<uuid>`。
- `payload` 只放小体量固有值（stats、refs）；transcript/document 大材料留在 CH/PG，由判定器 drill-down 工具按需读取（遵守骨架 evidence-payload 规则）。
- `declaredUnlinked`：workspaceKey 不在已声明集合内的 sessions 与 documents，带 note + items（统一旧 builder 的不对称处理）。
- `skipped`：transcript 抓取失败（CH 故障）的 session item ids + note。

### 4.3 JudgmentPort

- 移植三阶段 agent（advocate/skeptic/synthesis）+ 只读 drill-down 工具：`fetch_session`（CH，带 manifest 所有权守卫）、`read_document`、`list_sessions`、`list_documents`。
- prompt 词汇改骨架口径：dimension→criterion（仅 SCORED）、dimensionKey→criterionKey；`companyDirectionStatement`/`floorRules` 从 version metadata 取；anchors/calibration 从 criterion metadata 取。
- **未回答的 criterion 不产占位 verdict**（骨架 verdict 无 evaluated 标志，占位 0 分会与真实 0 分混淆——有意偏离旧 parseSynthesis）。
- 常量：`WORK_EVALUATION_PROMPT_VERSION = "work-evaluation/v1"`，默认 llm scope `"work-evaluation"`，`runConfig.modelScope` 可覆盖。
- `judgment.metadata = { model, scope, promptVersion, tokenUsage }`。
- drill redactor 移植：identityTokens（subject metadata）+ displayName + SECRET_PATTERNS。

### 4.4 run 触发形态

`POST /work-evaluation/runs { subjectId, criteriaVersionId?, config? }` → 控制器内 `void runner.run(...).catch(log)` fire-and-forget → 202 立即返回（空体或仅确认）。客户端轮询 `GET /work-evaluation/runs?subjectId=`（newest first）发现 run。理由：骨架 `runner.run` 全程同步持有 run 生命周期，feature 不能先拿 run 行；前端不存在，DX 损失可接受。README 写明。

### 4.5 period 校验

createPeriod 时 `criteriaVersionId` 必须存在、kind `"work"`、已发布；ex ante 检查 `periodStart >= publishedAt`；overlap / 状态机（UPCOMING→ACTIVE→CLOSED）/ collectionPeriodIds 校验沿用旧逻辑。`criteriaVersionId` 为标量无 FK（跨 schema 禁 relation）。

### 4.6 纯函数分离（registry 可测）

`work-evaluation-judgment.prompt.ts`（buildSystemPrompt/parseJudgmentOutput/常量，零运行时依赖）与 `work-evaluation-redaction.ts`（纯函数）独立成文件；测试只 import 纯文件，容器内 `node --import tsx --test` 可跑。

## 5. 文件清单（`packages/modules/work-evaluation/`，21 项）

| # | 文件 | 内容 |
|---|------|------|
| 1 | `newbie.module.json` | §3 定义 |
| 2 | `prisma/schema.prisma` | 6 模型 + 2 枚举：WorkEvaluationPeriodType/Status、WorkEvaluationPeriod（criteriaVersionId 标量）、WorkEvaluationHomeGround（homeCriteria Json）、WorkEvaluationWorkspace、WorkEvaluationSession、WorkEvaluationDeclaredDocument、WorkEvaluationInstallation；头部注释块列模型 |
| 3 | `clickhouse-migrations/V20261026120000__init_work_evaluation_tables.sql` | `work_evaluation_session_messages`，同构改名 |
| 4 | `work-evaluation-installation.service.ts` | sed 级移植（schema 常量、audit resourceType `work-evaluation-installation`、在线阈值 180s） |
| 5 | `work-evaluation-installation-token.resolver.ts` | kind `"work-evaluation"` |
| 6 | `work-evaluation-session.store.ts` | 表名常量改 `work_evaluation_session_messages` |
| 7 | `work-evaluation-period.service.ts` | period CRUD + 状态机 + home-ground；criteria 校验经骨架 EvaluationCriteriaService（§4.5）；home-ground 校验 criterionKey 来自骨架 listCriteria |
| 8 | `work-evaluation-evidence.service.ts` | ingest/reads 移植（reportWorkspace/reportSessions/upsertSessionIndex/reportDocument/list*） |
| 9 | `work-evaluation-criteria.provider.ts` | `criteriaProviderToken("work")`：getSubject 读 metadata.periodId → period → criteriaVersionId → `{family, version}` |
| 10 | `work-evaluation-evidence.provider.ts` | `evidenceProviderToken("work")`，按 §4.2 桶口径采集 |
| 11 | `work-evaluation-judgment.prompt.ts` | 纯函数（§4.3、§4.6） |
| 12 | `work-evaluation-redaction.ts` | 纯函数移植 |
| 13 | `work-evaluation-judgment.tools.ts` | drill 工具 Nest service（§4.3） |
| 14 | `work-evaluation-judgment.service.ts` | JudgmentPort 实现，`judgmentPortToken("work")`，三阶段 agent loop |
| 15 | `work-evaluation-run.service.ts` | 薄 façade：trigger（fire-and-forget）+ runs/results/subjects reads |
| 16 | `work-evaluation.controller.ts` | `@Controller("work-evaluation")`：criteria-versions / periods / home-ground / subjects / runs / results |
| 17 | `controllers/installation.controller.ts` | `@Controller("work-evaluation/installations")` |
| 18 | `controllers/evidence.controller.ts` | `@Controller("work-evaluation/evidence")`，`@InstallationAuth("work-evaluation")` + `@AllowAnyOrigin()` + 204 |
| 19 | `work-evaluation.dto.ts` | 命名规则沿用：`<Operation>WorkEvaluation<Concept>RequestDto` 等；criteria DTO 把 metadata 结构化（version: floorRules?/companyDirectionStatement?；criterion: anchorLow?/anchorHigh?/fullLoadBaseRef?/calibrationExamples?） |
| 20 | `work-evaluation.module.ts` | `@Global`，端口绑定：installationResolverToken("work-evaluation") + criteriaProviderToken("work")/evidenceProviderToken("work")/judgmentPortToken("work") 均 useExisting |
| 21 | `README.md` + 2 测试 | README 含固定句"worklog 是采集 agent 产品名，work 是被评对象"、subjectKey 约定、桶口径、盲评与 identityTokens、多模型用法；`work-evaluation-judgment.prompt.test.ts` + `work-evaluation-redaction.test.ts` 只 import 纯文件 |

机械改名映射：`PeopleEvaluation`→`WorkEvaluation`、`peopleEvaluation`→`workEvaluation`、`people-evaluation`→`work-evaluation`、`people_evaluation`→`work_evaluation`、`PEOPLE_EVALUATION_`→`WORK_EVALUATION_`、路由 `"people/`→`"work-evaluation/`（且子路径 `evaluation-runs`→`runs`、`evaluation-results`→`results`）、homeDimensions→homeCriteria、dimension→criterion（词汇层）。

## 6. 验证步骤

registry 侧（一次性容器 `docker run --rm -v /Users/worldzhy/src:/home/worldzhy/src node:24.13.0`）：
1. `npm run format:check`（registry 仓内，含 prisma）
2. `node --import tsx --test` 跑两个新纯函数测试（cwd 用 nightwatch-backend 借其 node_modules 解析 tsx）
3. evaluation-invariants 回归 20/20

装配侧（NEWBIE_MODULES_REF=origin/dev，容器内）：
4. 刷新容器 registry 缓存 → `modules add work-evaluation -y` → `modules update -y --force`
5. 手写 PG migration（6 表）+ CH migration；`prisma migrate deploy && prisma generate`
6. `tsc --noEmit`（4 条既有无关报错为基线）→ `nest build` → 重启 → 冒烟（认证 + 端点）→ apits 重生成

## 7. 提交计划

- registry：显式路径 add（5 骨架文件 + 2 ADR + work-evaluation 全部 + people-evaluation README 冻结横幅），`format:check` 过门禁，HTTP/1.1 直推 dev + fetch 核对。冻结横幅内容（ADR-021 D1）：声明 work-evaluation 是 go-forward 实现、people-evaluation 冻结不再演进。
- backend：装配产物 + migration + apits 一起提交推送 + 远端核对；不碰并行会话在途文件。

## 8. 明确不做

Result 评审字段/评审表、PipPlan、remediation 端点、dual-model disagreement、highlights/risks/unresolved 顶层字段（verdicts+summary 承载）、fact 层来源与工具、前端页面。
