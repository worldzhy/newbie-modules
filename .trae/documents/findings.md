# Findings 台账（newbie-modules）

评审报告：`.trae/documents/expert-review-2026-10-31-round4.md`（scope=`modules: [security-evaluation]`）。

字段：ID / 仓 / 标题 / severity / 暴露面 / 可达性 / 状态 / 回归指针。

| ID    | 仓                                  | 标题                                                                                                 | 严重度 | 暴露面                              | 可达性                                      | 状态                                                                                                                                                                                                                                                             |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ | ----------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R4-01 | newbie-modules                      | `newbie.module.json` 未声明 `llm`，与物理 import 矛盾；`newbie modules lint` 报错                    | P1     | artifact（已发布模块）              | 新宿主装配 security-evaluation 时           | fixed：manifest 补 `llm`；registry CI 新增 `modules lint`（同批补 aws-cloudformation/tencent-cos 的 `security` 声明）                                                                                                                                            |
| R4-02 | newbie-modules + nightwatch-backend | security-evaluation 读面 `scopeType/scopeId/subjectId` 完全由客户端决定，OPERATOR 可跨项目读         | P1     | live                                | OPERATOR（持有 Security Evaluation 权限组） | fixed：重判为架构改造（2026-11-02 用户决定 SE 为平台级模块，见 nightwatch-backend ADR-039）；registry 落地平台坐标 + ingest 契约 + `SecurityEvaluationAssetSource` 溯源，读接口 scope 降为筛选（registry `33c56e4`），消费仓装配、存量迁移与前端顶层入口同批落地 |
| R4-03 | newbie-modules                      | `mergeJudgments` 的 skipped 去重 items 与累加 total 不一致，多机制同跳一条时违反骨架 coverage 不变量 | P2     | source（当前每 key 单机制，不可达） | 启用多机制组合后                            | fixed：`total` 改取去重条目数，补重叠 skipped 用例；ADR-046 合并契约同步                                                                                                                                                                                         |
| R4-04 | newbie-modules                      | 负缓存键仅 `(knowledgeItemId, scopeKey)`，无实体集/模型版本维度，且采集层在硬召回之前过滤            | P2     | live                                | OPERATOR 变更项目实体后触发 INTEL 运行      | **partial（重开为 R6-09，2026-11-04）**：`16930cf` 的 TTL 与预算排序已装配生效；负缓存唯一键仍缺实体集/模型版本维度。「host 未装配」描述作废（宿主已零差异）                                                                                                     |
| R4-05 | newbie-modules                      | LLM 返回输入外实体（含大小写差异）被判 `not-relevant` 并永久负缓存，应视为 `unavailable` 重试        | P2     | live                                | 需 LLM 输出异常/注入链条                    | fixed：非法实体输出改判 `unavailable`（不缓存）；实体标签比较大小写不敏感；补用例                                                                                                                                                                                |
| R4-06 | newbie-modules                      | INTEL 在 scope provider 未绑定或 scope 缺失时静默返回空证据，运行 SUCCEEDED 且 coverage 全零         | P2     | source（宿主已绑定）                | 新宿主未绑定 / subject 的 scope 已消失      | fixed：端口未绑定抛错，scope 未知抛 `BadRequestException`；补用例                                                                                                                                                                                                |
| R4-07 | newbie-modules                      | 知识条目的 `summary` 被查询后丢弃，INTEL 硬召回与 LLM 只看到 title                                   | P2     | live                                | 任意 INTEL 运行                             | fixed：`summary` 进入 evidence payload，判定侧候选恢复该字段；补用例                                                                                                                                                                                             |
| R4-08 | newbie-modules                      | ADR-045 声称的静态契约测试在 registry CI 不执行（CI 仅 format/lint）                                 | P2     | source                              | 任何 registry PR                            | fixed（部分）：registry CI 接入 `modules lint`；模块测试仍受限于 registry 无 Nest 依赖，由消费仓 CI 承担                                                                                                                                                         |
| R4-09 | newbie-modules                      | INTEL 证据预算按 `fetchedAt` 升序截断，硬命中永不负缓存，候选 >200 时固定头部长期占用预算            | P2     | live                                | 7 日窗口内未缓存候选 > 200                  | **verified（2026-11-04）**：`fetchedAt desc` 排序与预算逻辑在宿主副本存在；「host 未装配」描述作废（已零差异）                                                                                                                                                   |

已撤销/误报：见报告 §7。

