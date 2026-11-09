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
| R5-P2-03 | newbie-modules                      | `api-key.verifier` 从不执行 `ipRestrictions`/`referrerRestrictions`，也不校验 owner 状态（宿主暂未启用该通道）                                      | P2     | artifact           | API key 持有者（启用后）       | **fixed（2026-11-09，`c88ea94`）**：`api-key-restrictions.ts` 强制 IP/referrer 校验并接进 `api-key.verifier`/`api-key.strategy`，58 行测试；owner ACTIVE 校验沿用 `59ff47c` |
| R5-P2-04 | newbie-modules                      | webhook 模块无权限/团队归属校验，`isSafeUrl` 不解析 DNS、不复检重定向，出站无 timeout（未装配）                                                     | P2     | source             | 任意登录用户（装配后）         | removed（2026-11-09，`3ef7089`）：模块已从 registry 删除。依据：宿主 `newbie-modules.json` 无该 key、`src/modules/webhook` 与 Prisma 模型均不存在、registry 内零调用方（`triggerWebhook` 无调用方、无模块依赖它），且其遗留安全债（无 guard、`teamId` 取自路径、无投递日志）在保留模块期间无法收口 |
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
| R6-09 | newbie-modules                      | verdict cache 缺实体集/模型版本维度，`not-relevant` 仅靠 7 天 TTL 失效                 | P2     | live            | OPERATOR 变更实体后 INTEL 运行 | fixed（2026-11-04 W10）：内容寻址单签名；`e3bdc11` + `3008b10` + `597ba64`，宿主 `5252e38` |                                                                                                                                                                                                   |
| R6-10 | newbie-modules / nightwatch-backend | shortcut 更新 DTO 的 `ValidateIf` 可跳过 http(s) 白名单，危险 scheme 可落库            | P2     | artifact / live | 项目 EDITOR                    | fixed（2026-11-04）：`26247a3`+`ca2ba33`；update 校验合并后的有效 type/content，非法 scheme 400、缺行 404，自带 8 例                                                                                     |
| R6-11 | newbie-modules                      | event-emitter 保留期配置用 `config.env` 形状，`apply` 未渲染到宿主 env；单条无上限清理 | P2     | artifact        | 运维                           | fixed（2026-11-04）：`0f191c0`；env 提升到 manifest 顶层，宿主 `.env`/`.env.example` 实测命中；无上限清理按既有注释的摊还设计保留                                                                        |
| R6-12 | newbie-modules / nightwatch-backend | account 组织键分支 schema 不可达、测试用非法数据；`CACHE_APIKEY_LRU_SIZE` 死配置残留   | P2     | artifact / ops  | 文档与测试                     | fixed（初段，2026-11-04）：`66fa30d`；注释/测试与 schema 对齐，`deploy/env.template` 死键删除；组织专属键去留待决策。复核更正（2026-11-04）：宿主 `.env` 两行死键曾被误装配（main 快照）重新渲染，仍待删 |
| R6-13 | newbie-modules / nightwatch-backend | web-monitor 历史 appId 被新白名单击穿（存量读 400、ingest 整批丢弃）                   | P2     | live            | 已认证 WebMonitor 用户         | fixed（2026-11-06）：管理端 appId 请求边界整体移除；registry `77e2922` + `d38d56c` + `da995d4`，backend `d34d537` + `663cc38` + `fba94cf`，frontend `de3f60e` + `8a000bb`（盘点：本地 1 行、Mongo 17 分区键合规，0 行需 backfill） |
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
| R13-03 | newbie-modules                      | 模块代码直读 `process.env` 且 manifest 未声明：tencent-cos `STORE_PATH`（未装配，同时违反准入标准）、account `ENVIRONMENT`（live）；`modules apply` 永不渲染进 `.env.example`                                                      | P2     | artifact / live | 部署时缺键                      | fixed（`51821c4` + 设计更正 `7974ac6`：`ENVIRONMENT` 保持框架级键、account 按宿主键读取，不再占 `account.*` 命名空间；tencent-cos 仅补声明） |

