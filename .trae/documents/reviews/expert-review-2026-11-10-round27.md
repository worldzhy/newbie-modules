# Expert Review Round 27 — plan scope：「AI 全量扫码即简单过程」主张评审

## 1. 锚点

| 字段 | 值 |
|---|---|
| 仓 | newbie-modules（模块真源） |
| branch | dev |
| HEAD | 1b4a8a6 |
| 工作树 | 干净（0 dirty 文件，`git status --porcelain` 无输出） |
| 评审时间 | 2026-11-10 00:29–00:50 CST |
| 并行会话 | 被审域无在途改动，结论非 provisional |
| scope | plan（对话内方案主张，主要触及 newbie-modules 的 evaluation + security-evaluation） |
| git 来源 | GitHub Desktop 内置 git（无系统 git） |

## 2. 范围与方法

被审主张（用户原话）：「我的直觉是用AI全量scan代码，然后做全方位的评估并输出若干条评估结论，是一个很简单的过程。只需要实现evaluation骨架的一部分。」

方法：拆主张 → 逐条映射依赖代码 → 命令取证（grep/read，全部行号经 Glob/Read 复核）→ 独立反驳轮（无共享上下文的 Explore 代理，仅移交主张文本 + 依赖路径；部分独立：同基础模型）。骨架指 `packages/modules/evaluation`；扩展面指 `packages/modules/security-evaluation`。

依赖路径：`packages/modules/evaluation/{ports/evaluation.contracts.ts, evaluation-runner.service.ts, evaluation-finding.service.ts}`、`packages/modules/security-evaluation/{criteria/, evidence/, judgment/, ports/, security-evaluation.module.ts}`。

## 3. 主张判定表

| # | 主张（拆解后） | 判定 | 依据 |
|---|---|---|---|
| C1 | 「AI 全量扫描」作为运行形态与骨架兼容 | **成立，且是必需而非选择** | `resolveAbsentFindings` 会把本 run 未再观察、且 lastSeenAt 早于 run 开始的同 evaluationKey open finding 直接置 RESOLVED（`packages/modules/evaluation/evaluation-finding.service.ts:94-129`）。全量扫描与该语义天然吻合；部分/增量扫描会误关 finding。 |
| C2 | 「输出若干条评估结论」即骨架产物 | **不成立（按字面）** | finding 入库前经 `validateJudgment` 硬校验：必须引用 ASSERTION criterion、SCORED criterion 不得夹带 finding、每个 evidenceRef 必须命中本 run manifest 的 item id（`packages/modules/evaluation/evaluation-finding.service.ts:54-74`）；runner 端 `coverage.problems` 非空即抛错（`packages/modules/evaluation/evaluation-runner.service.ts:193-199`），unconsumed 由「manifest − evaluated − skipped」派生（`packages/modules/evaluation/ports/evaluation.contracts.ts:111-115`）。自由文本结论无法落库，必须结构化：枚举证据项 + 输出 schema 校验 + 证据引用。 |
| C3 | 「全方位评估」 | **不成立（措辞）** | 评估边界 = criteria seed 枚举的断言集（现有 4 个 seed 函数：`security-evaluation-criteria.seed.ts:66/85/111/136`），不是开放式「全方位」；且 ADR-020 D5.3 禁止复合评分，产物是断言式 findings 而非评分报告。 |
| C4 | 「AI 直接全量扫，无需确定性中间层」 | **部分成立** | 骨架不强制中间层：机制组合是注册表数据变更（`judgment/security-evaluation-mechanism.registry.ts:14-28`，ADR-046），单一 `code-llm` 机制 + 文件清单证据层即可满足契约；CodeGraph/opengrep 类工具是召回增强而非契约必需。**但**「直接」不成立于端口层：现有 `RepositoryAccess` 只有单文件 `getFile`（`ports/repository-access.port.ts:12-15`），无列举能力，AI 连「全量」的文件清单都拿不到——端口必须扩展（模块侧）+ 宿主适配（nightwatch `src/application/security-evaluation/repository-file-access.ts` 现仅为单文件实现）。 |
| C5 | 「只需要实现 evaluation 骨架的一部分」 | **部分成立，措辞误导** | 对骨架（`packages/modules/evaluation`）：零改动，成立——criteria/evidence/judgment 均为 kind-scoped 端口注入（`security-evaluation.module.ts:137-171`），新 evaluationKey 不触发骨架分支。对交付面：不成立——需实现 security-evaluation 模块**全部集成点**（8 处，见 §4），不是「一部分」。 |
| C6 | 「一个很简单的过程」 | **不成立（对过程）** | LLM 判定的最低纪律已由 intel 路径固化，新机制不能低于它：严格 JSON schema 校验、不合 schema 即 throw（`judgment/intel/security-evaluation-intel-re-ranker.ts:126-146`）；byte-identical 请求签名 + 负缓存、unavailable 永不缓存（`judgment/intel/security-evaluation-intel-request.ts:46-75`、`judgment/intel/security-evaluation-intel-match.service.ts:85-167`，ADR-045）。另有骨架外的硬约束：源码是 prompt 注入面需隔离、密钥类不得出宿主、每仓每日全量 LLM 成本需预算/缓存兜底。架构简单 ≠ 过程简单。 |