## round5（2026-11-03，scope=`workspace`，报告在 `devbie/.trae/documents/expert-review-2026-11-03-round5.md`）

只登记 registry 模块级条目；跨仓与宿主条目见 `devbie/.trae/documents/findings.md`。

| ID       | 仓                                  | 标题                                                                                                                                                | 严重度 | 暴露面             | 可达性                         | 状态                                                                                                                                              |
| -------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| R5-P2-01 | newbie-modules                      | notification `markRead` 不校验可见性（任意 notification id 可写回执 + 存在性 oracle）                                                               | P2     | artifact           | 任意登录用户                   | fixed（`51821c4`，`findFirst` + 项目可见性条件）                                                                                                  |
| R5-P2-02 | newbie-modules                      | notification `notify` 平台级写入口不校验 `projectId` 归属；读写 DTO 契约不对称（`projectId` 读侧 `@IsUUID`、写侧仅 `@IsString`，`link` 无协议约束） | P2     | artifact           | OPERATOR/ADMIN                 | fixed（`51821c4`，`assertProjectVisible` + `isSafeNotificationLink`；控制器注入 `actorUserId`）                                                   |
| R5-P2-03 | newbie-modules                      | `api-key.verifier` 从不执行 `ipRestrictions`/`referrerRestrictions`，也不校验 owner 状态（宿主暂未启用该通道）                                      | P2     | artifact           | API key 持有者（启用后）       | **partial（2026-11-04）**：owner ACTIVE 校验已进入 `AccountApiKeyVerifier.verify`（`59ff47c`）；仍缺 `ipRestrictions`/`referrerRestrictions` 执行 |
| R5-P2-04 | newbie-modules                      | webhook 模块无权限/团队归属校验，`isSafeUrl` 不解析 DNS、不复检重定向，出站无 timeout（未装配）                                                     | P2     | source             | 任意登录用户（装配后）         | open                                                                                                                                              |
| R5-P2-05 | newbie-modules                      | web-monitor `systemName` 直接编译为正则（项目范围已收敛，仅 ReDoS）                                                                                 | P2     | artifact           | MEMBER/OPERATOR                | fixed（`51821c4`，`func.escapeRegExp`；同一提交覆盖 custom/page/resource/site 四处）                                                              |
| R5-P2-06 | newbie-modules                      | security-evaluation 报告 `latestResultsBySubject` 无界查询（全量载入再按 key 去重）                                                                 | P2     | artifact           | OPERATOR/ADMIN                 | fixed（`51821c4`，`count × 2 + aggregate(_max lastSeenAt)`；结果集加 `distinct`）                                                                 |
| R5-P2-07 | newbie-modules                      | notification push-failures 无分页，随累积行数无界返回                                                                                               | P2     | artifact           | OPERATOR/ADMIN                 | fixed（`51821c4`，`take: 200` 上限）                                                                                                              |
| R5-13    | newbie-modules ↔ nightwatch-backend | ClickHouse 标识符注入：registry 已加 `quoteIdentifier/quoteTable`，宿主副本仍裸插值；web-monitor `appId` 无校验（详见 devbie 台账同名条目）         | P1     | live（宿主旧副本） | MEMBER/OPERATOR 且项目 EDITOR+ | **fixed（2026-11-04）**：`5adec55` 的 `assertAppId` 已在 Mongo/ClickHouse 工厂、`saveSiteData` 与 ingest 生效；宿主 `diff -rq` 与 registry 零差异 |

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