carry-over 更新（2026-11-09）：R12-01 / R12-02 / R9-04 / R9-07 / R10-02 转 fixed（见各轮表）；R5-P2-01/02/03/05/06/07 转 fixed；R6-13 转 fixed；仍 open：R5-P2-04（授权归属校验，DNS/超时已随 `cb6b068` 修）、R3-25。

误报剔除：R12-01 CH 侧毒丸向量（探针反驳）；registry CI pin 滞后（已升 1.18.0）。详见 devbie round15 报告 §7。

## round18（2026-11-06，scope=`plan`：ADR-050 错误来源分级，报告在本仓 `.trae/documents/expert-review-2026-11-06-round18.md`）

锚点：newbie-modules `971721e`（0 dirty）/ devbie `4df0a04c`（3 untracked，均不在 SDK 区）。结论摘要：ADR 的"复用 `api` 作来源真源、不改 schema"方向成立；两条 high 信号的来源边界未闭合。

| ID     | 仓             | 标题                                                                                                                                          | 严重度 | 暴露面         | 可达性    | 状态 |
| ------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------- | --------- | ---- |
| R18-01 | newbie-modules | `js-error-spike`（high，阈值 10）对错误表全窗口计数、无 `type`/`api` 过滤；5B 下降级入库的 console 事件仍可触发 high 告警，ADR 验收标准"console 不产生 high 告警"不可达（jobs.service.ts L253-L288、L77） | P1     | artifact + live | anonymous | fixed |
| R18-02 | devbie (SDK)   | `api=onerror` 同时用于资源加载失败（core.ts L473）与 JS 未捕获异常（L491/L497），决策 4 的 `api ∈ {onerror, unhandled-rejection}` 无法只保留运行时异常，资源噪音仍进 high 首现告警 | P1     | artifact       | anonymous | fixed |
| R18-03 | devbie (SDK)   | `ERRORAPIS` 为发布包导出符号（`dist/common/utils.d.ts` L15-L18），ADR 决策 2 未声明导出面/消费方校验（当前跨仓外部引用 0）                    | P2     | artifact       | 构建期    | fixed |
| R18-04 | newbie-modules | 枚举改值 + 不迁移：历史 `api='reject'` 行退出新基线，已见运行时错误会重新首现；ADR 未写"验证前清表"前置。本机 CH 实例当前无 web 错误表，无实际影响 | P2     | docs           | N/A       | fixed |
| R18-05 | newbie-modules | 背景取证措辞/路径：`name = Error` 实为 `error.name`；分组发生在告警任务而非 ClickHouse 模型；`models/clickhouse/web/error.ts` 缺 `packages/modules/web-monitor/` 前缀 | P2     | docs           | N/A       | fixed |
| R18-06 | newbie-modules | 决策 3 的可观察影响未记录：`type=script → log` 改变前端错误列表聚合口径（error.service.ts L72-L77），ADR 却称前端不涉及改动             | P2     | docs           | N/A       | fixed |

