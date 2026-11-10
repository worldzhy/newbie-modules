# Expert Review round21 — alert-lifecycle `resolved`→`recovered` 改动集

## 1. 锚点

| 仓                  | branch | HEAD      | dirty                               | 远端核对（ls-remote origin dev） |
| ------------------- | ------ | --------- | ----------------------------------- | -------------------------------- |
| newbie-modules      | dev    | `2513d4c` | 0                                   | 一致（`2513d4cd…`）              |
| nightwatch-backend  | dev    | `0a6d7a6` | 0                                   | 一致（`0a6d7a64…`）              |
| nightwatch-frontend | dev    | `fd25aca` | 1（`next-env.d.ts`，Next.js 生成噪音，不在被审域） | 一致（`fd25aca68…`） |

- 评审时间：2026-11-07 03:29:50 → 03:53:06 CST（+0800）。
- 被审改动集：`newbie-modules@da48678`（registry 重命名，8 文件）+ `newbie-modules@2513d4c`（ADR-051 修订行）+ `nightwatch-backend@0a6d7a6`（装配 + 宿主接线，16 文件）+ `nightwatch-frontend@12228d7`（徽章 + 生成契约，5 文件）。**明确排除** `nightwatch-frontend@fd25aca`（credentials 弹窗拆分，与本改动集无关）。
- git 来源：宿主 Shell 内 GitHub Desktop 自带 git；计数均由本评审会话内的命令产出。
- 并行会话：三仓无落在被审域的在途改动，结论非 provisional。
- 偏差披露：本评审会话与交付会话不同，但评审对象包含交付方自己声称的 E2E 证据；所有关键结论均按 §5 独立复核（不采信交付叙述，DB/Redis/日志重新取证）。

## 2. 范围与方法

- `scope: plan`（改动集即主张载体）。报告落本仓：主张主要触及 registry 真源（newbie-modules）。
- 主张清单与依赖映射：

| #   | 主张                                                                 | 依赖路径 / 取证命令 |
| --- | -------------------------------------------------------------------- | ------------------- |
| C1  | alert-lifecycle 域 `resolved` 零残留（例外域有意保留）               | `grep -rn -i 'resolved'` 于 registry 两模块、宿主 `src/modules` 同两目录、宿主 `src/application` |
| C2  | registry 与宿主装配一致；pin 到 da48678                              | `diff -rq` 两对目录；`nightwatch-backend/modules.json` L5/L63-66/L123-126 |
| C3  | NotificationRecord 契约：`recoveredAt` 存在、`resolvedAt` 不在此表   | `diff` 两侧 schema 文件；psql `\d "module/notification-center"."NotificationRecord"` |
| C4  | dedup key 唯一构造点、相位后缀对称、无新旧混用                        | `src/application/notifications/web-monitor/web-threshold-alerts.notifications.service.ts:99-101`；全局 grep `deduplicationKey` / `:resolved` |
| C5  | 5 个声明文件含 recovered 模板；phase→status/recoveredAt 映射          | 5 个 `src/application/notifications/web-monitor/web-*.notification.ts`；`notification-center.service.ts:91/:204-205` |
| C6  | 前端契约：i18n 4 定义 2 消费；NotificationRecordDto 无 resolvedAt     | `grep -c badgeAlertRecovered` en/zh.json；`grep -rn` 消费点；`git show 12228d7 -- src/api/_gen/api.ts` 抽样 |
| C7  | E2E 证据真实（DB 行 + Redis 消费 + 日志旁证）                         | psql 按 id 查行；`redis-cli KEYS 'web-monitor:alert-state:*'`；容器内 `/tmp/nightwatch-backend.log` |
| C8  | 构建与测试绿                                                          | `docker exec -w … devbie-work npm run build`（双端）；`node --import tsx --test`；`vitest run` |
| C9  | ADR-051 Status 区含 2026-11-07 修订行                                 | `git show 2513d4c` |

- 方法：3 路并行对抗性验证代理（后端静态 / DB·运行时·构建 / 前端）+ 1 路独立反驳代理（只移交结论与 file:line，未移交推理过程；同基础模型，属部分独立）。并行 4 路 ≤ 上限 5，无失败重跑。主会话对全部关键计数做了命令复算（§5 交付前自核验）。

## 3. 结论摘要

**9 条主张全部成立**（7 条 executed，C4/C5 为 static + 反驳轮复核确认）。改动集完成了 alert-lifecycle 域的 `resolved`→`recovered` 一词一概念统一，registry↔宿主↔DB↔前端四层契约一致，E2E 证据经独立复核为真。方案外新发现 4 条，全部 P2。

| 维度 | 评分 | 说明 |
| ---- | ---- | ---- |
| 安全 | 优 | 未触及认证/授权/租户面；无密钥、无 SQL 拼接变更 |
| 架构 | 优 | 与 url-check/heartbeat 的 recovered 词汇对齐；dedup 相位后缀有注释论证设计意图（web-threshold-alerts.notifications.service.ts:94-98） |
| 契约 | 优 | registry↔宿主 diff 为空；DTO/DB/前端生成契约三层同步 |
| 测试 | 良 | alert-lifecycle 测试钉住新语义（6/6），但属源码文本钉扎，覆盖边界仅限 jobs.service.ts |
| 门禁 | 良 | build/test/format 均绿；瑕疵：契约改名与 apits 生成器升级 churn 混入同一 commit（R21-01） |
| 治理 | 优 | ADR-051 修订行规范（沿袭 R19-02/R19-07 修订记录先例）；三仓提交信息完整说明 why |