| ID    | 仓                                  | 标题                                                                                   | 严重度 | 暴露面          | 可达性                         | 状态                                                                                                                                                                                                     |
| ----- | ----------------------------------- | -------------------------------------------------------------------------------------- | ------ | --------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R6-09 | newbie-modules                      | verdict cache 缺实体集/模型版本维度，`not-relevant` 仅靠 7 天 TTL 失效                 | P2     | live            | OPERATOR 变更实体后 INTEL 运行 | open                                                                                                                                                                                                     |
| R6-10 | newbie-modules / nightwatch-backend | shortcut 更新 DTO 的 `ValidateIf` 可跳过 http(s) 白名单，危险 scheme 可落库            | P2     | artifact / live | 项目 EDITOR                    | fixed（2026-11-04）：`26247a3`+`ca2ba33`；update 校验合并后的有效 type/content，非法 scheme 400、缺行 404，自带 8 例                                                                                     |
| R6-11 | newbie-modules                      | event-emitter 保留期配置用 `config.env` 形状，`apply` 未渲染到宿主 env；单条无上限清理 | P2     | artifact        | 运维                           | fixed（2026-11-04）：`0f191c0`；env 提升到 manifest 顶层，宿主 `.env`/`.env.example` 实测命中；无上限清理按既有注释的摊还设计保留                                                                        |
| R6-12 | newbie-modules / nightwatch-backend | account 组织键分支 schema 不可达、测试用非法数据；`CACHE_APIKEY_LRU_SIZE` 死配置残留   | P2     | artifact / ops  | 文档与测试                     | fixed（初段，2026-11-04）：`66fa30d`；注释/测试与 schema 对齐，`deploy/env.template` 死键删除；组织专属键去留待决策。复核更正（2026-11-04）：宿主 `.env` 两行死键曾被误装配（main 快照）重新渲染，仍待删 |
| R6-13 | newbie-modules / nightwatch-backend | web-monitor 历史 appId 被新白名单击穿（存量读 400、ingest 整批丢弃）                   | P2     | live            | 已认证 WebMonitor 用户         | open（未上线，限于开发数据）；盘点（2026-11-04）：本地安装 1 行、Mongo 17 个分区键全部合规，0 行需 backfill                                                                                              |
| R6-14 | newbie-modules                      | registry CI `modules lint` 仍钉 1.14.5，落后已发布 1.15.0                              | P2     | source / CI     | 所有 registry PR               | fixed（2026-11-04）：`2d9ea7b` 钉到 `@devbie/newbie-cli@1.15.0`                                                                                                                                          |

复核取证：registry 与宿主 34 个模块 `diff -rq` 零差异；registry 模块单测无法在 registry 仓独立运行（`tsx` 未声明为 devDependency，`ERR_MODULE_NOT_FOUND`），相关用例改由宿主副本执行并通过。

## round7 裁决（2026-11-04，scope=`workspace`，报告在本仓 `.trae/documents/expert-review-2026-11-04-round7.md`）

状态更正（历史行保留，以本节为准）：

- **R6-09 → fixed**：方案由「两层签名」收敛为**内容寻址单签名**。`security-evaluation-intel-request.ts` 以 `sha256(modelId + SYSTEM_PROMPT 原文 + user payload JSON + responseFormat + temperature)` 生成签名，装配即哈希，prompt/context/采样参数变化自动失效，无需人工 bump 版本常量。registry `e3bdc11`+`3008b10`+`597ba64`；宿主持有副本 `5252e38`（`inputSignature` 列走 `db push`，无 migration）。`SecurityEvaluationThreatVerdictCache.inputSignature` 为 `String? @db.VarChar(64)`，读写两侧签名不等（含 legacy null）即 miss 重判；hard-hit 行仍仅审计不过滤。
- **R6-12 → fixed（2026-11-04）**：按用户输入「organization 以后不会使用」彻底删除 organizationId 全链。registry `34cd698`：`ApiKey.organizationId` 列、`ApiKeyOwner` 联合类型、5 个 `*ForOrganization` 方法、`createApiKey` 的 organization 参数与过期 `Omit`、响应 DTO 字段、verifier 的恒真 `if (apiKey.userId)` 一并删除，`listApiKeys` 直接按 `user.id` 过滤。宿主 `8e729cd`（`db push` 删列，`ApiKey` 0 行无数据风险），前端 apits 重生成 `c96e9a7`（仅少 `organizationId` 一行，无消费方）。取证：`ApiKey` 表 0 行；organization 模块在 registry 存在但**未装配**（backend 模块键无 organization）；列无 relation、organization schema 无反向引用，即从未存在契约。archived：`organization` 模块定义本身仍在 registry，未装配，另行处理。
- **R6-13 → 裁定（待执行）**：fail-closed 保留，但异常语义分层——请求边界（`site.controller.ts` query 与 upsert body）非法 `appId` 返回 400 并指明字段；存储侧读取/聚合出现非法 `appId` 属内部不变量破坏，记内部错误 + 告警，不向调用方伪装成 400。理由：appId 来源混合（服务端 `func.randomString(7)`、客户端 query、库内 ingest），不能统一改 5xx。

回归证据（宿主副本）：`security-evaluation-intel.test.ts` + `security-evaluation-evidence.provider.test.ts` 共 15 例全过，含「签名按模型看到的确切字节内容寻址」「缓存只复用当前签名下的行（changed/legacy/missing 均 miss）」「hard-hit 仅审计」。