- 误报剔除：反驳代理将 console 分支概括为"一律 type=log"，与 core.ts L528→L49 不符，按读码裁决不采信；"基线占指纹使真崩溃永不告警"仅在 name/resourceUrl/line 重合时成立，并入 A7 结论、不单列。
- 评审时点状态：ADR-050 当时为「提议中」（决策 5 待拍板）；R18-01/R18-02 需先补决策 4 再实施。
- 2026-11-06 裁决：ADR-050 已定稿（状态改为已采纳）——5B；首现白名单 + 尖峰黑名单；新增 `resource-error` 取值。R18-01/R18-02 保持 **open**，待 SDK 与 registry 实现落地后按不变量重验关闭（不是按"ADR 已改"关闭）。
- 2026-11-06 关闭（实现 + 四向取证）：
  - R18-01 fixed：`packages/modules/web-monitor/modules/jobs/error-source.ts` 新增 `SPIKE_SOURCE_FILTER`（`api NOT IN ('console-error')`），`jobs.service.ts` 的 spike 计数与 topItems 两条查询均引用；registry `1218851`，宿主装配 `6422537`。
  - R18-02 fixed：SDK `ERROR_APIS` 取值规范化并新增 `resourceError`，资源加载失败分支改用 `resource-error`（`devbie 6837c2ee`，`@devbie/web-monitor-sdk@1.6.0` 已发布）；registry 首现分组与基线两条查询引用 `FIRST_SEEN_SOURCE_FILTER`（`api IN ('onerror','unhandled-rejection')`）。
  - 契约测试：`packages/modules/web-monitor/modules/jobs/error-source.test.ts`（4 断言，含接线计数）；未修复版本的阴性对照在 `jobs.service.ts` 旧接线副本下红于接线断言。
  - 端到端（清表后 4 向）：console → `log/console-error` 入库、13 行零告警；资源 → `resource/resource-error` 入库、零告警；运行时 → `script/onerror` 触发 1 条 `js-error-first-seen`（11:57:00）；ajax（`api=""`）→ 12 行触发 `js-error-spike`「12 JS errors in 60s」（计 12 而非 25，证明 console 未计入）。
  - R18-03 fixed：`ERRORAPIS` 改名后跨仓外部引用为 0，按 1.6.0 minor 发布并通过。
  - R18-04 fixed：ADR-050「验证（registry-first）」已写明"清表"前置。
  - R18-05/R18-06 fixed：ADR-050 已按评审订正措辞（`error.name`、分组在告警任务、`models/clickhouse/web/error.ts` 全路径），并在影响节记录 `type=script → log` 改变前端错误列表聚合口径（`error.service.ts` L72-L77）。

## round19（2026-11-06，scope=`plan`：ADR-051 告警冷却与恢复落地，报告在本仓 `.trae/documents/expert-review-2026-11-06-round19.md`）

锚点：newbie-modules `066cac8`（0 dirty）/ nightwatch-backend `6a48981`（1 untracked，不在被审域）/ nightwatch-frontend `025caed`（0 dirty）。结论摘要：状态机接线、schema、宿主/前端链路与装配一致性成立；P1 fail-open 注释失实、E2E 勾选无持久证据。

