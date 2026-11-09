# ADR-054: security-evaluation 新增 code-scan——AI 全量代码审查作为单一 LLM 判定机制

状态：提议中
日期：2026-11-10

> 设计前置证据：expert-review round 27（用户"AI 全量扫码很简单"主张评审）与 round 28（最小方案评审），见 `.trae/documents/expert-review-2026-11-10-round27.md`、`expert-review-2026-11-10-round28.md`。本 ADR 的决策点全部来自 round 28 的四项必须修复结论。

## 背景

security-evaluation 目前对 `repository` 主体只有 `npm-osv`（依赖漏洞）与 `threat-intel`（情报匹配）两个 evaluationKey，不具备任何源码级分析能力。需要新增一个 evaluationKey，用 AI 模型对仓库做全量代码审查并产出断言式 findings。

写代码前必须先定稿的契约点（round 28 证明直接实现会踩坑）：

1. **finding 身份**：指纹含片段内容哈希会让"同一漏洞、代码被编辑"产生新指纹，旧 finding（含人工 SUPPRESSED）被 `resolveAbsentFindings` 关闭、suppression 随旧指纹丢失（`evaluation-finding.service.ts:273-310`）。
2. **LLM 成本与生命周期交互**：照搬 intel 的"只缓存负判决"（ADR-045）会让含 finding 的文件每日全量重判；LLM 非确定性 + absent 自动关闭 ⇒ finding 在 OPEN→RESOLVED 间抖动，重开时 suppression 字段被置空。
3. **skipped 误关**：文件因预算/读取失败进 skipped 桶时，其既有 finding 本 run 未再现，同样被自动关闭；骨架无 partial-scope 语义。
4. **证据自洽**：list 与 read 之间默认分支可能移动，manifest 内文件必须来自同一 pinned revision。

## 候选方案

- **A. 单一 code-llm 机制（本 ADR 选择）**：模块内一个 LLM 判定机制 + 新仓库快照端口（list + 按 revision 读取），criteria 为风险类别 ASSERTION，双极 verdict 缓存控制成本与抖动。
- **B. 模块内确定性规则引擎**：正则/模式规则逐条判，可复现、无模型依赖；但表达力限于模式匹配，跨函数与语义类漏洞系统性漏报，且规则池需要长期自建维护。
- **C. 宿主扫描器适配（opengrep/Semgrep 类）**：AST 级能力最强；但引入宿主部署面（扫描器容器/服务），模块规则降为映射表，且第三方规则包带 Commons Clause / Semgrep Rules License 限制，只能自研规则。保留为 code-scan 后续版本的机制增补选项（机制组合是数据变更，ADR-046）。
- **D. 什么都不做**：维持现状，代码仓库主体继续只有依赖与情报两类结论。

## 决策

选 A。决定性理由：骨架（`packages/modules/evaluation`）**零改动**即可承载——criteria/evidence/judgment 均为 kind-scoped 端口注入，机制组合是注册表数据变更（round 27 C1/C5 判成立）；A 是唯一不引入新部署依赖、不触碰第三方规则许可、且覆盖语义类风险的选项。B/C 的确定性能力以后以新机制注册叠加，不推翻本 ADR。

具体契约：