## 4. 主张判定表

| #   | 判定 | 置信     | 依据 |
| --- | ---- | -------- | ---- |
| C1  | 成立 | executed | 三轮 grep（大小写双轮）逐条分类：alert-lifecycle 域 0 残留；现存命中全属 NotificationPushFailure 自愈域（notification-center.service.ts:473-498、dto :282-283、schema :106-111）、security-evaluation 域、英文"解析"词义（`ResolvedWebToken` 等）。反驳轮复核同结论 |
| C2  | 成立 | executed | `diff -rq` 两对目录空输出 EXIT=0（主会话亲跑）；modules.json 两模块 sourceCommit=`da48678…` |
| C3  | 成立 | executed | 两侧 schema 内容逐字一致（宿主多 3 行 newbie-cli 生成头，属渲染产物标准差异）；psql `\d` 确认 `recoveredAt timestamp(3)` 存在、`resolvedAt` 不在 NotificationRecord（仅在 NotificationPushFailure 表，有意保留） |
| C4  | 成立 | static   | dedup key 全宿主唯一构造点 web-threshold-alerts.notifications.service.ts:99-101，相位段 `recovered`/`firing` 同模板对称；全局 `:resolved` 字面量 0 命中；firing/recovered 各自成行为设计意图（:94-98 注释）。反驳轮穷举全宿主+registry `deduplicationKey` 构造点未找到第二处 `web:` 阈值告警 key |
| C5  | 成立 | static   | 5 声明文件双模板齐全（web-js-error-spike:22-24、web-slow-ajax:20-22、web-slow-first-paint:21-23、web-slow-page:21-22、web-slow-resource:22-24）；status 映射 :102；center 侧 status 仅两值（:91/:204）、recoveredAt 唯一写入点 :205。反驳轮 grep `recovered(Title\|Detail)Template` 恰 10 命中 |
| C6  | 成立 | executed | 主会话复算：en/zh 各 2 处定义（en.json:1065/:1125、zh.json:1065/:1125，分属 notificationCenter 与 notifications 命名空间），消费恰 2 处（page.tsx:96、notification-bell.tsx:59），`badgeAlertResolved` 0 命中。措辞纠偏：被替换的旧 key 实为 `statusResolved`（其残留在 securityEvaluation 命名空间，有意保留）。api.ts 中 NotificationRecordDto（:3046 起）status `"firing"\|"recovered"`、:3069 `recoveredAt`，无 resolvedAt；现存 resolvedAt 命中归 NotificationPushFailureDto(:3187)/EvaluationFindingResponseDto(:3708)/MttrStatsDto(:5145,:5149) |
| C7  | 成立 | executed | 主会话复算：目标行恰 1 条且 status/deduplicationKey 逐字匹配；全表 status 分布 firing 28 / recovered 3，无 `resolved` 值；recovered 行 recoveredAt 3/3 非空；Redis `alert-state:*` 空。附注：notification-center 无 dispatch 级日志，"日志直接证明发出"不可用，证据链为 DB 行 + Redis 消费 + 进程生命周期旁证（recoveredAt 早于 createdAt 4ms 与应用层先取 `new Date()` 的代码路径自洽，无人工伪造迹象） |
| C8  | 成立 | executed | 后端 `nest build` EXIT=0；alert-lifecycle 6/6 pass（断言 `phase: "recovered"` 出现 5 次，旧词回退即红）；前端 `vitest run src/i18n/messages.test.ts` 3/3 pass、`next build` EXIT=0；反驳轮另以 `tsc --noEmit` 双端复核 EXIT=0 |
| C9  | 成立 | executed | `git show 2513d4c`：ADR-051 Status 区新增「修订：2026-11-07 — phase value renamed…」行，正文不改，与 ADR 修订先例一致 |

### 方案外新发现

**R21-01（nightwatch-frontend，P2）** commit 12228d7 的 `src/api/_gen/api.ts` diff 1582 行中仅 6 行与本次契约改名相关，其余约 1576 行为 apits 生成器升级 churn（301 行 `data,`→`data: data,`；约 1277 行 path 参数 `encodeURIComponent` 包装，横跨 260 个 hunk）。证据命令：`git show 12228d7 --stat -- src/api/_gen/api.ts`、`git show 12228d7 -- src/api/_gen/api.ts | grep -E '^[+-]' | grep -viE 'resolved|recovered'`。不影响正确性，但稀释可审性；建议生成器升级与契约改名分提交。可达性 N/A（流程），暴露面 source，可利用性 理论。

