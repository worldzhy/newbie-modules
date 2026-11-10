# Expert Review — security-evaluation code-scan 与宿主整合（Round 31）

- scope：`modules: [security-evaluation]`（registry 真源 + nightwatch-backend 装配面 + 直接消费方）
- 评审对象：ADR-054 code-scan LLM 判断全链路（registry `21e4ef8`）及其装配整合（`nightwatch-backend` `743c24b`）
- 时间：2026-11-10 09:20 — 09:55 CST
- 编号说明：本仓同日的 round27/28 是 plan-scope 局部编号（ADR 评审），全局台账最后为 round30，本轮按全局续编 **31**。

## 1. 锚点

| 仓 | branch | HEAD | 工作树 dirty |
| --- | --- | --- | --- |
| newbie-modules | dev | `21e4ef8` | 0 |
| nightwatch-backend | dev | `743c24b` | 0 |

- 装配面 `diff -rq newbie-modules/packages/modules/security-evaluation nightwatch-backend/src/modules/security-evaluation` → 无差异（exit 0）。
- `newbie-modules.json` 中 security-evaluation 的 ref = `21e4ef8`，与 registry HEAD 一致。
- 并行会话：无（两仓工作树干净）。

## 2. 范围与方法

**scope 解析**：点名模块 security-evaluation → registry 模块目录 + 装配副本 + 渲染产物（`prisma/models/security-evaluation.prisma`、`modules.config.ts`、`.env.example`）。模块外直接消费方按 findings 需要单列：宿主快照适配器、wiring、项目安全读模型、前端 security-evaluation 页、evaluation 骨架的 runner/finding/invariants。明确排除：llm 模块内部实现、GitHub 模块内部实现、通知链路、其他模块。

**方法**：4 条并行路（机制判定链路 / 证据与缓存持久化 / 宿主适配与装配 / 骨架生命周期与前端接线），静态读码 + 运行时探针。

**披露的偏差**（§9.7 补偿）：
1. 本会话紧接交付会话，存在"自己人评自己"风险；R31-01、R31-02 均升级为 executed 证据，其余 P2 明确标 static。
2. R31-01 的探针**改动了本地数据库状态**（删除 `security-evaluation-code-scan` 的 scope 绑定并恢复），未改代码、未重启服务；恢复后 findings 与绑定均已回位（见 §8）。
3. 反驳轮由无共享上下文的独立代理执行（同基础模型），只移交主张与 file:line，裁决由主会话读码完成。

## 3. 结论摘要

代码本体质量较高：指纹去内容化、双极缓存、证据记账、fail-closed 配置这几条 ADR 硬契约都真实落到了实现与测试（14 个 code-scan 测试全绿，本轮复跑）。问题集中在**与宿主骨架/宿主读模型的接缝**：

| 维度 | 评价 |
| --- | --- |
| 安全 | 3/5 — 无越权路径；但源码摘录与密钥原文会二次落库（R31-10） |
| 架构 | 4/5 — 端口/机制分层干净，judgment 无 Prisma 依赖 |
| 契约 | 2.5/5 — "全量跳过仍成功"（R31-01）与"漏登记读模型"（R31-02）直接违背 ADR 意图 |
| 测试 | 4/5 — 14 测试覆盖指纹/缓存/跳过/越界引用；缺"空判定不成功"用例 |
| 门禁 | N/A — 本轮未取证 CI |
| 治理 | 3/5 — ADR-054 条款 6/7 的表述强于实现（R31-09、R31-01 残余向量） |

**两条 P1**，均为"新能力上线后安全信号静默丢失"：
1. R31-01 LLM 不可用时全量跳过仍记为 SUCCEEDED，已有 findings 被自动关闭。
2. R31-02 code-scan 未登记项目安全分类表，findings 被总览与风险快照静默丢弃。

## 4. P1

### R31-01 全量跳过被当作成功运行，既有 code-scan findings 被自动关闭