## round9 元评审（2026-11-04，scope=`modules: [web-monitor]`，报告在本仓 `.trae/documents/expert-review-2026-11-04-round9.md`）

round9 是对 round8 结论的元评审；R9-02..R9-08 为方案/报告缺陷，正文保留在 round9 报告（快照规则），此处只登记代码级 finding：

| ID    | 仓             | 标题                                                                                                                               | 严重度 | 暴露面 | 可达性                                 | 状态                                                                                                                                                                                           |
| ----- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R9-01 | newbie-modules | drain 毒丸：payload `time` 不可解析 → `func.toDate` 铸成 `Invalid Date` → store 写确定性失败 → raw 永久 `lpush` 重入队（绕过限流） | P1     | live   | anonymous（持公开 installation token） | **fixed（2026-11-05，待提交）**：4 处客户端时间写入点改 `toDateOrNow`（非法值回落采集时刻）；回归指针 `report-task.service.test.ts` 4 例；round10 复核通过（未修复代码 3/4 红、修复后 4/4 绿） |
| R9-04 | newbie-modules | drain per-item catch 吞错丢弃无记账（R8-04 只覆盖 flush 层）                                                                       | P2     | live   | 同 R9-01 触发面                        | fixed（`51821c4`：drain 逐项失败记账，tick 汇总 warn `dropped N … out of M`）                                                                                                                   |
| R9-07 | newbie-modules | 重入队无重试计数/退避/死信；分类法无法覆盖全部永久失败（R9-01 即反例）                                                             | P2     | live   | 同 R9-01 触发面                        | fixed（`51821c4`：`MAX_REPORT_ATTEMPTS=3` + `nextAttemptPayload`，超限入 `WEB_REPORT_DEAD_LETTERS` 并 `ltrim` 保留 1000 条）                                                                    |

- **R6-13 修订注记**（2026-11-04）：round8 裁决方向成立；round9 修订——毒丸等级上调 P1（R9-01，仅对 appId 向量的 P2 结论撤回）；切片顺序改为 C 层先行、A 批次与 B 同批或用模块级异常过滤器；计数与清单按 R9-03 修正（site 8 端点、custom 4、controllers 11、`assertAppId` 7 调用点、补 analysis 与 49 处 `throw new Error`）。
- R9-02（切片顺序矛盾）/R9-03（计数不实）/R9-05（R8-02 确认）/R9-06（R8-07 未定级）/R9-08（R8-03 措辞收窄）：方案与报告层结论，见 round9 报告 §5/§10，不占用代码 finding 状态位。

## round10 复核（2026-11-05，scope=`modules: [web-monitor]` 的 R9-01 变更集，报告在本仓 `.trae/documents/expert-review-2026-11-05-round10.md`）

| ID     | 仓             | 标题                                                                                                                         | 严重度 | 暴露面 | 可达性                  | 状态                                                                                                                           |
| ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R10-01 | newbie-modules | R9-01 测试覆盖缺口：4 处修复点仅 L375/L426 有真实覆盖，test3 名实不符（走 saveAjaxs 而非 collectResource）；L196/L470 无哨兵 | P2     | source | 后续回归                | fixed（2026-11-05：test3 更名标注 saveAjaxs 分支；新增 collectResource（img+duration 5000）与 collectErrors 两例哨兵，6/6 过） |
| R10-02 | newbie-modules | `toDateOrNow` 对数字字符串 epoch（如 `"1700000000000"`）回落 now 而非按 epoch 解析；非回归（旧行为为毒丸），精度改进建议     | P2     | source | SDK 字符串上送 epoch 时 | fixed（`51821c4`：纯数字串按 epoch 解析，新增单测）                                                                             |

- 误报剔除：「合法但越界 Date 构成同类毒丸」被 CH 探针否决——`DateTime` 列对 1966/3000 年插入静默截断为 `[1970-01-01, 2106-02-07]`，写不失败，不构成重入队（round10 §7）。
- R9-01 状态更新见上表；backend 装配与提交待用户确认后按 registry-first 流程执行。

## round12（2026-11-05，scope=`plan`：round9 §10 C 层切片草案，报告在本仓 `.trae/documents/expert-review-2026-11-05-round12.md`）

C 层草案判定：现状主张 C1–C4 与支撑论证 P4 成立；方案主张 P1/P2/P3 与隐含充分性 P5 均「证据不足/待细化」（dropped 粒度与行级识别、分类表须覆盖 drain+flush 两段、重试计数载体、与限流绕过关系四问未定）。新发现：

