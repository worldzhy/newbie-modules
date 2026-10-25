# ADR-018: threat-intelligence 整理层下沉 registry（模块交付完整收集+整理能力）

状态：提议中
日期：2026-10-25

Supersedes: nightwatch-backend ADR-031 的第 0 节「分层：平台模块 vs 宿主消费层」及其在第 5 节数据模型、第 6 节定时任务编排、「跨宿主 / 演进检验」中的相关推论（"平台模块不依赖 llm、不认识 Project/Application、B3 匹配与 ThreatIntelligenceMatch 落库归宿主消费层"）。ADR-031 其余章节（信息源分类 A2、匹配判定协议 B3 的方法论、项目画像 C2、保留策略、通知策略）保持生效。

> 归属：registry 模块边界契约决策 → 本仓。宿主侧实施（画像数据来源绑定、通知模板与编排、调度装配）归 nightwatch-backend，随本决策同步改造。

## 背景

ADR-031 把 threat-intelligence 切成两层：registry 只做平台采集（适配器、去重入库、保留清理、只读 API），项目匹配（规则硬召回 + LLM 结构化精排 + Match 落库）整体留在宿主 `src/application/project/security/threat-intelligence`。当时的理由是"平台模块不依赖 llm、不认识 Project/Application，可被任意宿主零改动复用"。

实施完成后复盘，该分层暴露三个问题：

1. **模块能力不完整**：脱离宿主后，registry 模块只有"收集"没有"整理"——任何新宿主接入都要重写一套 LLM 精排 + match pipeline（窗口候选、负缓存、upsert 去重、match-created 事件），这套逻辑是模块方法论（B3 协议）的直接实现，不含任何 nightwatch 特有概念，却被锁在宿主仓里不可复用。
2. **"不依赖 llm"成为能力阉割的理由**：用户 2026-10-25 明确拍板——"我认为应该依赖，不依赖 llm 如何实现完整的收集和整理功能"。llm 模块（ADR-004/ADR-005）本身已是平台级能力，registry 模块依赖它不构成宿主绑定。
3. **唯一真正宿主特有的部分只是"实体来源"**：match 所需的"项目实体集合"（包名/仓库/域名/供应商）来自宿主业务表（Project/Application/ProjectDependency/ProjectMember）。这部分正确形态是 SPI port，而不是把整个整理层留在宿主。

需要在动代码前决定：整理层（LLM re-rank、entity 召回、match pipeline、match 表、查询端点）是否整体下沉 registry；下沉后 match 表的 scope 形状；通知与调度的归属。

## 候选方案

- **A 整理层整体下沉**：registry 模块交付"收集 + 整理"完整能力——新增 matching 子单元（re-ranker 协议、entity 召回、触发规则、match pipeline、负缓存、match-created 事件）、match 表进模块 schema、通用查询端点；模块依赖从 `["security"]` 改为 `["security","llm"]`。宿主只保留：实体来源 port 的实现（画像服务）、通知模板与编排、调度装配。
- **B 维持 ADR-031 分层**：整理层继续留宿主。模块保持零 llm 依赖，但能力不完整，每个新宿主都要重写整理层。
- **C 纯函数核下沉 + pipeline 留宿主**：只把 re-ranker 的 prompt/parse/硬约束等纯函数抽进 registry，match pipeline（数据库读写、负缓存、事件）留宿主。把一条状态机 pipeline 切成两半，两边的测试和演进都要跨仓对齐，是纯理论上的解耦、实践中的割裂（用户已否决）。

## 决策

选 **A**。决定性理由：整理层是 B3 协议的直接实现，不含宿主概念；"不可复用"违反零容忍三件套。实体来源这一唯一宿主特有部分以 SPI port（`ScopeEntitiesProvider`）抽象，宿主注入实现——与 ADR-012（RBAC SPI）、ADR-017（scope 名称宿主配置）同一模式。

### D1. match 表 scope 形状（选 A）

match 表用泛化 scope 两列：`scopeType`（varchar，如 `"project"`）+ `scopeId`（uuid 字符串，无 FK），唯一键 `{scopeType, scopeId, itemId, matchedEntity}`。不用单 `projectId` 列——跟随 aws-identity 作用域列先例（无 FK 作用域列），模块不绑定任何宿主的 Project 概念；scopeType 保留未来其他粒度（application、installation）的扩展位。`itemId` 逻辑引用同模块 `ThreatIntelligenceItem`，不建外键（模块按保留策略裁剪情报，消费方必须容忍悬空引用——ADR-031 原边界规则保留）。

