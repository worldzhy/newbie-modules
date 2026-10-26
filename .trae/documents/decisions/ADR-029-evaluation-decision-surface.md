# ADR-029: evaluation 决策面 HTTP 出口与 run 准入归一

状态：已采纳
日期：2026-10-26

> 归属：registry 骨架契约决策 → 本仓。本 ADR 是对 ADR-020 骨架的增量扩展，不取代其中任何决策；相关 ADR 正文保持原样。来源是 2026-10-26 对 evaluation 骨架 + 两个 feature 的整体设计 review。

## 背景

两个 feature（work-evaluation ADR-024、security-evaluation ADR-022）落地后，骨架暴露出两处结构性缺口：

1. **finding 的人机操作面没有出口**。`EvaluationFindingService.suppressFinding/reopenFinding` 与整个 `EvaluationRemediationService` 已实现且有完整生命周期语义（CAS 写、强制归因、决策人与执行人分离），但骨架 README 明言 "No controllers"，security-evaluation controller 注释明确拒绝承载（"human decisions on findings are skeleton-level operations, not this feature's vocabulary"）。两边互让的结果是：finding 是面向运营者的对象（severity、urgency、suppression 全部为人的决策准备），人却没有任何入口对它做动作——双仓装配产物中这组服务零调用方。
2. **两个 feature 的 run 触发语义不对称**。security-evaluation 用 `runner.open` 在请求路径完成准入（subject 存在、版本已发布、并发冲突在 202 之前以 400/404/409 返回）；work-evaluation 仍用 `runner.run` 全异步 fire-and-forget，准入失败只落日志，调用方拿到 202 后永远等不到 run。骨架 README 已把 open/execute 两段式定义为触发方的推荐姿势，work 的注释还在引用 `runner.run` 的旧理由——文档与实现互相矛盾。

附带确认（review 定论，随本 ADR 记录口径）：

3. **共享权限模型是有意决策**。两个 feature 的端点都以骨架模型名做权限对象（`EvaluationRun`/`EvaluationResult`/`EvaluationFinding`/`EvaluationCriteriaVersion`），跨 kind 隔离靠 feature controller 的 kind 守卫而非权限层。接受共享：kind 细分迫使 security 模块认识 work 的 kind 语义，收益不成比例；permission 模型按骨架表记账，feature 内部自行守卫 kind。
4. **runConfig 读取必须 fail-fast**。ADR-026 落地后同一 feature 内出现两种哲学：`requirePeriodId` 对类型错误抛 400，`readScopeOverride`/`readBudgetOverride` 对类型错误静默忽略。config 键是 feature 显式拥有的契约，静默忽略等于把配置错误推迟到判定结果里才暴露。

## 候选方案（决策 1：finding 决策面出口）

- **A 骨架承载**：骨架新增一个决策 controller（finding suppress/reopen + remediation CRUD），依赖 security 模块的 `RequirePermission`（security 为 infrastructure 层，capability → infrastructure 依赖方向合法）。
- **B 宿主 application 层承载**：骨架保持无 HTTP，每个宿主在 application 层自行写决策端点。问题：finding 生命周期与 remediation 是骨架域聚合，语义与宿主词汇无关；放进宿主意味着每个消费骨架的宿主都重写同一组端点——框架的承诺是"实现四端口即继承全部能力"，人的决策面断在宿主层违背这个承诺。
- **C 各 feature 自行承载**：问题：同一骨架聚合出现 N 份重复端点，且 security controller 已明确拒绝；finding 没有 kind 维度上的特征语义。

## 决策

决策 1 选 **A**：骨架新增 `EvaluationDecisionController`（文件 `evaluation-decision.controller.ts` + `evaluation-decision.dto.ts`），骨架 README 的 "No controllers" 范围修正为：**读模型与 feature 表面归 feature；finding 决策（suppress/reopen）与 remediation 是骨架域聚合的生命周期操作，归骨架**。骨架 manifest 增加对 `security`（infrastructure 层）的依赖，仅用于权限装饰器。

- 路由：`POST /evaluation/findings/:id/suppress`、`POST /evaluation/findings/:id/reopen`；remediation 走 `POST/GET /evaluation/remediation-plans`、`GET .../:id`、`POST .../:id/decision`、`PATCH .../:id/checkpoints/:index`。动词路径与既有 `criteria-versions/:id/publish` 先例一致。
- 权限：suppress/reopen 用 `Update:EvaluationFinding`；plan create/list/get/decision/checkpoint 分别用 `Create/List/Get/Update:EvaluationRemediationPlan`。
- 归因：`suppressedByRef`/`decidedByRef` 取请求主体（request.user.userId）；`deciderRef` 由请求体显式给出（服务语义：决策人永不从请求主体派生）。

决策 2（run 准入归一）：work-evaluation `startRun` 改为 ensureSubject 后 `runner.open` 同步准入、`execute` fire-and-forget——与 security-evaluation 及骨架 README 对齐。这不是新契约，是收敛到已文档化的骨架姿势；period/user 的领域校验仍在 feature 请求路径上先行。

决策 3（runConfig 读取）：`readScopeOverride`/`readBudgetOverride` 与 `readPeriodId` 统一为 fail-fast——已知键存在但类型非法一律抛 `WorkEvaluationRunConfigError`（feature 本地错误类，零运行时依赖），键缺失按各自语义（period 必需、scope/budget 可选回退默认）。这些读取器运行在 202 之后的判定执行内，错误落 run 行（FAILED + 明确原因），不再静默用默认值判定。

## 跨宿主检验

- 决策面在骨架层意味着任何宿主装配 evaluation 即获得 finding 决策与 remediation 端点，无需宿主代码；权限对象是骨架表名，宿主权限体系按模型记账即可。
- work 的准入归一不引入骨架改动（open/execute 已存在），对 security-evaluation 零影响。
- runConfig fail-fast 是 feature 内部契约，不触骨架。

## 影响

- 骨架 manifest `moduleDependencies` 从 `[]` 变为 `["security"]`；这是 capability → infrastructure 的合法方向，不引入环。
- work-evaluation 的 202 语义不变，但此前被吞掉的 409/404 现在同步返回——调用方（管理员视图）需要能处理非 202 响应（前端 apits 重生成覆盖）。
- **people-evaluation 摘除装配暂缓**（review 决策点 D3）：取证发现 worklog CLI（devbie `packages/worklog`）仍向 `/people/evidence/workspaces|sessions|documents` 推证据，people-evaluation 是在役 ingest 通道。摘除前置条件是把 worklog 迁移到 `/work-evaluation/evidence/*`（目标路由已齐备）并发布新 CLI——独立里程碑，不在本 ADR 范围内执行。
- **ClickHouse migration 文件退出**：按 2026-10-26 「未上线系统禁止生产 migration 文件」规则，work-evaluation 的 `clickhouse-migrations/V20261026120000__init_work_evaluation_tables.sql` 删除，DDL 移入 `clickhouse/schema.sql`（无版本号、不被 migration runner 扫描，作为模块的 schema 模型定义，未上线期间直接对库执行）；若该版本已在 history 表中登记则同步清除该行，避免 runner 因 "applied but file missing" 拒绝启动。存量其他模块的 V 文件属各自模块范畴，本 ADR 不处理。
