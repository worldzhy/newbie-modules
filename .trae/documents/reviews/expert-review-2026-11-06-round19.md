# Expert Review round19 — plan: ADR-051 web-monitor 告警冷却与恢复落地实现

## 1. 锚点

| 仓 | branch | HEAD | dirty | 说明 |
|---|---|---|---|---|
| newbie-modules | dev | 066cac8 | 0 | registry 代码 0fb6977 + ADR checklist 066cac8 |
| nightwatch-backend | dev | 6a48981 | 1 | `?? .trae/documents/expert-review-2026-11-06-R6-13-claim-verification.md`，不在被审域 |
| nightwatch-frontend | dev | 025caed | 0 | |

- 评审开始：2026-11-06 21:15:56 +0800；结束：2026-11-06 21:50 +0800。
- 被审交付：ADR-051 三仓落地（registry 0fb6977+066cac8；backend 6a48981；frontend 025caed）。
- **偏差披露（协议 §10 第 7 条）**：本轮评审者与被审实现的实现者为同一基础模型的先后会话（评审会话只读、未改代码，实现与评审非同一会话）。补偿：关键结论均升级为 executed 证据，并派独立子代理对 D1/C10/C9 做反驳轮（§5，部分独立——同基础模型）。
- 并行会话：nightwatch-backend 的 dirty 文件为另一评审报告草稿，不落在 ADR-051 被审域，本轮结论无需标 provisional。

## 2. 范围与方法

- `scope: plan: ADR-051 web-monitor alert cooldown & recovery 落地`（协议 §0.1 plan scope）。
- 主张清单与映射（逐条判定见 §4）：C1 信号接线 → `jobs.service.ts` L153-445/L491-539；C2 事件 phase → `threshold-alert.event.ts`；C3 schema+DB → registry `notification-center/prisma/schema.prisma` + psql；C4 key/TTL → `jobs.service.ts` L474-484/L107 + redis-cli；C5 常量 → L103-107；C6 宿主通知服务 → `web-threshold-alerts.notifications.service.ts` + registry `notification-center.service.ts`；C7 前端徽章 → `notification-bell.tsx` + 生成类型；C8 契约测试 → `alert-lifecycle.test.ts` + 重跑；C9 E2E → psql/redis 遗迹复核；C10 fail-open → `shouldFire`/`redis.service.ts`；C11 状态机归属；C12 向后兼容；C13 事件通道复用。
- 明确排除：web-monitor 其余功能（采集/报表/页面）、notification-center 其他通知类型、deploy 配置、ClickHouse schema。
- 方法：主会话精读被审文件全文；机械取证（`diff -rq`）；executed 证据（tsx 重跑测试、psql、redis-cli）；独立反驳轮（1 路后台子代理，只移交结论+file:line）；交付前自核验（全部 file:line Glob、计数复算、引用 grep）。无失败/重跑。

## 3. 结论摘要

**落地整体成立：状态机接线、schema、宿主/前端链路、装配一致性均核验通过；但 ADR 文本自相矛盾（重燃语义死代码）、fail-open 注释失实（P1）、E2E 勾选无持久证据、配对展示未实现。** 无 P0。

| 维度 | 评分 | 说明 |
|---|---|---|
| 安全 | 通过 | 无新攻击面；link 白名单、renderTemplate 纯文本替换等不变量未动 |
| 架构 | 良 | 状态机内聚于 registry，宿主只消费事件，跨宿主边界干净（C11 成立） |
| 契约 | 中 | ADR 伪代码自相矛盾（R19-01）；代码注释承诺 fail-open 而实现 fail-closed（R19-02）；ADR 迁移行文与现实矛盾（R19-07） |
| 测试 | 中 | wiring 计数测试有效但浅，不覆盖 checklist 声称的行为语义（R19-05）；registry 无 test script |
| 门禁 | 良 | 测试执行点在消费仓 `npm test`（tsx），与 registry ci.yml 注释一致 |
| 治理 | 差 | E2E checklist 勾选但 DB/Redis 无任何持久证据（R19-06）；checklist 第 4 条声称的测试覆盖超出实际（R19-05） |

## 4. 主张判定表

