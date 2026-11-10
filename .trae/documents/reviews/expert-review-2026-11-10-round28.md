# Expert Review Round 28 — plan scope：code-scan 最小方案评审

## 1. 锚点

| 字段 | 值 |
|---|---|
| 仓 | newbie-modules（模块真源） |
| branch | dev |
| HEAD | d74d936 |
| 工作树 | 1 个 untracked：`.trae/documents/expert-review-2026-11-10-round27.md`（上一轮评审交付物，非被审代码域，不标 provisional） |
| 评审时间 | 2026-11-10 01:12–01:35 CST |
| 并行会话 | 被审代码域无在途改动 |
| scope | plan（code-scan 最小方案，主张主要触及 newbie-modules） |
| git 来源 | GitHub Desktop 内置 git |

## 2. 范围与方法

被审方案（round 27 收口后的最小形态）：新 evaluationKey `code-scan`，骨架零改动；新模块端口（列举 + 按 pinned revision 读取）；单一 `code-llm` 机制对文件级证据项逐条结构化裁决；criteria 为若干 ASSERTION 风险类别；负缓存按内容哈希控制成本；全量扫描对齐 `resolveAbsentFindings`；fingerprint = criterionKey + 路径 + 片段内容哈希；宿主仅扩展既有 `RepositoryFileAccess`。

方法：拆主张 P1–P6 → 命令取证（grep/read，行号经复核）→ 独立反驳轮（Explore 代理，仅移交主张 + 依赖路径；部分独立：同基础模型）。

## 3. 主张判定表

| # | 主张 | 判定 | 依据 |
|---|---|---|---|
| P1 | 单 code-llm 机制 + 新端口即可满足骨架契约，骨架零改动 | **成立** | 机制组合是注册表数据变更（`judgment/security-evaluation-mechanism.registry.ts:14-28`）；端口注入经 kind-scoped 工厂（`security-evaluation.module.ts:137-171`）；骨架对 evidenceRefs/coverage 的校验对新 key 无分支（`evaluation-finding.service.ts:54-74`、`evaluation-runner.service.ts:193-199`）。 |
| P2 | 负缓存（内容哈希键）足以控制成本与重复调用 | **不成立（按现方案字面）** | intel 先例的负缓存**只缓存 not-relevant**——写入条件为 `verdict.kind === "not-relevant" && verdict.signature`（`judgment/intel/security-evaluation-intel-match.service.ts:155-175`），读取侧仅过滤 not-relevant（`persistence/security-evaluation-intel-negative-cache.repository.ts:57-83`）。照搬到 code-scan 意味着：**含 finding 的文件每天全量重判**。LLM 非确定性 + `resolveAbsentFindings` 自动关闭未再现项（`evaluation-finding.service.ts:94-129`）⇒ finding 在 OPEN→RESOLVED→OPEN 间抖动，且重开时 `suppressionNote/suppressedByRef` 被置空（`evaluation-finding.service.ts:296-303`）。修复方向：改为**双极 verdict 缓存**（正负判决都按 (文件内容哈希, criterionKey, modelId, promptVersion, 规则集版本) 缓存），未变文件整体重放缓存判决——同时解决成本与抖动。intel 不缓存正命中是因为 feed item 一次性，代码文件持续存在，场景不同不能直接类比。 |
| P3 | fingerprint = criterionKey + 路径 + 片段内容哈希，身份跨 run 稳定 | **不成立** | 片段哈希对「同一漏洞、代码被编辑」敏感：任何触碰该片段的提交都产生新 fingerprint ⇒ 旧行（含人工 SUPPRESSED 状态）按 absent 关闭、新行全新建立，**suppression 随旧指纹一起丢失**（upsert 按 fingerprint 匹配，`evaluation-finding.service.ts:273-310`）。对照先例：dependency 指纹刻意排除版本号，intel 指纹为 `threat-intel:{itemId}:{entity}` 纯身份键（`judgment/intel/security-evaluation-intel.judgment.ts:144-167`）——两者都不含易变内容哈希。修复方向：fingerprint 只用稳定身份（criterionKey + path，或 criterionKey + path + 符号名），片段哈希降级进 metadata 用于展示与变更提示。 |
| P4 | 全量扫描与 resolveAbsentFindings 完全兼容，无误关风险 | **部分成立** | 全量本身兼容（round 27 已判）。但两个残留误关向量：①P2 的抖动（见上）；②**skipped 文件中的既有 finding 会被误关**——文件因预算/读取失败进 skipped 桶时其旧 finding 本 run 未再现，照样被 `resolveAbsentFindings` 关闭（cutoff 只看 lastSeenAt，`evaluation-finding.service.ts:94-129`）。P2 的双极 verdict 缓存可同时修复此向量：skipped 文件重放缓存判决使 finding 被"再现"。不修缓存则必须在机制层另设 carried 语义，而骨架目前无 partial-scope 概念。 |
| P5 | 产物链完整可审计，无遗漏 | **部分成立** | manifest/judgment/findings/coverage 四件齐备，但可审计性还要求 result metadata 记录模型身份与请求签名（intel 先例：`security-evaluation-intel-request.ts:46-75` 的 byte-identical 签名）——modelId、promptVersion、温度、调用数、缓存命中必须写入，否则"同一代码两次结论不同"无法复盘。方案示例（上一轮产物图）已含此项，方案条文需显式列出。 |
| P6 | 宿主侧仅需扩展既有 RepositoryFileAccess 即可落地 | **部分成立** | 方向对，但有两个未决缺口：①现有端口仅 `getFile` 单文件（`ports/repository-access.port.ts:12-15`），需新增列举能力；②**revision 一致性**——list 与 read 之间默认分支可能移动，npm-osv 今天无此问题（单文件隐式读 head），code-scan 的端口契约必须由 list 返回 pinned revision、read 按 revision 解析，否则 manifest 内文件来自不同提交，证据不自洽。 |