## 4. 新 evaluationKey 的最小集成面（命令取证）

一个新 evaluationKey（如 `code-scan`）端到端跑通所需的集成点，共 8 处（骨架 0 处）：

1. 常量：evaluationKey + 规则集版本 + 机制名（`security-evaluation.constants.ts`）
2. criteria seed 函数（现有 4 个：`security-evaluation-criteria.seed.ts:66/85/111/136`）
3. criteria provider 分支（repository kind 当前默认 `npm-osv`：`security-evaluation-criteria.provider.ts:47-51`）
4. 机制注册表条目（`judgment/security-evaluation-mechanism.registry.ts:23-28`）
5. 机制实现（`judgment/` 下现有 dependency / aws-config / intel 三个）
6. 证据 provider 分支（`evidence/security-evaluation-evidence.provider.ts:83-109`，当前按 evaluationKey 分 intel / lockfile 两路）
7. 端口定义 + DI 绑定（`ports/` 现有 2 个；module 工厂 `security-evaluation.module.ts:137-159`）
8. 宿主适配器 + 装配（nightwatch `src/application/security-evaluation/` 现有 `repository-file-access.ts`、`security-evaluation-wiring.module.ts`）

## 5. 方案外新发现

- P2（设计提示，非代码缺陷）：`RepositoryAccess.getFile` 的单文件契约（`ports/repository-access.port.ts:12-15`）决定 npm-osv 只能扫根目录白名单文件；code-scan 需新端口或扩展语义，该决策应先出 ADR（设计前置 ADR 规则），避免「边做边改契约」。

## 6. 误报剔除

- 无（本轮无 finding 被推翻；反驳轮对 C2/C4 的攻击与主会话读码结论一致）。

## 7. 已核验通过的不变量（正面结论）

- 骨架对新 evaluationKey 零改动：机制组合为数据变更，注册表对未知/重名机制 fail-closed 抛错（`security-evaluation-mechanism.registry.ts:44-53`）。
- LLM 判定纪律有可复制先例（intel：schema 校验 + 签名负缓存 + unavailable 不缓存）。
- 全量扫描与 finding 生命周期（absent→RESOLVED）语义自洽，无契约冲突。
- 判定输出不可信路径已有防线：criteria 校验 + manifest 证据引用校验 + coverage problems 抛错（三处均上文引证）。

## 8. 覆盖率清单

已审：evaluation runner 执行路径（L170-229）、finding 记录/关闭（L40-130）、contracts 证据与 coverage 段（L75-125）、security-evaluation 的机制定义/注册表、criteria provider/seed、evidence provider 取证段、repository 端口、intel LLM 路径的校验/请求/缓存、module DI 装配面、ADR 目录清单（grep 命中 15 份含 ADR-045/046/020）。

未审：aws-config judgment 内部、work-evaluation 模块、宿主 wiring 内部实现细节（仅确认文件存在）、前端、部署面、Runner 的 stale-run reaper 与事件发布路径。

## 9. 结论摘要

用户主张的**方向**成立：骨架确能以零改动承载「AI 全量扫码」新 evaluationKey，且全量语义与 finding 生命周期天然吻合；「只需要实现骨架的一部分」若读作「骨架零改动」为真。但主张的**字面形态**不成立：产物必须是绑定 criterion 与 manifest 证据引用的结构化 findings（非自由结论），交付面是模块侧 8 处集成点 + 宿主端口扩展 + LLM 判定纪律（schema/负缓存/注入防护/密钥不出境），「很简单」只在架构分层意义上成立，在实现与运营成本意义上不成立。修订表述建议：**「骨架零改动；模块内补齐一个 evaluationKey 的全套集成点，AI 判定沿用 intel 已固化的校验与缓存纪律」**。

维度评分（仅针对主张与骨架契合度）：架构契合 5/5；产物契约认知 2/5；实现面认知 2/5；运行语义（全量/生命周期）5/5。

## 10. 台账指针

本轮无 finding 需入台账（plan scope，无 P0/P1）；§5 的 P2 为设计提示，随 code-scan ADR 一并处理，不单独入 findings.md。
