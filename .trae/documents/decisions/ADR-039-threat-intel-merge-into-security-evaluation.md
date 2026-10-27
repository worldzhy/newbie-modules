# ADR-039: threat-intelligence 能力迁入 security-evaluation，独立模块下线

状态：已采纳（2026-10-27 用户批准）
日期：2026-10-27

> 归属：registry 模块边界与契约决策 → 本仓。宿主侧实施（ScopeEntitiesProvider 重绑、通知重绑、调度重绑）归 nightwatch-backend，随本决策同步改造。
>
> 与既有 ADR 的关系：本 ADR 修订 ADR-022「并存与切换边界」中"两套相关性匹配是预期成本"的条款（见 ADR-022 Errata）。ADR-018 的 B3 匹配协议与护栏（硬召回先行、LLM 精排条件、unavailable 不写负缓存）保持生效，实现位置从 threat-intelligence 模块迁至 security-evaluation。

## 背景

ADR-022 决定新建 security-evaluation 时，三个旧模块（dependency-scan / aws-audit / threat-intelligence）原样保留、并存运行，security-evaluation 自建 knowledge/ 采集与 INTEL 判定器。当时的理由是"security-evaluation 方向尚未验证，并存是风险对冲"。

截至 2026-10-27，security-evaluation 已交付 DEPENDENCY（OSV）与 CLOUD_CONFIG（CIS + aws-custom）两个判定器，骨架方向成立。并存的代价——两套情报采集、两套匹配管线、跨模块消费——已无正当性。

同时，threat-intelligence 的采集+匹配本质上是 security-evaluation 的内部能力：
- 情报采集 = knowledge/ 子域的知识获取
- 相关性匹配 = judgment/intel/ 判定器的判定逻辑

将其放在独立模块，迫使 security-evaluation 的 INTEL 判定器跨模块消费 match，引入无谓耦合（跨 schema 读 / HTTP 自调用 / SPI port 转发）。

## 候选方案

- **A 迁入 security-evaluation（推荐）**：threat-intelligence 的 7 个采集适配器、knowledge item 表、匹配管线、re-ranker 整体迁入 security-evaluation 的 knowledge/ + judgment/intel/。ThreatIntelligenceMatch 表删除，INTEL 判定直接产出 EvaluationFinding。独立模块下线。
- **B 保持独立，security-evaluation 消费 match**：threat-intelligence 不动，security-evaluation 通过 SPI port 读 match。两套采集、两套匹配长期并存。
- **C 维持 ADR-022 字面（两套自建）**：security-evaluation 重写一套采集+匹配。完全复刻 ADR-018 的工作。

## 决策

选 **A**。决定性理由：
1. 情报采集与匹配是 security-evaluation 的内部能力，不是独立平台服务。将其外挂违反"模块自包含"。
2. 消除并存期间的两套采集、两套匹配维护成本。
3. security-evaluation 的 INTEL 判定器直接读本模块 knowledge 表，零跨模块耦合。
4. secret / IaC / 镜像扫描等规划中的检查族本就是 security-evaluation 的判定器，直接复用 knowledge/ 子域，无需跨模块消费。

### D1. 采集适配器迁入 knowledge/adapters/

7 个适配器（GitHub Security Advisory、CISA KEV、AWS Security Bulletins、GitHub Security Blog、FreeBuf、The Hacker News、BleepingComputer）从 `threat-intelligence/adapters/` 迁入 `security-evaluation/knowledge/adapters/`。采集逻辑不变，仅更新 import 路径与 provider 注册。

### D2. ThreatIntelligenceItem → SecurityEvaluationKnowledgeItem

表迁入 `module/security-evaluation` schema，字段不变（source、category、externalId、title、summary、url、publishedAt、severity、signalTags、rawPayload、fetchedAt、lastSeenAt），去重键 `[source, externalId]`。

### D3. ThreatIntelligenceMatch 表删除，INTEL 判定直接产出 EvaluationFinding

不保留独立 match 表。INTEL 判定器对每个相关 match 产出一条 EvaluationFinding（family=threat-intel-relevance），metadata 承载 `{ knowledgeItemId, matchedEntity, confidence, evidence, verdictSource }`。非相关 match 不产 finding，记入 evaluatedRefs。

理由：finding 已有完整生命周期（open/resolved/suppressed），match 的状态机是冗余的。匹配中间过程（re-rank 推理）通过日志与事件追踪，不需落库。

### D4. ScopeEntitiesProvider → SecurityEvaluationScopeEntitiesProvider

port 接口迁入 security-evaluation，契约不变（输入无，输出 `{scopeType, scopeId, entities[]}` 列表）。宿主 ProjectSecurityProfileService 改为实现新 port。

### D5. ADR-018 护栏保留

硬召回先行（实体精确匹配即 confidence=high）；LLM 仅在未命中且（severity >= medium 或 signalTags 非空）时介入；semanticMatch 单独成立永不通过；temperature=0 + 强制 JSON；unavailable 不写负缓存。实现位置迁移，逻辑一字不改。

### D6. 通知与调度重绑

通知从监听 `threat-intelligence.match-created` 改为监听 evaluation finding 生命周期事件，过滤 family=threat-intel-relevance。采集调度 job 改指向 security-evaluation knowledge collect service。

## 跨宿主 / 演进检验

| 维度 | 框架层（registry） | 宿主层 |
| --- | --- | --- |
| 情报采集 | knowledge/ 子域内置 7 适配器 + SecurityEvaluationKnowledgeItem 表 | 无（采集是模块内部能力） |
| 匹配判定 | judgment/intel/ 内置匹配管线 + re-ranker，产出 EvaluationFinding | 无 |
| scope 实体来源 | SecurityEvaluationScopeEntitiesProvider port | 宿主实现（ProjectSecurityProfileService） |
| 通知/调度 | 模块发 finding 生命周期事件 | 宿主监听并过滤 family，装配 cron |

无 nightwatch 词汇进入 registry；scopeType/scopeId 保持泛化无 FK。

## 影响

更容易：security-evaluation 自包含完整的情报采集+判定能力，无跨模块耦合；维护一套管线而非两套；未来检查族直接复用 knowledge/。

更难：一次性迁入工作量大（7 适配器 + 匹配管线 + 表迁移 + 宿主重绑）；threat-intelligence 既有行为测试需随代码迁入。

后续工作：① 按 tasks.md M1-M3 分阶段实施；② ADR-022 追加 Errata 撤销"两套匹配"条款；③ 行为级测试随代码迁入（re-ranker 7 个既有测试 + match service 测试）。