**R21-02（nightwatch-backend，P2）** 两条历史 NotificationRecord 行的 `deduplicationKey` 残留旧词 `:resolved:`（`web:fsQNmFK:slow-resource:js:resolved:202611062233/…2239`），其 status 已在交付期翻转为 recovered。证据命令：psql `… WHERE "deduplicationKey" LIKE '%:resolved:%'` → count=2。key 含分钟桶，唯一性不受影响；nightwatch 未上线、数据可丢弃。可达性 仅管理员（DB 直查），暴露面 live（dev DB），可利用性 理论。

**R21-03（newbie-modules，P2）** 低于 `minimumSeverity` 的通知在 notification-center.service.ts:181-184 被静默丢弃（`return { id:"", deduplicated:false, dropped:true }`，无日志无指标）。本次 E2E 取证即被此阻塞（默认 `high` 吞掉 medium 电平信号，需临时降阈值），slow-page recovered 行无 firing 配对行亦由此解释。暴露面 live，可达性 仅管理员（配置项），影响 可用性（排障盲区），可利用性 需链条。

**R21-04（nightwatch-backend，P2）** url-check 与 heartbeat 的恢复通知调用 `notify()` 未传 `status`，落库默认 `firing`、`recoveredAt=null`，与各自 dedup key 的 `:recovered:` 段不一致；通知列表中这些恢复行无「已恢复」徽章。证据：url-check-alerts.notifications.service.ts:62-79（无 status 字段）、heartbeat.detect-offline.job.ts:195-204（同）；`grep -rn 'status:' src/application/notifications` 确认全宿主仅 web-threshold-alerts.notifications.service.ts:102 传相位。系改动集之外的既有不一致（url-check/heartbeat 先行用了 recovered 词汇但未接相位字段）。可达性 任意登录用户（通知列表可见），影响 正确性（展示语义），暴露面 live，可利用性 直接；比照 R19-03/R19-04 展示类定级 P2。

## 5. 误报剔除

- **「slow-page recovered 行无 firing 配对行」疑似状态机缺陷** —— 推翻。该 episode 的 firing 通知发出时 `NotificationCenterSetting.minimumSeverity=high`，medium 电平信号被 :181-184 丢弃；阈值临时降为 low 后恢复通知正常落库。状态机行为正确，根因记录为 R21-03。
- **「C6a：badgeAlertResolved 零残留」表述** —— 空洞为真：旧 key 名实为 `statusResolved`，`badgeAlertResolved` 从未存在。已在 C6 判定中按真实 key 名复核（通知命名空间 0 残留，securityEvaluation 残留属有意保留），结论不变，仅纠正主张措辞。

## 6. 已核验通过的不变量

1. **I1 词汇边界**：alert-lifecycle 域（两模块 + 宿主 application 接线）`grep -rn -i 'resolved'` 命中数 0；现存命中全部可归入三个有意保留/无关类别（命令见 C1，主会话 + 验证代理 + 反驳代理三轮独立执行）。
2. **I2 status 值域**：NotificationRecord.status ∈ {firing, recovered}——service :91、DTO :44-48、schema :64 三处静态一致，且 DB `GROUP BY status` 实测仅两值（firing 28 / recovered 3）。
3. **I3 recoveredAt 写入纪律**：唯一写入点 :205，且仅在 status='recovered' 时非空——DB 实测 recovered 3/3 非空、firing 28/28 为空，代码与数据互洽。
4. **I4 装配一致性**：registry↔宿主两模块 `diff -rq` 空；modules.json 双 pin = da48678。
5. **I5 前端徽章链路**：`badgeAlertRecovered` 定义恰 4 处（en/zh × 2 命名空间）、消费恰 2 处、旧 key 0 残留（主会话复算命令见 §4-C6）。
6. **I6 回退即红**：alert-lifecycle 测试断言 `phase: "recovered"` 恰 5 次，jobs.service.ts 回退旧词立即变红（6/6 pass，executed）。

## 7. 覆盖率清单

- **审了**：四个 commit 的全部非生成物文件；api.ts 抽样（改名 hunk + churn 分类抽样约 100 行）；registry↔宿主两模块全量 diff；notification-center.service.ts / jobs.service.ts / threshold-alert.event.ts / 5 声明文件 / web-threshold-alerts.notifications.service.ts 全文；DB（NotificationRecord 全表 status 分布、目标行、残留 key）、Redis、后端日志；双端构建与相关测试；ADR-051 diff。
- **没审**：api.ts 1582 行逐行（生成物，按抽样 + 归属回溯覆盖）；fd25aca（明确排除）；其余 30 个装配模块；CI workflow / dependabot / deploy 脚本（本改动集未触及）；url-check/heartbeat 模块本体（仅就其 notify 调用取证 R21-04）。

## 8. 修复优先级

全部 P2，无必修项。建议顺序：R21-04（用户可见语义不一致，改动最小——两处 notify 调用补 `status`）→ R21-03（加一行 drop 日志即可消除排障盲区）→ R21-01（流程约定，无需代码改动）→ R21-02（未上线数据，可随下次清库自然消除）。

## 9. 台账指针

R21-01..R21-04 已落本仓 `.trae/documents/findings.md` round21 节。按协议 §0.2，本评审会话不动 backlog；open 项的 backlog 登记留待修复会话。