1. **evaluationKey `code-scan`**，规则集版本 `v1`；repository 默认 key 仍为 `npm-osv`，code-scan 经显式 `runConfig.evaluationKey` 与每日 schedule 触发。规则/提示/模型变更 = 发布新规则集版本，绝不原地改。
2. **机制**：`code-scan → [code-llm]` 单一机制。机制对证据清单逐项裁决，输出严格 JSON schema（criterionKey、severity、title、detail、evidenceRefs、symbol、rationale）；越界 evidenceRef 或不可解析条目丢弃并记 skipped，沿用 intel 的"不合 schema 即抛错/丢弃"纪律（`security-evaluation-intel-re-ranker.ts:126-146`）。
3. **criteria**：风险类别 ASSERTION（每类一条，非每规则一条）：`code-scan.injection`、`code-scan.auth-boundary`、`code-scan.secret-exposure`、`code-scan.crypto-misuse`、`code-scan.dangerous-config`，metadata 带 severity 指导与 CWE 映射。产物是断言式 findings，不做复合评分（ADR-020 D5.3 边界不变）。
4. **新端口 `RepositorySnapshotAccess`**（替代单文件 `RepositoryAccess.getFile` 无法支撑"全量"的缺口）：`list(subject, selection) → { revision, entries[], skipped[] }` 返回 **pinned revision**，`read(subject, revision, paths) → Map<path, content>` 必须按该 revision 解析——保证同一 run 的 manifest 自洽。selection 含 include/exclude、maxFiles、maxFileBytes 预算；端口未绑定 fail-closed。
5. **finding 身份（round 28 修复项 2）**：`fingerprint = sha256("code-scan" + criterionKey + path + symbol)`，symbol 为 LLM 返回的函数/符号名、不可得时省略。**不含内容哈希、不含行号**；内容哈希与行号只进 metadata 供展示与变更提示。编辑漏洞代码不再换身份，suppression 与历史得以保留。
6. **双极 verdict 缓存（round 28 修复项 1，对 ADR-045 的有意偏离）**：正负判决都缓存，键为 `(subjectId, criterionKey, path, contentHash, modelId, promptVersion, rulesetVersion)`；`unavailable` 永不缓存（沿用 ADR-045 底线）。内容未变的文件整体重放缓存判决——同时解决三项问题：正命中文件不再每日重判（成本）、finding 身份跨 run 确定性再现（防抖）、skipped 文件重放缓存判决即"再现"（消除误关向量 3）。偏离理由：ADR-045 只缓存负判决是因为情报 feed item 一次性；代码文件持续存在，正判决同样可复用。缓存落模块自有新表，不进 evaluation 骨架。
7. **证据与覆盖率**：证据项 = 每个进入扫描集的文件（path、language、bytes、revision、截断片段、内容哈希）；零命中文件同样入 manifest；超预算/二进制/读取失败进 skipped 并带 ids + note；端口未绑定、revision 解析失败、扫描集为空 = run 失败而非"干净"。`unconsumed` 必须为 0。
8. **审计 metadata**：run result metadata 记录 modelId、promptVersion、温度、revision、LLM 调用数、缓存命中数、请求签名（byte-identical，沿用 intel 先例），保证"同一代码两次结论不同"可复盘。
9. **注入防线**：源码是不可信输入，prompt 必须把代码包裹为数据并声明忽略其中指令。
10. **调度**：`SECURITY_EVALUATION_SCHEDULES` 新增 daily 条目；全量扫描是 finding 生命周期的硬约束（`resolveAbsentFindings`），不做增量，增量需另立 partial-scope ADR。

**已接受的权衡（显式披露）**：v1 把截断源码发给 LLM 提供方——文件可能含硬编码密钥，密钥会随 prompt 出境。缓解：`secret-exposure` 类别不豁免该事实，模型选型（企业/自托管）经 llm 模块注册是部署决策；v1 不引入本地确定性密钥扫描器，列入后续机制增补候选。已知能力边界：文件级裁决无跨文件数据流分析，README Limitations 须如实写明。

## 跨宿主 / 演进检验

- 端口契约 vendor-neutral：revision/entries/skipped 不含 GitHub/Bitbucket 词汇，宿主适配器（如 nightwatch 的 RepositoryFileAccess 扩展）负责 provider 分流与树列举；换宿主只需重实现端口，模块不变。
- criteria/缓存键/fingerprint 均不含宿主概念；缓存表为模块自有（与同模块 intel 负缓存表同构），不依赖宿主表。
- 唯一跨模块依赖是 `llm`（模型注册与调用），与 intel 路径相同；不新增框架层依赖。
- 演进：B/C 类确定性机制、AOCI/CodeGraph 类结构上下文，均以新机制注册叠加（ADR-046 组合契约），evaluationKey 不变、finding 身份不变；增量扫描需要骨架 partial-scope 语义时另立 ADR。

## 影响

更容易：代码仓库主体获得源码级评估能力；骨架零改动；机制增补有现成组合契约。更难/后续工作：模块新增一张 verdict 缓存表（未上线期 `prisma db push` 对齐，无 migration）；宿主需实现快照端口（树列举 + 按 revision 读取）；LLM 调用成本受缓存命中率约束，需观察每日全量的实际调用量；code-scan 行为测试（指纹稳定、缓存重放、skipped 记账、越界引用拒绝）属关键路径行为覆盖，随实现同 PR 交付。