| ID     | 仓                        | 标题                                                                                                                                 | 严重度 | 暴露面         | 可达性    | 状态 |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------- | --------- | ---- |
| R19-01 | newbie-modules            | fail-open 注释失实：Redis 断连时 `shouldFire`/`resolveIfClean` 异常上抛、`redisLock` 无守卫，整个评估周期静默失败                    | P1     | artifact+live  | 需链条    | fixed：`ead62ef`（锁守卫 + 两方法 try/catch fail-open，`resolveIfClean` fail-closed；注释与实现对齐；宿主装配 `1f06d3a`） |
| R19-02 | newbie-modules            | ADR 伪代码"冷却期内刷新 lastFiredAt"使"已过冷却期→重燃"恒不可达，重燃分支为死代码                                                     | P2     | docs           | N/A       | fixed：`ead62ef`（ADR 修订记录明确持续突破只 firing/resolved 各一次，仅评估中断 ≥1h 且 key 未过期时重发） |
| R19-03 | nightwatch-frontend       | ADR 正文"firing/resolved 配对展示"未实现；/notifications 行内无徽章；bell 徽章硬编码英文                                              | P2     | artifact+live  | anonymous | fixed：`8e01d56`（列表行 + bell 统一本地化徽章）；ADR 口径同步修订为"resolved 徽章"（分组键含标题，配对合并会误并 first-seen 指纹） |
| R19-04 | newbie-modules + 宿主     | resolved 通知与 firing 同模板：标题渲染"0 slow page load(s) in 60s"、detail 尾部空 Top 列表                                            | P2     | live           | anonymous | fixed：registry `ead62ef`（声明支持 `resolvedTitleTemplate`/`resolvedDetailTemplate`）+ 宿主 `1f06d3a`（5 个电平信号补"…recovered"文案）；E2E 实测标题「slow JavaScript resources recovered」 |
| R19-05 | newbie-modules            | 契约测试浅于 checklist 声称；registry 无 test script，裸 `node --test` 因 ESM `__dirname` 失败                                         | P2     | source         | N/A       | fixed：`alert-lifecycle.test.ts` 补 fail-open/fail-closed 与锁守卫断言；registry 增 `test:web-monitor`（`node --import tsx --test`，10/10 通过）并声明 `tsx` devDependency |
| R19-06 | newbie-modules + 宿主     | E2E checklist 勾选但零持久证据（26 行全 firing、0 resolved、无 alert-state key）                                                        | P2     | docs           | N/A       | fixed：本会话重做生命周期 E2E，executed 证据见下方「round19 E2E 证据」 |
| R19-07 | newbie-modules            | ADR 迁移行文（`prisma migrate dev`）与项目实际（无 migrations、`db push`）矛盾                                                          | P2     | docs           | N/A       | fixed：`ead62ef`（ADR 正文更正为 `db push`） |
| R19-08 | newbie-modules            | js-error-first-seen 每指纹一个 Redis key，高基数应用下的 key 数量待审视                                                                | 观察   | live           | 需规模    | open（已入 backlog，并入"阈值配置化"ADR 审视） |
| R19-09 | nightwatch-backend        | E2E 新发现：所有 web 通知模板用 `{{appId}}`，宿主上下文只给 `appKey` → detail 恒渲染 `System: <name> ()`                              | P2     | live           | anonymous | fixed：`ae3aa34`（7 个模板占位符改为 `{{appKey}}`） |
| R19-10 | nightwatch-backend        | E2E 新发现：seed 以 `appId` 写 Mongo `systems` 文档，模型按 `appKey` 查询 → seed 出来的安装被 `/web-monitor/report` 以 "appKey does not exist" 拒绝 | P2     | live           | N/A       | fixed：`ae3aa34`（convergence 接口/查询/日志改 `appKey`） |

### round19 E2E 证据（2026-11-06 22:26-22:40 +0800，executed）

- **前置**：`module/notification-center.NotificationCenterSetting.minimumSeverity` 临时调为 `medium`（默认 `high` 会把 medium 电平信号整条丢弃，无法观察），结束后已恢复 `high`；`systems` 集合补 converge `fsQNmFK` 文档（见 R19-10）。
- **基线**：`NotificationRecord` 26 firing / 0 resolved；`web-monitor:alert-state:*` 无 key。
- **触发**：向 `/web-monitor/report`（token=自观测安装）投递 3 条 `type=script`、duration 3000-4500ms 的慢资源（采集落 `webresources_fsqnmfks`）。
- **firing**：14:32:00Z 生成 1 行 `web.slow-resource`，`status=firing`，标题「3 slow JavaScript resource(s) in 60s」，Redis key `{"status":"firing","cleanWindows":0}`。
- **resolved**：干净窗口 14:33、14:34 → 14:34:00Z 生成 1 行 `status=resolved`，`resolvedAt=14:34:00.082Z`，标题「slow JavaScript resources recovered」（无空 Top 列表）；alert-state key 已删除。
- **冷却抑制**：第二段持续突破 → 14:36:00 仅 1 行 firing；14:37 窗口再次突破（22:37:09 投递）→ 状态 `lastFiredAt` 刷新为 14:38:00、`cleanWindows` 归零，**未新增通知行**；停止后 14:40:00 生成 1 行 resolved。速率符合 ADR「持续告警只 firing/resolved 各一次」。
- **旁证**：宿主进程以 `node dist/src/main.js` 运行（非 watch），模板/seed 的 `appKey` 修复只做了 tsc/format/lint 静态验证，运行态渲染未复测——需重塑/重启后复核，标记为遗留验证项。
- **清理**：删除 12 行 e2e 探针资源文档；保留 4 行通知记录（14:32 firing、14:34 resolved、14:36 firing、14:40 resolved）作为证据锚点。

