# ADR-022: 安全评估板块重建为 security-evaluation

状态：提议中
日期：2026-10-25

> 归属：registry 模块边界与契约决策 → 本仓。宿主侧实施（主体来源、凭证与外部访问、通知模板、调度装配、读模型与 UI）归 nightwatch-backend / nightwatch-frontend，随本决策同步改造。
>
> 与既有 ADR 的关系：**本 ADR 不取代任何 ADR**。`threat-intelligence`、`aws-audit`、`dependency-scan` 三个模块及其既有契约（含 newbie-modules ADR-018 的 match 表 scope 形状与 `ScopeEntitiesProvider` 端口）原样保留、继续生效；本 ADR 只新建 `security-evaluation` 模块，四个模块并存。切换、下线与旧模块处置由用户后续单独决定，不在本 ADR 决定。

## 背景

安全板块目前是三个独立模块：`threat-intelligence`（情报采集与相关性匹配）、`aws-audit`（云配置合规）、`dependency-scan`（依赖漏洞）。三者各自持有 Prisma schema、各自一套运行状态机、各自一套 REST 端点与定时任务，互不调用；唯一的汇合点是宿主 `project-security` 子域的聚合读模型。

复盘暴露六类问题，其中前四条有代码证据：

1. **同一模式写了三遍**。`AwsAuditFinding` 与 `DependencyScanFinding` 的 11 个字段中 9 个完全相同（`status` / `severity` / `title` / `detail` / `firstSeenAt` / `lastSeenAt` / `resolvedAt` / `createdAt` / `updatedAt`），三张 scan 表重复同一套 `PENDING/RUNNING/SUCCESS/FAILED` 状态机。
2. **没有资产清单**。依赖扫描只在扫描瞬间解析 lockfile，产出 findings 与 `packagesScanned` 计数后即丢弃包清单；云审计的资源清单只活在单次 scan 的 `report.resources` JSON 里。持久化的只有 findings。后果：报告只能回答「有什么问题」，回答不了「体检了哪些东西」「某个新披露的 CVE 影响我哪些资产」「上次覆盖而这次未覆盖的差异」。
3. **判定机制被当成一种**。依赖漏洞是「版本区间判定」（OSV 实时 API），云配置是「基线合规判定」（CIS 规则），情报相关性是「语义相关性判定」（硬召回 + LLM 精排）。三者知识来源不同（外部漏洞知识 / 内部基线规则），生命周期要求相反——`threat-intelligence` 的 `DEFAULT_RETENTION_DAYS = 90`、`MAX_ITEMS_PER_SOURCE = 1000` 无法承担「被评估引擎长期查询的漏洞知识库」职责，而依赖与配置判定必须机械可复现。
4. **准则清单有两份**：`ruleIdToCisControl`（aws-audit 模块内）与 `CIS_CONTROL_CATALOG`（宿主 compliance 子域内），服务代码注释写着「Keep this list in sync」。
5. **情报相关性已实现却不进报告**。`ThreatIntelligenceMatch` 支持按 `scopeType` / `scopeId` 过滤查询，技术上一条查询即可取到某工程的全部命中；但 `security-overview` 只聚合 aws 与 dependency 两份报告。
6. **有发现、无整改**。三模块到 `status=open/resolved/suppressed` 即结束，没有整改对象（对比 `PipPlan` 有 checkpoints 与决策人）。

需要在动代码前决定：是否推倒重来、重建后的模块边界与数据模型、判定能力的分配、以及本模块与宿主的耦合方式。

## 候选方案

- **A 重建为单一 feature：security-evaluation**。一个 registry feature 模块，建在 ADR-020 的 `evaluation` 骨架之上，内部子域划分；资产清单成为第一等持久化实体；三种判定机制共用一套 finding 与报告，各自保留自己的准则来源。
- **B 保持三个模块，只统一 finding 模型**。把两个 finding 表合并为一张、共用生命周期，模块边界不变。比 C 好，但资产清单仍然缺失，判定机制仍然无法共享 run 与覆盖率语义，知识保留策略仍然与「长期知识库」冲突。
- **C 保持现状**。上述六条缺陷全部保留。

## 决策

选 **A**。决定性理由：问题不在「三个模块太多了」，而在**同一个模式被实现了三遍**，且三角关系中缺失了「资产」这一根支柱——没有资产清单，任何体检报告都退化为问题列表，任何新增检查族都要再写一套资产身份。把三者对应的能力收进一个新的 bounded context、资产作为第一等实体、判定器作为插件，才能让「同一份代码资产在不同准则族下的结论」第一次可以并列呈现。

