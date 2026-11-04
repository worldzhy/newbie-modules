# Findings 台账（newbie-modules）

评审报告：`.trae/documents/expert-review-2026-10-31-round4.md`（scope=`modules: [security-evaluation]`）。

字段：ID / 仓 / 标题 / severity / 暴露面 / 可达性 / 状态 / 回归指针。

| ID | 仓 | 标题 | 严重度 | 暴露面 | 可达性 | 状态 |
|---|---|---|---|---|---|---|
| R4-01 | newbie-modules | `newbie.module.json` 未声明 `llm`，与物理 import 矛盾；`newbie modules lint` 报错 | P1 | artifact（已发布模块） | 新宿主装配 security-evaluation 时 | fixed：manifest 补 `llm`；registry CI 新增 `modules lint`（同批补 aws-cloudformation/tencent-cos 的 `security` 声明） |
| R4-02 | newbie-modules + nightwatch-backend | security-evaluation 读面 `scopeType/scopeId/subjectId` 完全由客户端决定，OPERATOR 可跨项目读 | P1 | live | OPERATOR（持有 Security Evaluation 权限组） | fixed：重判为架构改造（2026-11-02 用户决定 SE 为平台级模块，见 nightwatch-backend ADR-039）；registry 落地平台坐标 + ingest 契约 + `SecurityEvaluationAssetSource` 溯源，读接口 scope 降为筛选（registry `33c56e4`），消费仓装配、存量迁移与前端顶层入口同批落地 |
| R4-03 | newbie-modules | `mergeJudgments` 的 skipped 去重 items 与累加 total 不一致，多机制同跳一条时违反骨架 coverage 不变量 | P2 | source（当前每 key 单机制，不可达） | 启用多机制组合后 | fixed：`total` 改取去重条目数，补重叠 skipped 用例；ADR-046 合并契约同步 |
| R4-04 | newbie-modules | 负缓存键仅 `(knowledgeItemId, scopeKey)`，无实体集/模型版本维度，且采集层在硬召回之前过滤 | P2 | live | OPERATOR 变更项目实体后触发 INTEL 运行 | **partial（重开为 R6-09，2026-11-04）**：`16930cf` 的 TTL 与预算排序已装配生效；负缓存唯一键仍缺实体集/模型版本维度。「host 未装配」描述作废（宿主已零差异） |
| R4-05 | newbie-modules | LLM 返回输入外实体（含大小写差异）被判 `not-relevant` 并永久负缓存，应视为 `unavailable` 重试 | P2 | live | 需 LLM 输出异常/注入链条 | fixed：非法实体输出改判 `unavailable`（不缓存）；实体标签比较大小写不敏感；补用例 |
| R4-06 | newbie-modules | INTEL 在 scope provider 未绑定或 scope 缺失时静默返回空证据，运行 SUCCEEDED 且 coverage 全零 | P2 | source（宿主已绑定） | 新宿主未绑定 / subject 的 scope 已消失 | fixed：端口未绑定抛错，scope 未知抛 `BadRequestException`；补用例 |
| R4-07 | newbie-modules | 知识条目的 `summary` 被查询后丢弃，INTEL 硬召回与 LLM 只看到 title | P2 | live | 任意 INTEL 运行 | fixed：`summary` 进入 evidence payload，判定侧候选恢复该字段；补用例 |
| R4-08 | newbie-modules | ADR-045 声称的静态契约测试在 registry CI 不执行（CI 仅 format/lint） | P2 | source | 任何 registry PR | fixed（部分）：registry CI 接入 `modules lint`；模块测试仍受限于 registry 无 Nest 依赖，由消费仓 CI 承担 |
| R4-09 | newbie-modules | INTEL 证据预算按 `fetchedAt` 升序截断，硬命中永不负缓存，候选 >200 时固定头部长期占用预算 | P2 | live | 7 日窗口内未缓存候选 > 200 | **verified（2026-11-04）**：`fetchedAt desc` 排序与预算逻辑在宿主副本存在；「host 未装配」描述作废（已零差异） |

已撤销/误报：见报告 §7。

## round5（2026-11-03，scope=`workspace`，报告在 `devbie/.trae/documents/expert-review-2026-11-03-round5.md`）

只登记 registry 模块级条目；跨仓与宿主条目见 `devbie/.trae/documents/findings.md`。