## round20（workspace scope）模块级条目指针

round20 为 `workspace` scope，报告与全量台账落 `devbie`（`.trae/documents/expert-review-2026-11-06-round20.md`、`devbie/.trae/documents/findings.md` R20-01..R20-41）。本仓相关条目（按不复制正文规则仅留指针）：

- `R20-01` / `R20-02`（P1，fixed 2026-11-07）：web-monitor `/system/update` 与 `/remove/customDeleteData` 鉴权按 body `projectId` 解析、写入/删除按 body `appKey` 执行，二者无绑定 → 跨租户改写/删除。修复：controller 取参与 guard 同源，appKey 由安装注册表派生（`5c47402` + 宿主 `b54062d`）；宿主另加 appKey scope resolver 纵深。E2E 探针：body 他人 appKey → 403，受害文档/时间窗数据未变。
- `R20-04`（P1，live）：ajax `duration` 无上限，`1e21` → ClickHouse `Code: 27`，整批失败后按 app 全量重排 → 死信（executed 探针，Memory 表已 DROP）。
- `R20-08` / `R20-09` / `R20-10` / `R20-11` / `R20-31`..`R20-33` / `R20-41`：模块层 P2/P3（message-tracker 不可装配、alert-lifecycle 文本断言、API Key 限制不校验、refreshTokenNext 明文、ioredis 超时、CH 时间语义、Approved Subnet 审计）。
- `R20-03`（P1）：本仓 `lark.service.ts` 12 处 raw error 入日志，与宿主金蝶同根因；executed 序列化探针证明 token 会被打印。


## round21（2026-11-07，scope=`plan`：alert-lifecycle resolved→recovered 改动集，报告在本仓 `.trae/documents/expert-review-2026-11-07-round21.md`）

锚点：newbie-modules `2513d4c`（0 dirty）/ nightwatch-backend `0a6d7a6`（0 dirty）/ nightwatch-frontend `fd25aca`（1 dirty=next-env.d.ts 生成噪音，不在被审域）。结论摘要：9 条主张全部成立（四层契约一致、E2E 证据独立复核为真）；方案外新发现 4 条均 P2。

| ID     | 仓                  | 标题                                                                                                                            | 严重度 | 暴露面 | 可达性       | 状态 |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ------ | ---- |
| R21-01 | nightwatch-frontend | 契约改名 commit 12228d7 的 api.ts 1582 行 diff 中仅 6 行契约相关，其余为 apits 生成器升级 churn，稀释可审性                      | P2     | source | N/A    | fixed |
| R21-02 | nightwatch-backend  | 2 条历史 NotificationRecord 的 deduplicationKey 残留 `:resolved:` 段（status 已迁移为 recovered；分钟桶保证唯一性，未上线数据）    | P2     | live   | 仅管理员 | withdrawn |
| R21-03 | newbie-modules      | notification-center.service.ts:184-186 低于 minimumSeverity 的通知静默丢弃（`dropped:true`，无日志无指标），排障盲区               | P2     | live   | 仅管理员 | fixed |
| R21-04 | nightwatch-backend  | url-check/heartbeat 恢复通知 notify 未传 `status`，落库默认 firing、recoveredAt=null，与 dedup key `:recovered:` 段不一致           | P2     | live   | 任意登录用户 | fixed |

处置（2026-11-07，用户拍板「修 R21-03+04」）：

