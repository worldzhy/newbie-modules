# work-evaluation 评审修复队列（跨会话跟踪）

Status: 进行中（2026-10-27 起）。本文档是评审 #1–#11 处置的唯一真源；每完成一项就地更新状态与 commit 号，禁止把队列留在会话上下文里（教训：2026-10-27 新会话无法感知"执行4号"）。

执行顺序（用户拍板）：**#3 → #2 → #4 → #1 → #6**；#10/#11 小改择机捎带。
流程约束：骨架/模块改动走 `newbie-module-deliver` registry-first；消费仓行为级修改验证后机械 back-port；#4、#1 动手前必须先出决策点由用户拍板（决策表开场，给预测）。

## 待办

### #10 REJECTED 强制 note（择机捎带）

- `evaluation-decision.dto.ts:38-41`：decision=REJECTED 时 note 必填；同步 `evaluation-result-review.test.ts`。

### #11 startRun 202 返回 runId（择机捎带）

- `work-evaluation.controller.ts:235`：现返回 `{accepted:true}`，改为带 `runId` 便于调用方追踪。

## 已完成

### #6 assertActive fencing 行为测试补齐（2026-10-27 交付）

- 补 `evaluation-runner-events.test.ts` 2 个新用例：**reaped mid-execution**（assertActive 抛 stale Conflict → persistFailure 读回 reap 文本 → event+observer 同字）、**restarted mid-flight**（assertActive 抛 restarted Conflict → markFailed 写 row → event+observer 带 fencing 错误）。
- 原 8 测试 → 现 10 测试，覆盖 ADR-032 断言 4 次 call 中间任一时刻被 fencing 打断的路径。
- 提交：registry `1374773`，backend `a0a8f2c`（均推 dev）。

### #1 读方法 kind guard（2026-10-27 交付）

- 决策（用户拍板）：B——guard 加在**骨架层**，5 方法增可选 `kind?: string` 参数，façade 层统一传 `WORK_EVALUATION_SUBJECT_KIND`。
- 骨架层改动：
  - `EvaluationRunService.findById(id, kind?)`——统一 include subject.kind（零成本额外字段）
  - `EvaluationRunService.listRuns({ kind? })`——where 加 `subject: { kind }` nested filter
  - `EvaluationResultService.getResult(id, kind?)`——select 合并 subject.kind
  - `EvaluationResultService.getResultForRun(runId, kind?)`——同上
  - `EvaluationResultService.listResults({ kind? })`——同上
- 内部调用（runner.open、runner.persistFailure 里的 findById）不传 kind，零额外成本。
- 行为：传 kind 不匹配 → NotFoundException（语义"这个 kind 下没有这个 id"），而非 ConflictException。
- façade 层 `WorkEvaluationRunService` 5 个读方法统一 pin `WORK_EVALUATION_SUBJECT_KIND`。
- 测试：骨架层 3 个 kind guard 行为测试（findById 无 kind / 匹配 kind / 不匹配 kind → NotFound）；消费仓 99/99 集成测试全绿（原 94 + #6 fencing 2 + kind guard 3）。
- 提交：registry `1374773`，backend `a0a8f2c`；测试补：registry `c50b549`，backend `b452721`（均推 dev）。

### #4 username token 脱敏（2026-10-27 交付）

- 决策（用户拍板）：B + B2——不登记、不推断 token，redactor 内建 home 路径形态规则；覆盖 macOS/Linux/Windows。
- 修复：`createDrillRedactor` 在 identity token 掩码**之前**执行 `HOME_PATH_PATTERNS`，把 `/Users/<u>/`、`/home/<u>/`、`C:\Users\<u>\` 的登录名段替换为 `[subject]`（保留 home 前缀）；`loadIdentityTokens` 注释说明 OS 登录名不属于账号事实；evidence provider 注释订正为"touchedFiles 是唯一进入 payload 的成员路径，由 redactor 按形态脱敏"。
- 测试：`work-evaluation-redaction.test.ts` 新增 7 个用例（三形态、含 `.`/`-`/`_` 登录名、prose/quoted/串尾、URL/相对路径/无登录名反向、规则先于 token）。
- 提交：registry `6b95007`，backend `3c44454`（均推 dev）。

### #3 execute catch 中 markFailed 失败被吞（2026-10-27 交付）

- 修复：新增 `persistFailure`——markFailed 冲突时读回 row.error 作为 event/observer 文本（行不可读回退原文），原错误照常 rethrow，对齐 ADR-032 D5。
- 提交：registry `c34f251`，backend `14b4a85`（均推 dev）。

### #2 骨架内建 stale reaper（2026-10-27 交付）

- ADR-038（`.trae/documents/decisions/ADR-038-skeleton-stale-run-reaper.md`）：runner `OnModuleInit` 起 unref'd interval（默认 60s，`reapIntervalMs` 可配）；全局扫描 + 行级条件更新（多实例恰好一个赢家）；reap 后发 `evaluation.run-failed` + observer，文案=行持久化文本；移除 startRun 局部触发。
- E2E 取证：真实 PG 翻 stale RUNNING 行，70s 内被 reap 成 FAILED。
- 提交：registry `74272f3`，backend `b390b3e`（均推 dev）。

## 已关闭 / 挂起

- #5：by-design（LWW），关闭——reviewResult LWW（supervisor 最后一次为准，同 result 双并发是产品层可观测异常而非数据损坏）、updateFinding 回退路径只覆写 observation 元数据不覆写生命周期决策、resolveAbsentFindings 已做 CAS；维持关闭，如需审计轨迹应新增 `EvaluationReviewHistory` append-only 表而非改 optimistic lock。
- #7：关闭。
- #8、#9：挂起（本队列不处理）。