### D1. 命名与子域划分

模块名 **`security-evaluation`**（`layer: feature`），与骨架 `evaluation`、以及 `work-evaluation` 同族。不采用 `security-posture`：posture（态势）在业内偏「持续运行时监控」，而本模块的边界是**工程资产的静态/准静态评估**，不含运行时监控（属 `web-monitor` / `backend-monitor`），不含认证审计。这条边界必须写进模块 README。

内部子域：

```
security-evaluation/
  knowledge/    外部漏洞知识库（骨架外，本模块独有）
  evidence/     资产清单：Asset + AssetFact（EvidenceProvider 实现）
  criteria/     规则目录：Rule（CriteriaProvider 实现）
  judgment/     判定器：DEPENDENCY / CLOUD_CONFIG（确定性）+ INTEL（硬召回 + LLM）
  findings/     Finding 语义与整改绑定（Finding 表在骨架）
  reporting/    读模型：覆盖率 × 多轴 × 趋势 / MTTR / 合规
```

### D2. 资产清单是第一等实体，且归本模块而非骨架

`Asset`（`kind` ∈ `REPOSITORY` / `CLOUD_RESOURCE`，加 `naturalKey` 与泛化 scope 坐标）与 `AssetFact`（`factType` + `value` + `observedAt`：`package@version`、`region`、`encryption`、`publiclyAccessible`、`isDev` 等）。

不进骨架的理由：work 与 security 的证据形态不同（workspace / session / document 对比包清单 / 配置事实），强行统一会造出一张什么都能装的 `factType` 表。骨架只持有泛化的 `EvaluationSubject`。

### D3. 三种判定机制、两门知识，不混用生命周期

| 机制 | 判定依据 | 知识来源 | 复现性 |
| --- | --- | --- | --- |
| 版本级漏洞匹配 | 包名 + 版本 vs affected range | OSV（外部实时能力） | 机械可复现 |
| 配置基线合规 | 资源事实 vs 期望值 | CIS 规则目录 | 机械可复现 |
| 情报相关性匹配 | 情报实体 vs 工程画像 | 漏洞知识库 | 语义判断，不可机械复现 |

知识库保留策略按门类分开：**漏洞知识长期留存、按披露周期刷新；新闻与平台事件保持现有 90 天 / 每源上限**。把 OSV 塞进知识库当唯一数据源被否决——OSV 提供的是跨生态版本区间判定这一**能力**，不是可静态搬运的数据；知识库的正确定位是**紧迫性层**（KEV、exploited-in-wild、厂商通告、恶意包投毒），为 finding 补充 `signalTags`。

### D4. 判定方法按「可否机械复现」分配

- 版本区间判定与配置基线判定**必须硬编码**：引入 LLM 会同时失去可审计性与可复现性，且无收益。
- 仅情报相关性使用 LLM，并原样保留 ADR-018 已落地的护栏：硬召回先行（实体精确匹配即出 `confidence=HIGH`）、LLM 只在未命中且（severity ≥ medium 或带 signalTags）时介入、`semanticMatch` 单独成立永不通过、temperature=0 + 强制 JSON、`unavailable` 不写负缓存、按 `(item, scope)` 对数的 work budget。
- AI 若用于修复建议或结论叙述，属 reporting 层的表达，不得回流到「判定是否成立」的路径。

### D5. `severity` 与 `urgency` 分为两轴

`severity` 是知识条目的固有属性；`urgency` 由 `severity` × `signalTags`（KEV / exploited-in-wild）× 暴露事实（是否生产依赖、是否公网可达）派生。今天 `isDev` 只被存储、从未参与任何优先级计算——资产清单正是让这类事实发挥作用的入口。

### D6. 报告多轴，禁止单一总分

暴露风险 / 合规 / 情报相关性三轴分别呈现、各自口径，不合成 health score。依据：三种判定的误报率相差一个数量级，混分母等于让最不精确的机制污染最精确的机制。骨架 D5 的「无复合分」不变量已在契约层禁止总分字段。

### D7. 规则元数据入表，判定逻辑留在代码

`Rule` 表持有 `ruleId` / benchmark 标识与版本 / `controlId` / severity / `factRequirements` / 修复指引引用；判定逻辑仍在 `judgment/` 的代码里。这解决背景第 4 条的双份清单问题，同时不引入规则 DSL——完整规则语言属过度设计。

### D8. 模块内零宿主表读取