## 4. 方案外新发现

- 无（本轮问题均落在方案主张内，已在判定表处理）。

## 5. 误报剔除

- 无（反驳轮证据与主会话读码一致；`updateFinding` 重开清空 suppression 字段的行为经主会话复核 `evaluation-finding.service.ts:284-303` 确认）。

## 6. 已核验通过的不变量

- 骨架对 code-scan 零改动成立（同 round 27，本轮复核无回归）。
- finding upsert 的并发语义正确：唯一冲突回落 update、compare-and-set 不踩踏并发 suppression（`evaluation-finding.service.ts:263-310`）。
- skipped/unconsumed 记账契约可表达"预算跳过"语义，无需骨架扩展。

## 7. 覆盖率清单

已审：finding 生命周期全路径（create/update/resolveAbsent，L40-130、L260-315）、intel 负缓存写入/读取/仓储契约、intel 判决与指纹构造、registry、module DI、repository 端口、runner coverage 段。

未审：assets touchObserved 细节、work-evaluation、宿主 wiring 内部、前端、部署面。

## 8. 结论摘要

最小方案的**骨架契合面全部成立**（P1），落地方向正确（P6 主干部）。但有**两个必须先修的设计缺陷**，都源于把 intel 的处置方式机械照搬到代码场景：

1. **负缓存只缓存负判决**（P2 不成立）⇒ 正命中文件每日重判 + LLM 非确定性 + absent 自动关闭 = finding 抖动且重开时丢失 suppression 上下文。修法：双极 verdict 缓存，键含内容哈希与模型/提示版本；该修法同时消除 skipped 误关向量（P4-②）。
2. **指纹含片段内容哈希**（P3 不成立）⇒ 代码编辑即换新身份，suppression 与历史断裂。修法：指纹只用稳定身份键，内容哈希降级到 metadata。

另有两项须写进方案条文：result metadata 的模型/签名审计字段（P5）、端口契约的 pinned revision 传递（P6-②）。

维度评分：架构契合 5/5；finding 身份设计 2/5；成本与生命周期交互 2/5；可审计性 4/5；落地路径 4/5。

## 9. 修复优先级（进入 ADR 前的必须项）

1. 负缓存 → 双极 verdict 缓存（定义键与 TTL、unavailable 不缓存沿用）。
2. 指纹去内容哈希，身份键定稿（建议 criterionKey + path + 符号名，符号不可得时退 path）。
3. 端口契约补 pinned revision（list 返回、read 消费）。
4. 方案条文补 result metadata 审计字段清单。

## 10. 台账指针

本轮为 plan scope，问题均为设计期缺陷，待 ADR 定稿后随实现验证；暂不单独入 findings.md。