| # | 主张 | 判定 | 依据（置信级） |
|---|---|---|---|
| C1 | 6 信号全部接 `shouldFire`；5 个电平信号走 `resolveIfClean`；first-seen 只走 `shouldFire` | **成立** | executed：`grep -c 'await this.shouldFire(' jobs.service.ts`=6、`resolveIfClean`=5、`phase: "firing"`=6、`phase: "resolved"`=5、`runSignal`=6；static：[jobs.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts#L153-L445)（slow-resource 为一个 for 循环覆盖 js/css/img 三类目，计 1 个调用点 3 个信号身份） |
| C2 | `threshold-alert.event.ts` 加 `phase` 字段 | **成立** | static：[threshold-alert.event.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/jobs/threshold-alert.event.ts#L22-L33)（`WebThresholdAlertPhase` L22、`phase?` L33） |
| C3 | schema 加 `status`/`resolvedAt`+索引且 DB 已同步 | **成立** | static：[schema.prisma](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/prisma/schema.prisma#L64-L76)；executed：psql `information_schema.columns` 返回 `status varchar NOT NULL default 'firing'`、`resolvedAt timestamp nullable`，`pg_indexes` 含 `NotificationRecord_status_idx` |
| C4 | 状态 key 格式与 TTL=7200 符合 ADR | **成立** | static：[jobs.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts#L474-L484) key 拼接、L107 `ALERT_STATE_TTL_SECONDS = 2*60*60`；运行时旁证：redis-cli `--scan --pattern 'web-monitor:alert-state:*'` 为空（当前无 firing 告警，与预期一致；key 形态本身未运行时实测，标 static） |
| C5 | 常量值符合 ADR 表 | **成立** | static：[jobs.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts#L103-L107) `ALERT_COOLDOWN_MS=60*60*1000`、`ALERT_RESOLVED_WINDOWS=2` vs ADR 参数表 |
| C6 | 宿主处理 `phase=resolved`、写 `status`/`resolvedAt`、dedup 加阶段后缀 | **成立** | static：[web-threshold-alerts.notifications.service.ts](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/web-monitor/web-threshold-alerts.notifications.service.ts#L99-L102)（dedup `:firing:/:resolved:` 后缀+分钟桶、`status` 映射）；`resolvedAt` 由 registry [notification-center.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.service.ts#L198-L199) 在 `status="resolved"` 时自动写入 |
| C7 | 前端 resolved 行显示徽章 | **成立（仅限 bell 弹窗）** | static：[notification-bell.tsx](file:///Users/worldzhy/src/nightwatch-frontend/src/components/notification-center/notification-bell.tsx#L57-L59)；类型链路：DTO [notification-center.dto.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/notification-center/notification-center.dto.ts#L44-L48) → 生成 [_gen/api.ts](file:///Users/worldzhy/src/nightwatch-frontend/src/api/_gen/api.ts#L3046) 含 `status: "firing"\|"resolved"`。/notifications 页行内无徽章，见 R19-03 |
| C8 | 契约测试 4/4 通过且有效 | **部分成立** | executed：`npx tsx --test alert-lifecycle.test.ts` 4/4 pass；但裸 `node --test` 因 ESM `__dirname` 失败（runner 敏感）；"有效性"仅限 wiring 计数，不覆盖 ADR checklist（L107）声称的"冷却抑制、重燃、恢复判定"行为语义——重燃死代码下测试照样全绿。详见 R19-05 |
| C9 | E2E 四向已验证（持续错误 1 条 firing/冷却不重复/恢复 1 条 resolved） | **证据不足** | executed：psql `GROUP BY status` → 26 行全 firing、0 resolved；`LIKE 'web.%'` → 0 行；redis alert-state keys 空。DB 行无 TTL，0 行是强证据；E2E 持久证据不存在，无法复核（反驳轮确认取证无瑕疵）。详见 R19-06 |
| C10 | Redis 不可用 fail-open | **不成立（部分）** | static+反驳轮确认：`shouldFire` 只在 `!isConfigured()`（未配置）时 fail-open（[jobs.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts#L491-L492)）；已配置但断连时 ioredis 命令 reject，异常上抛 `runSignal` catch（L448-456）仅 warn，该信号零通知零状态写入（fail-closed）；且 `redisLock`（L110）无 `isConfigured` 守卫，Redis 断连使整个评估失败。注释 "Fails open (never suppress) when Redis is unavailable"（L486-490）失实。详见 R19-02 |
| C11 | 状态机完全在 registry 内、宿主只消费事件 | **成立** | static：状态机全部在 registry jobs.service.ts；宿主仅 `@OnEvent(WEB_THRESHOLD_ALERT_EVENT)` 单 handler（宿主服务 L63）；`diff -rq` 两模块 registry vs 宿主编码一致（executed，无差异输出） |
| C12 | NotificationRecord 字段向后兼容 | **成立** | static：`status` 默认值 + `resolvedAt` 可空；executed：库内 26 行旧记录（job.run-failed 等）全部 `status='firing'`，旧数据无需回填 |
| C13 | resolved 复用 `WEB_THRESHOLD_ALERT_EVENT` 通道 | **成立** | static：宿主单 `@OnEvent` handler 内按 `event.phase` 分支（L63/L99-102），无新事件类型 |

## 5. 方案外发现（P1）

### R19-01｜newbie-modules｜P1：fail-open 注释失实——Redis 断连时告警静默全灭

- **证据**：[jobs.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts#L486-L519) L489 注释承诺 "Fails open (never suppress) when Redis is unavailable"；实际仅 L492 `!this.redis.isConfigured()`（未配置）时 fail-open。[redis.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/redis/redis.service.ts#L57-L66)：`isConfigured()` 只判 `client !== undefined`，与连接状态无关。断连时 ioredis reject → `runSignal` catch（L448-456）仅 warn → 该信号零通知。另：`evaluateThresholdAlerts` 入口 `redisLock`（L110）直接调 `getClient().set(...)`，无守卫无 try/catch，Redis 断连使整个评估周期失败。
- **可达性**：非用户可达，需 Redis 基础设施故障（常见依赖故障场景）。**影响**：可用性——告警系统在被监控事故（Redis 故障）期间静默丢失全部 firing/resolved 通知，且只有 warn 级日志。**暴露面**：live（已装配）。**可利用性**：需链条。
- **独立复核**：反驳轮子代理确认 ioredis 断连行为与异常路径，结论成立。
- **修复方向**：`shouldFire`/`resolveIfClean` 内 try/catch Redis 异常→fail-open（退化到分钟桶 dedup 行为）；`evaluateThresholdAlerts` 入口对 `redisLock` 加守卫，Redis 故障时记 error 并明确降级语义；修正注释或修正行为，二者对齐。

## 6. 方案外发现（P2，按主题归并）

| ID | 主题 | 发现 | 证据 |
|---|---|---|---|
| R19-02 | ADR/实现矛盾 | **重燃分支为死代码，ADR 伪代码自相矛盾**：ADR L25 要求冷却期内"刷新 lastFiredAt"，使 L26"已过冷却期→重燃"对持续突破信号在分钟级评估下永不可达（`lastFiredAt` 全仓仅 3 处写入，均在 `shouldFire` 内）；实现忠实照抄，重燃仅在评估中断 ∈[1h,2h) 且 key 未过期时可达。实际行为（持续告警只 firing/resolved 各一次）与 ADR 影响节一致，但与伪代码第三条矛盾 | ADR-051 L25-26；[jobs.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts#L498-L509)；反驳轮确认无反例路径。修复：修订 ADR 删重燃语义，或改冷却语义（期内不刷新 lastFiredAt） |
| R19-03 | 前端配对 | **ADR 正文"firing/resolved 配对展示"未实现**：`groupNotifications` 按 `day\|notificationKey\|title\|source` 分组，resolved 标题含 `count=0` 与 firing 不同组；/notifications 页行内无 resolved 徽章（仅 bell 有，且硬编码英文 "resolved" 未走 next-intl）。checklist 第 6 条（仅要求徽章）已满足，但 ADR 正文口径未交付 | [notification-group.ts](file:///Users/worldzhy/src/nightwatch-frontend/src/components/notification-center/notification-group.ts#L46)；[page.tsx](file:///Users/worldzhy/src/nightwatch-frontend/src/app/(dashboard)/notifications/page.tsx#L92-L96)；[notification-bell.tsx](file:///Users/worldzhy/src/nightwatch-frontend/src/components/notification-center/notification-bell.tsx#L57-L59) |
| R19-04 | 通知文案 | **resolved 通知无 phase 文案区分**：宿主服务对 firing/resolved 用同一模板，resolved 时 `count=0`、`topItems=""`，标题渲染为 "X: 0 slow page load(s) in 60s"、detail 尾部空 "Top pages:\n"，语义误导（读作"0 次慢加载"而非"已恢复"） | [web-threshold-alerts.notifications.service.ts](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/web-monitor/web-threshold-alerts.notifications.service.ts#L70-L103)；[web-slow-page.notification.ts](file:///Users/worldzhy/src/nightwatch-backend/src/application/notifications/web-monitor/web-slow-page.notification.ts#L16-L18) |
| R19-05 | 测试治理 | **契约测试浅于 checklist 声称**（仅 wiring 计数，不覆盖冷却抑制/重燃/恢复判定语义；重燃死代码下仍全绿）；registry 仓无 `test` script，裸 `node --test` 因 ESM `__dirname` 失败，依赖消费仓 `npm test`（`node --import tsx --test`）兜底——与 registry ci.yml 注释一致但脆弱 | [alert-lifecycle.test.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/jobs/alert-lifecycle.test.ts#L23-L43)；executed：tsx 4/4 pass / 裸 node 失败；nightwatch-backend package.json test 脚本 |
| R19-06 | 交付治理 | **E2E checklist 勾选但零持久证据**：DB 26 行全 firing、0 resolved、web.* 0 行；Redis 无 alert-state key。无法排除"事后删行/走别的库"，但也无法复核——E2E 证据应随交付记录留存（截图/查询输出） | executed：psql + redis-cli 取证（命令见 C9）；反驳轮确认取证无瑕疵 |
| R19-07 | ADR 文档 | **ADR 迁移行文与现实矛盾**：ADR 正文写"迁移走 prisma migrate dev（无前向迁移脚本约定）"，项目实际无 migrations 目录、用 `db push`（checklist 第 3 条倒是写对了"db push 同步"） | ADR-051"NotificationRecord schema 变更"节 vs checklist 第 3 条 |
| R19-08 | 观察项 | **js-error-first-seen 每指纹一个 Redis key**：指纹基数随错误种类增长，TTL 2h 自然过期可控，但高基数应用下值得在后续"阈值配置化"ADR 中一并审视 | [jobs.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/web-monitor/modules/jobs/jobs.service.ts#L426-L427) |

## 7. 误报剔除

- 初判疑点 D4（fail-open 退化每分钟 1 条未被 ADR 讨论）不单列，被 R19-01 吸收（fail-open 路径实际不存在，退化行为无从发生）。
- 无正式 finding 被推翻；本轮 3 条核心结论（D1/C10/C9）经独立反驳轮反驳全部失败、维持成立。

## 8. 已核验通过的不变量（供下轮比对覆盖是否退化）

1. **装配一致**（executed）：`diff -rq` registry vs 宿主对 web-monitor、notification-center 两模块均无差异（exit 0，无输出）。
2. **DB schema 同步**（executed）：`status`/`resolvedAt` 列与 `NotificationRecord_status_idx` 在库（psql information_schema/pg_indexes）。
3. **旧数据兼容**（executed）：库内 26 行 ADR-051 前记录全部 `status='firing'`，无回填需求。
4. **wiring 计数**（executed）：`shouldFire`=6、`resolveIfClean`=5、`phase:"firing"`=6、`phase:"resolved"`=5、`runSignal`=6（grep -c，复算于本报告交付前）。
5. **first-seen 不发 resolved**（static）：first-seen 块（L397-445）只调 `shouldFire`，无 `resolveIfClean` 分支；wiring 测试断言该计数。
6. **宿主 dedup 含 phase 后缀**（static）：`...:firing|resolved:<分钟桶>`（宿主服务 L99-101），firing 与 resolved 行不碰撞。
7. **类型链路完整**（static）：registry DTO `status`/`resolvedAt` → 生成 `_gen/api.ts` `NotificationRecordDto.status: "firing"|"resolved"` → bell 徽章渲染。
8. **单实例评估**（static）：`evaluateThresholdAlerts` 持 `ALERT_EVALUATION_TASK_LOCK` Redis 锁（L110），`shouldFire` 的 GET/SET 非原子但同 key 不会被并发评估触碰。
9. **通知安全不变量未动**（static）：`isSafeNotificationLink` 白名单、`renderTemplate` 纯文本替换（无 HTML 注入面）保持原样。

## 9. 覆盖率清单

- **审了**：registry `jobs.service.ts` 全文、`threshold-alert.event.ts`、`alert-lifecycle.test.ts`；registry `notification-center.service.ts`/`schema.prisma`/`notification-center.dto.ts`；宿主 `web-threshold-alerts.notifications.service.ts`、`project-notification-push.service.ts`、`web-slow-page.notification.ts`（模板样本）；前端 `notification-bell.tsx`、`notifications/page.tsx`、`notification-group.ts`、生成类型；ADR-051 全文；DB schema+数据（psql）；Redis keys；装配 diff；registry/消费仓 CI 与测试脚本。
- **没审**：其余 5 个 web 通知模板文件（取样 1 个）；`notification-detail-panel/sheet` 组件；web-monitor 采集/报表/页面等其余功能；deploy 配置；ClickHouse 侧；notification-center 控制器权限面（本轮未触及认证/授权 finding）。

## 10. 修复优先级

1. **R19-01（P1）**：fail-open 语义对齐（catch Redis 异常 fail-open + redisLock 守卫 + 注释对齐）。
2. R19-06：E2E 证据留存规范（交付记录附查询输出/截图）；如需补做 E2E 复核另起会话。
3. R19-02：修订 ADR-051 消除重燃矛盾（删语义或改冷却不刷新 lastFiredAt）。
4. R19-04：resolved 文案按 phase 分支（如标题前缀"已恢复"）。
5. R19-03：/notifications 页 resolved 徽章 + i18n；配对展示口径与 ADR 对齐。
6. R19-05：registry 补 `test` script；契约测试补行为级用例（或下调 checklist 措辞）。
7. R19-07/R19-08：ADR 行文修正与指纹基数观察（可并入后续阈值配置化 ADR）。

## 11. 台账指针

- 本报告即 findings 来源；如需入台账，将 R19-01..R19-08 追加到对应仓 `.trae/documents/findings.md`（评审会话只读，未写入）。