- **仓**：newbie-modules（逻辑）+ nightwatch-backend（骨架交互）
- **severity**：P1 ｜ **暴露面**：live ｜ **可达性**：管理员解绑 scope 或 LLM 连接不可用（含无人值守 daily 扫描）｜ **可利用性**：直接触发即发生（无需攻击者）
- **置信级别**：**executed**

**证据链（file:line）**
- 模型解析失败只 warn，不抛错，随后按文件逐条记 unavailable skip：
  [security-evaluation-code-scan.mechanism.ts:176-185](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/code-scan/security-evaluation-code-scan.mechanism.ts#L176-L185)、
  [:262-283](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/code-scan/security-evaluation-code-scan.mechanism.ts#L262-L283)
- 缓存只有在 `modelId` 非空时才查询（解绑时 `modelId` 为 null，等于绕过缓存）：
  [:209-220](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/code-scan/security-evaluation-code-scan.mechanism.ts#L209-L220)
- 骨架：coverage 无 problems 即归档结果、无条件 resolveAbsentFindings、再 markSucceeded：
  [evaluation-runner.service.ts:193-222](file:///Users/worldzhy/src/nightwatch-backend/src/modules/evaluation/evaluation-runner.service.ts#L193-L222)
- 自动关闭条件只按 subject + evaluationKey + OPEN + `lastSeenAt < cutoff`，skipped 不参与：
  [evaluation-finding.service.ts:97-117](file:///Users/worldzhy/src/nightwatch-backend/src/modules/evaluation/evaluation-finding.service.ts#L97-L117)
- 覆盖校验允许 `evaluated.total = 0`：
  [evaluation-invariants.ts:201-209](file:///Users/worldzhy/src/nightwatch-backend/src/modules/evaluation/evaluation-invariants.ts#L201-L209)

**复现（executed，2026-11-10 09:3x）**
1. 前置：subject `199bf33d…`，2 条 OPEN finding（HIGH injection / MEDIUM dangerous-config），每次运行 25 文件。
2. 删除 `module/llm."LlmScopeAssignment"` 中 `security-evaluation-code-scan` 行 → 触发 `POST /security-evaluation/runs`。
3. 结果：run `SUCCEEDED`，result `8995f3d3…`；coverage `evaluated=0`、`skipped=34`（9 采集 + 25 判定）、`unconsumed=0`；result summary `judged 0 file(s)`。
4. 该次运行结束即两条 finding 变 `RESOLVED`（`lastSeenAt` 停在上一次成功 run）。
5. 恢复绑定后再跑一次：result `1e907d7d…`，`evaluated=25`、`skipped=9`、25 cache hit / 0 LLM 调用，两条 finding 重开为 OPEN（当前库内状态复核：`FINDINGS [{"status":"OPEN","n":2}]`）。

**影响**：一次 LLM 不可用（解绑、连接删除、凭据失效到 scope 解析失败）会把该 subject 的全部 code-scan 结论"清零"；项目报告呈现为无风险。同族残余向量（static，P2 备注）：文件因超过 200 文件上限、扩展名策略变化或体积超限而退出扫描集时，其旧 finding 同样会被关闭——ADR 条款 6 声称双极缓存消除了该误关向量，但缓存只对被纳入本次扫描集的文件生效。

**修复方向**：判定层 fail-closed 对齐证据层已有的"vacuous clean result"守卫——当 `chatModel/modelId` 不可得时抛错（run FAILED，findings 保持原状），以及当 `unavailableCount === 扫描集大小` 时抛错。补一个"scope 未绑定 ⇒ run 失败且 finding 状态不变"的测试。骨架侧若要支持部分覆盖，需要另立 partial-scope ADR，不在本次修复范围。

### R31-02 code-scan 未登记项目安全分类表，findings 在项目总览与风险快照中被静默丢弃

- **仓**：nightwatch-backend（宿主整合缺口）
- **severity**：P1 ｜ **暴露面**：live ｜ **可达性**：任何能查看项目安全总览的登录用户 ｜ **可利用性**：直接（无需链条）
- **置信级别**：**executed**（纯函数探针）

**证据（file:line）**
- R1 映射表只有 npm-osv / aws-cis-1.5 / aws-custom / threat-intel，无 code-scan：
  [security-evaluation-read-model.service.ts:51-56](file:///Users/worldzhy/src/nightwatch-backend/src/application/project/security/security-evaluation-read-model.service.ts#L51-L56)
- 未登记的 key → `unknown`，`attributionBuckets` 返回空：
  [:112-135](file:///Users/worldzhy/src/nightwatch-backend/src/application/project/security/security-evaluation-read-model.service.ts#L112-L135)
- 空 buckets 的消费点（findings 与 runs 都是）：[:319-323](file:///Users/worldzhy/src/nightwatch-backend/src/application/project/security/security-evaluation-read-model.service.ts#L319-L323)、[:364-368](file:///Users/worldzhy/src/nightwatch-backend/src/application/project/security/security-evaluation-read-model.service.ts#L364-L368)
- 风险快照同样按此过滤：[risk-snapshot.service.ts:188-196](file:///Users/worldzhy/src/nightwatch-backend/src/application/project/security/risk-snapshot.service.ts#L188-L196)

**探针输出（executed，容器内 tsx）**
```
code-scan   => {"type":"unknown"} buckets []
threat-intel=> {"type":"unclassified"} buckets ["unclassified"]
npm-osv     => {"type":"categorized","categories":["npm"]} buckets ["npm"]
```

**影响**：平台级 `/security-evaluation/report` 能看到这 2 条 finding（trend 已在 2026-11-09 记 opened=2），但项目安全总览的分类桶、覆盖率展示与 `RiskDailySnapshot` 都看不到它们；本轮执行环境没有 Project 行，因此无法用 HTTP 端到端展示"页面缺一块"，但纯函数已证明桶为空。对真实项目而言，这是新能力"上线即隐身"。

**修复方向**：在 R1 表登记 `[SECURITY_EVALUATION_KEY_CODE_SCAN]`，并明确语义二选一——`[]`（unclassified，与 threat-intel 同构）或新增一个产品类别（进风险评分）。同时补 read-model 单测；若选择 unclassified，ADR-054 需补一句与 ADR-037 分类表的登记关系。

## 5. P2（按主题归并）

### 5.1 宿主快照选择启发式

- **R31-04 扩展名判定用整条 path 的最后一个点**：[repository-snapshot-access.ts:143-151](file:///Users/worldzhy/src/nightwatch-backend/src/application/security-evaluation/repository-snapshot-access.ts#L143-L151)。`docs/v1.2/README` 会把 `.2/README` 当扩展名而误判 "non-source"；无点号文件（`Dockerfile`、`Makefile`）反而全部当源码送审。应改为 `path.slice(path.lastIndexOf("/") + 1)` 取 basename 后再判扩展名（`basename` 已在上一行算出，未复用）。同处 `EXCLUDED_PREFIXES`（[:58](file:///Users/worldzhy/src/nightwatch-backend/src/application/security-evaluation/repository-snapshot-access.ts#L58)）只匹配根级，`packages/x/dist/…` 不会被排除。static。
- **R31-05 GitHub tree 截断只 warn 不记账**：[:97-101](file:///Users/worldzhy/src/nightwatch-backend/src/application/security-evaluation/repository-snapshot-access.ts#L97-L101)。截断前缀之外的文件既不在 manifest 也不在 skipped，违反"全量记账"（evidence provider 的 skipped 契约见 [security-evaluation-evidence.provider.ts:330-360](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/evidence/security-evaluation-evidence.provider.ts#L330-L360)）。应把"tree 被截断"折进 skipped note 或直接 fail-closed。static。
- **R31-08 超预算文件逐条写 skipped，result 体积随仓库规模线性增长**：[:112-115](file:///Users/worldzhy/src/nightwatch-backend/src/application/security-evaluation/repository-snapshot-access.ts#L112-L115) 把上限之外的**每个**源码文件写成一条 skip，最终进入 `EvaluationResult.coverageStats` 存库。万级文件的仓库会产生数百 KB 的单条 result。建议只记累计数 + 抽样 ids + note。static。

### 5.2 缓存身份与预算

- **R31-06 缓存身份以 modelId（模型名）为准，跨连接共享判决**：机制 [:209-220](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/code-scan/security-evaluation-code-scan.mechanism.ts#L209-L220) + 唯一键 [security-evaluation.prisma:243](file:///Users/worldzhy/src/nightwatch-backend/prisma/models/security-evaluation.prisma#L243)。`modelId` 来自连接配置的模型名，两个不同 provider/端点若都叫 `deepseek-chat`，会互相复用判决；`temperature` 只进 request signature、不进缓存身份。建议把 connectionId（或 baseUrl 摘要）纳入缓存身份，或在文档里显式声明"同名模型视为同一判定器"。static。
- **R31-09 预算分支不可达 + ADR 表述过强**：`MAX_FILES = 200` 与 `LLM_CALL_BUDGET = 200` 相等（[constants:91,100](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/security-evaluation.constants.ts#L91-L100)），缓存命中又不消耗预算，因此 [:279-283](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/code-scan/security-evaluation-code-scan.mechanism.ts#L279-L283) 的 budgetCut 实际取不到；ADR-054 条款 6 据此宣称"缓存让被预算跳过的文件仍能重现"在本实现中不成立（真正触发跳过的是宿主上限，而宿主跳过的文件根本不进缓存查询）。建议要么下调预算让其可达并有测试，要么删分支并修正 ADR 表述。static。
- **R31-07 只有丢弃条目、无文件跳过时，丢弃说明不进 coverage**：[:359-389](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/code-scan/security-evaluation-code-scan.mechanism.ts#L359-L389) 中 `skipped` 在 `skippedIds.length === 0` 时为 undefined，`discardedEntries` 只留在 metadata。证据契约要求"说明"可审计，建议把丢弃说明挂到 evaluated 侧或独立 metadata 键并在 result 摘要中可见。static。

### 5.3 数据留存

- **R31-10 源码摘录与密钥原文二次落库**：每个文件最多 12000 字符的 excerpt 进入 evidence payload（[security-evaluation-evidence.provider.ts:303-319](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/evidence/security-evaluation-evidence.provider.ts#L303-L319)），manifest 随 result 持久化（[evaluation-runner.service.ts:190-215](file:///Users/worldzhy/src/nightwatch-backend/src/modules/evaluation/evaluation-runner.service.ts#L190-L215)）；200 文件 ≈ 2.4 MB/次/仓库。同时 `secret-exposure` 类 finding 的 detail 可能包含密钥原文，并被写入 findings 表与 verdict 缓存表（[security-evaluation.prisma:237](file:///Users/worldzhy/src/nightwatch-backend/prisma/models/security-evaluation.prisma#L237)）。ADR 已声明"源码出境含密钥不豁免"，但未覆盖"二次落库 + 保留期"。建议 prompt 要求密钥脱敏（只留前缀/长度），并让宿主对 manifest 的保留/清理有明确口径。static。

### 5.4 前端接线

- **R31-03 前端未接入 code-scan**：标签表 [page.tsx:131-136](file:///Users/worldzhy/src/nightwatch-frontend/src/app/(dashboard)/security-evaluation/page.tsx#L131-L136)、筛选选项 [:177-183](file:///Users/worldzhy/src/nightwatch-frontend/src/app/(dashboard)/security-evaluation/page.tsx#L177-L183)、repository 的手动触发项 [:866-873](file:///Users/worldzhy/src/nightwatch-frontend/src/app/(dashboard)/security-evaluation/page.tsx#L866-L873) 都只有 npm-osv/threat-intel。ADR-054 说"显式 runConfig 触发"，但页面上唯一的显式入口给不出 code-scan，实际只能靠 API 或 daily 定时任务。若这是有意（先跑定时、UI 后续），应在 ADR 或 backlog 写明。static。

## 6. 误报剔除

- 初判"平台报表漏掉 code-scan findings"——**推翻**：`/security-evaluation/report` 的 trend 已记 2026-11-09 opened=2，平台报表不按 evaluationKey 过滤；问题只存在于项目读模型（R31-02）。
- 初判"code-scan 造成平台覆盖率 unconsumed=25"——**推翻**：DB 查询显示 code-scan 两次运行均为 `unconsumed=0`；报表的 25 来自 aws-custom(10)+aws-cis(15) 的既有未消费证据。
- 初判"LLM 连接不可用即全体静默关闭"——**收窄**：若连接存在但 API 报错，`modelId` 已解析，缓存命中文件仍会重放；只有缓存未命中（新/变更文件）才进入 unavailable。R31-01 的 executed 证据是 scope 解析失败这一路径。
- 初判"skipped 记账会漏 read failure"——**推翻**：host skip 与 read failure 合并进同一 bucket，ids + 双语义 note 均正确（E2E skipped=9 带 note）。

## 7. 修复优先级

1. **R31-01**（fail-closed，阻止安全结论被静默清零）——最小改动：机制在模型不可得时抛错 + 一条回归测试。
2. **R31-02**（一行映射 + 单测，决定进不进风险评分）。
3. **R31-04 / R31-05**（宿主选择启发式直接决定"哪些文件被审"，错误会影响判定可信度）。
4. R31-06 / R31-09（缓存身份与 ADR 表述）。
5. R31-03 / R31-07 / R31-08 / R31-10（体验与留存）。

## 8. 已核验通过的不变量（正面结论）

- 装配一致性：registry 与装配副本 `diff -rq` 零差异；`newbie-modules.json` ref = `21e4ef8`。
- 指纹稳定：`sha256("code-scan" + criterionKey + path + symbol)` 不含内容哈希与行号；内容/版本变化不抖动（测试）。
- 双极缓存：unavailable 不写缓存；命中重放重挂 evidenceRefs、`llmCalls=0`；`cacheHits=25`（E2E 第二轮）。
- 部分缓存行（少于 criteria 数）视为未命中，不会半量重放（测试）。
- 证据契约：零命中文件仍入 manifest；host skip 与 read failure 合并记账；`unconsumed=0`（两次运行 DB 复核）。
- vacuous clean 守卫：端口未绑定、扫描集为空、全部读取失败 → 抛错（provider [:270-286](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/evidence/security-evaluation-evidence.provider.ts#L270-L286)、[:321-325](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/evidence/security-evaluation-evidence.provider.ts#L321-L325)）。
- TTL：声明式配置 + `getOrThrow` fail-closed，`NEGATIVE_CACHE_TTL_DAYS` 同构；`.env.example`、`modules.config.ts` 均已声明。
- 触发面：code-scan 仅显式 `runConfig.evaluationKey` 触发，repository 默认仍是 npm-osv（[criteria.provider.ts:49-56](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/criteria/security-evaluation-criteria.provider.ts#L49-L56)）。
- 分层：`judgment/` 无 Prisma/生成客户端依赖（grep 无命中），缓存端口在 judgment、实现在 persistence。
- 输出校验：未知 criterionKey、越界 severity、非本文件 evidenceRefs 一律丢弃并计数；指纹去重（测试）。
- 恢复性：解绑探针后重新绑定并运行，缓存全量重放，两条 finding 恢复 OPEN（本轮探针已复原环境）。

## 9. 覆盖率清单

**审了**：registry security-evaluation 全目录（constants、criteria seed/provider、judgment 机制/注册表/identity/request/port/model-scope、evidence provider、persistence 两个仓储、module wiring、schema、README、14 个测试）；装配副本全量 diff；宿主 adapter、wiring module、read-model、risk-snapshot 消费点、runner、finding service、invariants、controller、daily job、`prisma/models/security-evaluation.prisma`、`.env.example`、`modules.config.ts`、`newbie-modules.json`；前端 security-evaluation 页的 key 映射/筛选/触发三处。

**没审**：llm 模块 adapter 内部实现与连接管理端点、GitHub/Bitbucket 模块内部、通知链路、审计日志、CI workflows、其他模块、真实项目端到端（环境无 Project 行）。

## 10. 台账

- 本轮 findings 已写入 [findings.md](./findings.md) 的 `round31` 段（R31-01 … R31-10）。
