# work-evaluation 评审修复队列（跨会话跟踪）

Status: 进行中（2026-10-27 起）。本文档是评审 #1–#11 处置的唯一真源；每完成一项就地更新状态与 commit 号，禁止把队列留在会话上下文里（教训：2026-10-27 新会话无法感知"执行4号"）。

执行顺序（用户拍板）：**#3 → #2 → #4 → #1 → #6**；#10/#11 小改择机捎带。
流程约束：骨架/模块改动走 `newbie-module-deliver` registry-first；消费仓行为级修改验证后机械 back-port；#4、#1 动手前必须先出决策点由用户拍板（决策表开场，给预测）。

## 待办

### #4 username token 脱敏（下一个）

- 问题：`loadIdentityTokens`（`work-evaluation-judgment.service.ts:325-342`）只收集 email / displayName / name / firstName / lastName；session touchedFiles 的绝对路径（`/Users/<username>/...`）携带系统登录用户名，绕过 `redactDeep`（`work-evaluation-redaction.ts`）直达 LLM——盲评破功 + PII 出边界。
- 决策点（待拍板）：**username token 来源**。候选：
  - A. 外部身份表（`AccountExternalIdentity`）增取 username 字段——随账号体系登记，rename 安全；
  - B. 从 session 元数据（cwd/home/touchedFiles 路径）运行时推断——零登记成本，但推断口径要钉死（`/Users/<u>/`、`/home/<u>/`）；
  - C. subject 注册时显式登记 username——多一次装配动作。
- 完成标准：路径中的用户名被 `[subject]` 掩码；行为测试钉住 `/Users/<name>/` 形态。

### #1 读方法缺 kind guard

- 问题：`work-evaluation-run.service.ts:99-117` 五个读方法裸透传 skeleton run id，不校验该 run 属于本 feature 的 subject kind；骨架 `listRuns`（`evaluation-run.service.ts:207-219`）同样不校验 kind（对比 `listSubjects:120-122` 有 pin）。
- 决策点（待拍板）：guard 加在**骨架层**（listRuns/findById 增 kind 参数）还是 **façade 层**（work-evaluation 自己的读方法 pin kind）。
- 预测（按用户画像：框架通用性优先、不变量内建骨架）：倾向骨架层加约束。

### #6 骨架测试补齐

- 剩 `assertActive` fencing 行为测试（reaped/restarted 两行路径）。
- 已随 #2 交付：stale reaper 6 个测试（`evaluation-stale-reaper.test.ts`）。
- 已随 #3 交付：markFailed 冲突路径 2 个测试（row-wins、fallback，`evaluation-runner-events.test.ts`）。

### #10 REJECTED 强制 note（择机捎带）

- `evaluation-decision.dto.ts:38-41`：decision=REJECTED 时 note 必填；同步 `evaluation-result-review.test.ts`。

### #11 startRun 202 返回 runId（择机捎带）

- `work-evaluation.controller.ts:235`：现返回 `{accepted:true}`，改为带 `runId` 便于调用方追踪。

## 已完成

### #3 execute catch 中 markFailed 失败被吞（2026-10-27 交付）

- 修复：新增 `persistFailure`——markFailed 冲突时读回 row.error 作为 event/observer 文本（行不可读回退原文），原错误照常 rethrow，对齐 ADR-032 D5。
- 提交：registry `c34f251`，backend `14b4a85`（均推 dev）。

### #2 骨架内建 stale reaper（2026-10-27 交付）

- ADR-038（`.trae/documents/decisions/ADR-038-skeleton-stale-run-reaper.md`）：runner `OnModuleInit` 起 unref'd interval（默认 60s，`reapIntervalMs` 可配）；全局扫描 + 行级条件更新（多实例恰好一个赢家）；reap 后发 `evaluation.run-failed` + observer，文案=行持久化文本；移除 startRun 局部触发。
- E2E 取证：真实 PG 翻 stale RUNNING 行，70s 内被 reap 成 FAILED。
- 提交：registry `74272f3`，backend `b390b3e`（均推 dev）。

## 已关闭 / 挂起

- #5：by-design（LWW），关闭。
- #7：关闭。
- #8、#9：挂起（本队列不处理）。