- R21-01 fixed：约定固化进 worldzhy-knowledge `skills/apigen-refactor/SKILL.md` 收尾节（`30dfe62`）——apits 重生成产生的契约外 churn 必须单独一笔提交，不得与功能契约改动混合。
- R21-02 withdrawn：未上线环境数据；分钟桶保证 dedup key 唯一性不受 `:resolved:` 残留影响；数据随下次清库消失，不做迁移。
- R21-03 fixed：registry `d469238`（drop 分支补 debug 日志）+ 宿主装配 `f930bce`。报告中行号引用 `:181-184` 系凭记忆重构所致偏差，实际 drop 分支在 `:184-186`，此处已更正。
- R21-04 fixed：宿主 `9961dc8`（url-check/heartbeat 恢复通知补 `status:"recovered"` + `recoveredAt`）。验证边界：tsc+eslint 绿、build 绿、重启健康检查正常；两调用点复用既有 center 落库路径（其 recovered 相位已由 round21 E2E 证据覆盖），R21-03 的 debug 日志行无独立运行时探针。

## round26（2026-11-08，scope=`modules: [url-check]`：功能测试与验证，报告在本仓 `.trae/documents/expert-review-2026-11-08-round26.md`）

锚点：newbie-modules `93a4797`（3 新增测试文件）/ nightwatch-backend `bbb0b34`（4 新增测试文件）/ nightwatch-frontend `ae6b3e1`（5 dirty，均在 url-check 域外）。结论摘要：新增 38 用例全绿（url-check 相关 52/52，全仓 759/759），tsc/eslint/prettier 绿；SSRF 双层防线与状态机事务性均有 executed 证据；发现 1 个 P1（时间显示偏移）与 2 个 P2。

| ID | 仓 | 标题 | 严重度 | 暴露面 | 可达性 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| R26-01 | newbie-modules + nightwatch-frontend | `checkedAt` 以 ClickHouse UTC 原样串（无 `T`/`Z`）下发，前端 dayjs 按本地时区解析 → 检查时间早显 8 小时 | P1 | live | 任意登录项目查看者 | fixed |
| R26-02 | nightwatch-backend | 恢复通知在 `downSince=""` 时 `minuteBucket` 抛 RangeError 被 catch 吞掉，通知永久丢失（脏数据前置） | P2 | live | 需脏数据 | fixed |
| R26-03 | newbie-modules | IPv4-mapped 公网地址（如 `[::ffff:8.8.8.8]`）归一后按未知地址拦截，与注释"由内嵌 IPv4 判定"不符（fail-closed） | P2 | live | 任意登录用户 | fixed |
| R26-04 | newbie-modules | 观察：`Number.parseInt("12abc")` 容错为 12，进入 limit 计算 | P2 | live | 任意登录用户 | open（不单独立项） |
| R26-05 | newbie-modules | 域外新发现：`npm run format:check` 在 dev 已红（`message-tracker/sst/` 5 个 tracked 文件未格式化），CI `ci.yml:26` 即该命令，格式门禁失效 | P2 | source | N/A | fixed |

处置（2026-11-08，用户授权「执行吧」）：

- R26-01 fixed：registry `ca83ab1` / 宿主 `ed0b920`（`listCheckResults` 把 `YYYY-MM-DD HH:MM:SS.mmm` 归一为 ISO-8601 UTC，DTO `checkedAt` 改为 `string`）；前端 `682be56` 同步 apits 注释。运行时取证：真实 ClickHouse 行经接口返回 `2026-11-08T12:08:00.079Z`。
- R26-02 fixed：`ed0b920`（`minuteBucket` 对缺失/非法时间戳回落固定桶 `unknown`），新增断言 `downSince=""` 时 recovery 通知仍投递一次。
- R26-03 fixed：`ca83ab1` / `ed0b920`（`isBlockedAddress` 对 `::ffff:<hex>` 重建内嵌 IPv4 后再判私网），新增 `public-url.test.ts` 两组正反例。
- R26-05 fixed：`ca83ab1`（`.prettierignore` 增加 `**/.sst`），registry `npm run format:check` 转绿。
- 验证边界：backend `npm test` 762/762、`tsc --noEmit`、改动文件 eslint、`format:check` 全绿；模块 registry↔宿主 `diff -rq` 为空；后端 build + 重启后 `/` 200、Swagger `checkedAt` 描述已更新；宿主 `newbie-modules.json` 已 re-pin 到 `ca83ab1`（`0a78ae1`）。