### D2. 通知模板 / digest 编排 / 调度装配留宿主（选 A）

通知是**分发**不是**整理**：模块在 match 创建时发 `match-created` 领域事件，是否推送、推送模板、digest 聚合节奏、调度时间均为宿主产品决策。registry 不出通知模板、不出 cron 装配。

### D3. registry 出通用查询端点（选 A）

模块直接提供 `/threat-intelligence/matches?scopeType=&scopeId=` 的 list / get / patch-status 端点。宿主薄壳 controller 转发方案被否——纯转发胶水不可复用，违反零容忍三件套。前端改调通用端点路径。

### 下沉清单（registry 新增）

- `matching/` 子单元：re-ranker 整类（SYSTEM_PROMPT 注入防御、parseVerdict、enforceHardConstraint、ReRankVerdict 三态 kind）、entityAppearsIn 召回、RE_RANK 触发规则（severity/signal 阈值）、match pipeline（窗口候选、已匹配跳过、负缓存 upsert、match-created 事件）、ScopeEntitiesProvider port 接口。
- prisma schema 新增 `ThreatIntelligenceMatch` 模型（`module/threat-intelligence` schema）。
- `moduleDependencies: ["security", "llm"]`；经 `ChatModelResolver` 按 scope（`"threat-intelligence"`）解析模型，scope 未绑定时降级为 `unavailable` 三态，不视为故障。
- 通用 matches controller（list / get / patch-status，按 scopeType+scopeId 过滤）。

### 留宿主清单（nightwatch-backend 改造）

- `ProjectSecurityProfileService`：保留画像构建（读宿主 Project/Application/ProjectDependency/ProjectMember），改为实现/绑定 registry 的 `ScopeEntitiesProvider` port，scope 输出 `{scopeType: "project", scopeId: projectId}`。
- 通知：两个模板 + 编排 service 监听 `match-created` 事件（rewire 到下沉后的事件源）。
- 调度 job：rewire 到下沉后的 match 服务（collect + match 编排入口）。
- 删除宿主侧已下沉文件；前端改调通用端点路径。
- match 表从 `application` schema 搬到模块 schema：nightwatch 未上线，直接改 schema + 重建 dev 库，不写数据迁移。

## 跨宿主 / 演进检验

换一个宿主消费本模块：

| 维度 | 框架层（registry，本 ADR） | 宿主层（实施） |
|---|---|---|
| 实体来源 | `ScopeEntitiesProvider` port：输入无，输出 `{scopeType, scopeId, entities: ProfileEntity[]}` 列表 | 宿主注入实现，从自己的业务表推导画像实体 |
| scope 语义 | 模块只透传 `scopeType`/`scopeId` 两列，不定义枚举 | 宿主自定 scopeType 值（nightwatch 用 `"project"`）与 id 语义 |
| LLM 绑定 | 经 llm 模块按固定 scope `"threat-intelligence"` 解析 | 宿主在 llm 模块绑定该 scope 的连接；未绑定时模块降级为 `unavailable`，不出假阳性 |
| 通知/调度 | 模块发 `match-created` 领域事件 | 宿主自编排模板、digest、 cron |
| 可移植性 | 任意消费方按本 ADR 装配即可获得完整收集+整理能力 | 画像来源与 scope 粒度是宿主特有 |

无 nightwatch 词汇泄漏进 registry；llm 依赖是平台模块间依赖，不构成宿主绑定。

## 影响

更容易：模块交付完整"收集+整理"能力，新宿主只需实现一个 port 即可获得项目级威胁匹配；B3 协议的实现与测试集中在一处，演进不再跨仓对齐；match 数据随模块走，scope 泛化保留扩展位。

更难：模块新增对 llm 的硬依赖，llm scope 未绑定的宿主只能走"硬召回"路径（LLM 精排降级为 unavailable）；scope 无 FK 意味着悬空引用容忍度要求贯穿消费方。

后续工作：① nightwatch-backend 按"留宿主清单"改造并重建 dev 库；② ADR-031 状态行改为「已采纳（第 0 节分层及相关推论由本 ADR 取代）」；③ 前端端点路径切换；④ 行为级测试随代码下沉（re-ranker 7 个既有测试迁入 registry）。