模块不 `import` 宿主 Prisma 模型、不读 `project` / `application`、不依赖宿主 `provisioningStatus` 语义。所需一切经端口注入：`SubjectProvider` 由宿主实现并给出 scope 坐标；仓库可访问性判断等宿主策略降级为资产事实，由 `EvidenceProvider` 提供。

### D9. 保留既有能力，不做无谓重写

原样保留：OSV 版本区间判定、KEV 与 signalTags、B3 精排协议与 false-positive 负缓存、`AwsAuditReport.limitations` 式的覆盖率诚实声明、ADR-008 仓库可访问性谓词、finding fingerprint 幂等 upsert 与「未复现即 resolved」的收敛逻辑。

### 并存与切换边界

三个既有模块（`aws-audit` / `dependency-scan` / `threat-intelligence`）**一行不动**，继续按各自契约运行；宿主侧 `project-security` 子域在切换前仍消费它们。本 ADR 只做加法：新建 `security-evaluation`，不修改、不删除、不迁移任何现有模块与数据。

由此产生一条已知代价，必须显式承认：并存期间存在**两套知识采集与两套相关性匹配**（`threat-intelligence` 的采集与 match pipeline，与本模块 `knowledge/` + `judgment/` 的 INTEL 判定器）。这在切换前是预期成本——本模块的价值在于证明「资产清单 + 统一 finding 生命周期 + 多轴报告」这套模型成立，而不是与旧模块争运行时。并存期间不得把两边结果混进同一份报告或同一个评分分母。

切换时点、切换方式（一次性切换还是按检查族逐个切换）以及旧模块的最终处置，均属后续决策，不在本 ADR 决定。

## 跨宿主 / 演进检验（registry 模块设计必填）

| 维度 | 框架层（本模块） | 宿主层 |
| --- | --- | --- |
| 被评主体 | `kind` ∈ REPOSITORY / CLOUD_RESOURCE，泛化 scope 坐标 | 注入 `SubjectProvider`，给出自己的 scopeType（nightwatch 用 `project`）与资产来源 |
| 资产事实 | `AssetFact` 的 `factType` 由本模块定义，值由取证方提供 | 实现取证：仓库 lockfile 解析、云账号资源枚举与凭证 |
| 准则 | `Rule` 元数据 + 知识库条目；版本化只读 | 不参与 |
| 判定 | 三个判定器，确定性优先、情报用 LLM | 绑定 llm 模块的 scope；未绑定则情报判定降级为 unavailable |
| 报告 | 覆盖率、多轴计数、趋势与 MTTR 的读模型 | 产品化呈现与通知模板 |
| 调度 | 只声明需要运行的评估种类与频率语义 | 宿主装配 cron 与触发条件 |
| 可移植性 | 新宿主实现两个端口即可获得完整「知识 + 资产 + 判定 + 报告」能力 | 资产来源与 scope 粒度属宿主 |

无 nightwatch 词汇进入模块；模块内不出现 `project` / `application`。

## 未在此 ADR 决定的事

- 漏洞知识库各门类的具体保留天数与刷新节奏。
- 是否引入共享资产台账（跨 feature 复用 `Asset`）。当前判断：不建。
- 资产事实的具体 `factType` 清单与各检查族的 `factRequirements` 定义。
- 整改对象的产品化形态（是否与 work-evaluation 共用同一套 UI）。
- 构建顺序与切片划分。

## 影响

更容易：资产维度成为所有报告与查询的共同坐标，覆盖率、漏洞反查资产、资产差异都成为可回答的问题；三种判定共用一套 run 与 finding 生命周期，趋势与 MTTR 口径统一；新增检查族（secret / IaC / 镜像扫描）只需新增 `factType` 与判定器，不新增表；规则的 control 映射只有一份。

更难：模块体量显著大于任一原模块，需要靠子域边界而不是包边界维持可读性；资产清单为空时报告会暴露「覆盖率不足」这一过去被掩盖的事实（这正是期望行为）；并存期间要维护两套安全数据与两套知识采集，且必须抵抗「把两边结果混进同一份报告」的诱惑，直到切换决策作出。

后续工作：① 按 D1 的子域边界交付模块骨架与 DEPENDENCY / CLOUD_CONFIG 判定器；② 宿主侧装配与切换在旧模块保持运行的前提下单独排期，不在本 ADR 内收口；③ 行为级测试随代码交付：finding 生命周期与幂等、覆盖率口径、urgency 派生、知识清理后 finding 完整性、运行并发约束。