## round29（2026-11-09，scope=`workspace`，报告在 devbie `.trae/documents/expert-review-2026-11-09-round29.md`）

| ID | 仓 | 标题 | 严重度 | 暴露面 | 可达性 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| R29-02 | newbie-modules | `RateLimiter.spend` 把配额拒绝（rate-limiter-flexible 以 `RateLimiterRes` reject，非 Error）误判为 Redis 故障进 `degradedTo`，误报 "backend unavailable" 且 30s 降级窗口内本地空桶重置配额（verification-code 以 spend 作配额判定，无需并发即触发） | P1 | live | 任意登录用户 | fixed（2026-11-09，registry `93035fb` / 宿主装配 `67eee17`）：catch 内判别配额形状（`'remainingPoints' in error`）按配额语义返回剩余点数、不进降级，fallback 桶同样处理；补 2 例回归测试（修复前红 2/绿 5、修复后绿 7），运行时探针 10×400 后 429 且日志零 "backend unavailable" |
| R29-04 | newbie-modules | web-monitor `ip-task.service.ts:133` `getErrorMessage` 收敛漏网：`err instanceof Error ? err.message : err`（fallback 非 `String()`） | P3 | live | — | fixed（2026-11-09，registry `ef00afb` / 宿主装配 `47a9e82`）：改走 `getErrorMessage(err)`（同文件已 import） |
| R29-05 | newbie-modules | 权限分层新规的严格读法：service 层基于已解析范围抛 403（web-monitor-access.service.ts:28、notification-center assertProjectVisible）属 fail-closed 合规，但与 site.controller getSites "静默忽略 projectId" 语义不统一，建议拒绝路径统一上移 controller | P3 | live | — | fixed（2026-11-09，`e44088c` + `2eab430`）：web-monitor 改为按可见 appKeys 授权，`getSysForUserId` 显式传无权 appKey 直接 403（不再静默忽略），`projectId` 过滤路径整体移除；service 层检查保留为纵深（用户裁定方案 A）。运行时冒烟：无权 appKey 403、不带 appKey 200；notification-center 交付接口传他人 projectId 403 |
| R29-06 | newbie-modules | notification-center README 只写 `NOTIFICATION_PUSH_PORT`，9634316 后 `NOTIFICATION_VISIBILITY_PORT` 变为必需（不绑定启动失败），文档缺口 | P3 | docs | — | fixed（2026-11-09，registry `ef00afb`）：Concepts 增 `NotificationVisibilityPort`（required，无 `@Optional`），Configuration 段说明两端口必需/可选差异 |
| R29-07 | newbie-modules | approved-subnet.service.ts:57/59、api-key.service.ts:100/101 存在性探测残留：不存在 404、他人资源 403，可区分行存在性（数字 ID 可枚举），与 20bf920 统一 403 目标矛盾 | P3 | live | — | fixed（2026-11-09，registry `ef00afb` / 宿主装配 `47a9e82`）：改 `findFirst({ id, userId })`，缺失与他人资源同为 403 同文案；运行时冒烟 api-keys/approved-subnets 不存在 id 均 403 |
| R29-08 | newbie-modules | llm `base-url-guard.ts:37` SSRF 谓词小缺口：裸 IPv4-compatible `::7f00:1` 不在 BLOCKED；NAT64 `64:ff9b::/96` 未列（现代栈不路由，可利用性低） | P3 | live | — | fixed（2026-11-09，registry `ef00afb` / 宿主装配 `47a9e82`）：BLOCKED 增 `::/96` 与 `64:ff9b::/96`；dist 实测 `::7f00:1`、`64:ff9b::7f00:1`、`::ffff:127.0.0.1` 全拒、公网域名放行 |