| ID | 仓 | 标题 | 严重度 | 暴露面 | 可达性 | 状态 |
|---|---|---|---|---|---|---|
| R5-P2-01 | newbie-modules | notification `markRead` 不校验可见性（任意 notification id 可写回执 + 存在性 oracle） | P2 | artifact | 任意登录用户 | open |
| R5-P2-02 | newbie-modules | notification `notify` 平台级写入口不校验 `projectId` 归属；读写 DTO 契约不对称（`projectId` 读侧 `@IsUUID`、写侧仅 `@IsString`，`link` 无协议约束） | P2 | artifact | OPERATOR/ADMIN | open |
| R5-P2-03 | newbie-modules | `api-key.verifier` 从不执行 `ipRestrictions`/`referrerRestrictions`，也不校验 owner 状态（宿主暂未启用该通道） | P2 | artifact | API key 持有者（启用后） | **partial（2026-11-04）**：owner ACTIVE 校验已进入 `AccountApiKeyVerifier.verify`（`59ff47c`）；仍缺 `ipRestrictions`/`referrerRestrictions` 执行 |
| R5-P2-04 | newbie-modules | webhook 模块无权限/团队归属校验，`isSafeUrl` 不解析 DNS、不复检重定向，出站无 timeout（未装配） | P2 | source | 任意登录用户（装配后） | open |
| R5-P2-05 | newbie-modules | web-monitor `systemName` 直接编译为正则（项目范围已收敛，仅 ReDoS） | P2 | artifact | MEMBER/OPERATOR | open |
| R5-P2-06 | newbie-modules | security-evaluation 报告 `latestResultsBySubject` 无界查询（全量载入再按 key 去重） | P2 | artifact | OPERATOR/ADMIN | open |
| R5-P2-07 | newbie-modules | notification push-failures 无分页，随累积行数无界返回 | P2 | artifact | OPERATOR/ADMIN | open |
| R5-13 | newbie-modules ↔ nightwatch-backend | ClickHouse 标识符注入：registry 已加 `quoteIdentifier/quoteTable`，宿主副本仍裸插值；web-monitor `appId` 无校验（详见 devbie 台账同名条目） | P1 | live（宿主旧副本） | MEMBER/OPERATOR 且项目 EDITOR+ | **fixed（2026-11-04）**：`5adec55` 的 `assertAppId` 已在 Mongo/ClickHouse 工厂、`saveSiteData` 与 ingest 生效；宿主 `diff -rq` 与 registry 零差异 |

复核轮（2026-11-03）：R5-P2-02 的 `link` 条款降为契约不对称；R5-P2-03 的「owner 状态」修正为「verifier 端口未做该校验，且通道无调用方」（与 devbie 台账 N-1 同源）；新增 R5-13。详见 `devbie/.trae/documents/expert-review-2026-11-03-round5.md` §12。

W1 落地（2026-11-03）：`d78bf84` security 拒绝公开/过短签名密钥（启动、签名、验签三处 fail-closed）；`0891fcb` clickhouse 配置改为纯 `process.env`。根因是 manifest 中 `process.env.X || 'fallback'` 含内层引号，CLI 正则不解包、原样写成字符串字面量；devbie CLI 已补装配期告警（`5ccd7c9`），其余同类 manifest 仍待逐模块收敛。

## round6 复核（2026-11-04，scope=`workspace`，报告在 `devbie/.trae/documents/expert-review-2026-11-04-round6.md`）

状态更正（历史行保留，以本节为准）：
- **R5-13 → fixed**：宿主 `diff -rq` 与 registry 零差异，`assertAppId` 已在 Mongo/ClickHouse 工厂、`saveSiteData` 与 ingest 生效；原「待 W2」已由 `5adec55` 完成。
- **R4-04 → partial（重开为 R6-09）**：`16930cf` 的 TTL/预算排序已装配且生效，但负缓存唯一键仍只有 `(knowledgeItemId, scopeKey)`，实体集/模型版本维度未加入；`host 未装配` 描述作废（现为零差异）。
- **R4-09 → verified**：`fetchedAt desc` 排序与预算逻辑在宿主副本存在；“host 未装配”作废。
- **R5-P2-03 → partial**：owner ACTIVE 校验已进入 `AccountApiKeyVerifier.verify`（`59ff47c`）；仍缺 `ipRestrictions`/`referrerRestrictions` 执行。
- **R5-P2-04/05/06/07 → 维持 open**（本轮未装配、未改动）。

本轮新增 registry 侧条目（编号延续 devbie 台账）：

| ID | 仓 | 标题 | 严重度 | 暴露面 | 可达性 | 状态 |
|---|---|---|---|---|---|---|
| R6-09 | newbie-modules | verdict cache 缺实体集/模型版本维度，`not-relevant` 仅靠 7 天 TTL 失效 | P2 | live | OPERATOR 变更实体后 INTEL 运行 | open |
| R6-10 | newbie-modules / nightwatch-backend | shortcut 更新 DTO 的 `ValidateIf` 可跳过 http(s) 白名单，危险 scheme 可落库 | P2 | artifact / live | 项目 EDITOR | open |
| R6-11 | newbie-modules | event-emitter 保留期配置用 `config.env` 形状，`apply` 未渲染到宿主 env；单条无上限清理 | P2 | artifact | 运维 | open（未运行时复现） |
| R6-12 | newbie-modules / nightwatch-backend | account 组织键分支 schema 不可达、测试用非法数据；`CACHE_APIKEY_LRU_SIZE` 死配置残留 | P2 | artifact / ops | 文档与测试 | open |
| R6-13 | newbie-modules / nightwatch-backend | web-monitor 历史 appId 被新白名单击穿（存量读 400、ingest 整批丢弃） | P2 | live | 已认证 WebMonitor 用户 | open（未上线，限于开发数据） |
| R6-14 | newbie-modules | registry CI `modules lint` 仍钉 1.14.5，落后已发布 1.15.0 | P2 | source / CI | 所有 registry PR | open |

复核取证：registry 与宿主 34 个模块 `diff -rq` 零差异；registry 模块单测无法在 registry 仓独立运行（`tsx` 未声明为 devDependency，`ERR_MODULE_NOT_FOUND`），相关用例改由宿主副本执行并通过。