| ID     | 仓             | 标题                                                                                                                                                                                      | 严重度 | 暴露面 | 可达性                                 | 状态                                                              |
| ------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------------------------------- | ----------------------------------------------------------------- |
| R12-01 | newbie-modules | Mongo 数字/字符串路径毒丸向量簇：`screenWidth`/`performance.*` 原样入 Number 路径、`customContent` 对象入 String 路径、`bodySize` NaN → CastError → 整批失败重入队（R9-01 修复后仍 live） | P1     | live   | anonymous（持公开 installation token） | fixed（`a760491` + `51821c4`：数值走 `func.toNumberOrUndefined`、字符串走 `toStringOrUndefined`，p/resourceList/customs 全覆盖） |
| R12-02 | newbie-modules | CH `bodySize` NaN → null → 静默落 0，数据质量非可用性                                                                                                                                     | P2     | live   | 同上                                   | fixed（`51821c4`：CH `bodySize` 改 `Nullable(Int32)`，类型层补 `Nullable()` 助手）                                                 |

- 误报剔除：「CH bodySize NaN 构成写失败毒丸」被探针否决（null → Int32 落 0）；「round11 编号可用」否决（他会话已占用）。
- R9-04/R9-07 现为 fixed（2026-11-06，`51821c4`）：实际落地的是「逐项记账 + 重入队上限 + 死信」，round12 §9 四问中「重试计数载体」按 Redis payload 字段 `__reportAttempts` 作答；分类法仍按 R9-07 原结论不引入（归一化 + 上限已覆盖已知向量）。

## round15（2026-11-06，scope=`workspace`，报告在 `devbie/.trae/documents/expert-review-2026-11-06-round15.md`）

锚点：newbie-modules `a3ab33c`。registry 4 个新提交全为 ADR-034 manifest 迁移，模块源码未动，故 round12 及之前条目结论维持。

| ID     | 仓                                  | 标题                                                                                                                                                                                                                               | 严重度 | 暴露面          | 可达性                          | 状态                                                          |
| ------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------- | ------------------------------- | ------------------------------------------------------------- |
| R15-01 | newbie-modules ↔ nightwatch-backend | web-monitor ingest Mongo 毒丸第二向量簇：`customs[].customName={}`、`resourceList[].method/type/name/nextHopProtocol={}`、`p={}` 经 `decryptPhone` 透传 → CastError → 整批失败永久重入队；CH 向量经探针反驳（对象 stringify 落库） | P1     | live            | anonymous（installation token） | fixed（`51821c4` + 宿主 `5ec2821`；真实 Mongo 红/绿对照，归一化后落 string；重入队上限 3 + 死信） |
| R15-02 | newbie-modules                      | web-monitor `modules/web/services/custom.service.ts:60,73` 客户端 `customName`/`customFilter` key/value 直拼 `$regex` 未转义，Mongo 服务端 ReDoS                                                                                   | P2     | artifact        | 已认证 + WebMonitorSite Get     | fixed（`51821c4`：`func.escapeRegExp`，custom/page/resource/site 四处）                       |
| R15-05 | newbie-modules                      | aws-cloudformation `stack/stack.controller.ts:63`、`environment/environment.controller.ts:36` 以 `Prisma.*UncheckedCreateInput` 作 `@Body`（role-gated）                                                                           | P2     | artifact        | 具 Create 权限                  | fixed（`51821c4`：三个显式 DTO，删手写必填检查）                                              |
| R13-03 | newbie-modules                      | 模块代码直读 `process.env` 且 manifest 未声明：tencent-cos `STORE_PATH`（未装配，同时违反准入标准）、account `ENVIRONMENT`（live）；`modules apply` 永不渲染进 `.env.example`                                                      | P2     | artifact / live | 部署时缺键                      | fixed（`51821c4`：account 走 config-service + 声明 env/config，宿主 `.env.example` 已含 `ENVIRONMENT`；tencent-cos 仅补声明） |

carry-over 更新（2026-11-06）：R12-01 / R12-02 / R9-04 / R9-07 / R10-02 转 fixed（见各轮表）；R5-P2-01/02/05/06/07 转 fixed；仍 open：R5-P2-03 partial、R5-P2-04（webhook 未装配）、R6-13（裁定未执行）、R3-25。

误报剔除：R12-01 CH 侧毒丸向量（探针反驳）；registry CI pin 滞后（已升 1.18.0）。详见 devbie round15 报告 §7。
