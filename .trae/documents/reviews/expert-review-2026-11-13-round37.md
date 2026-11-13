# Expert Review — round37：notification-center 的 severity floor 是否把"严重程度"与"推送投递"耦合

- 评审对象：`ADR-060-notification-severity-floor-gates-push.md`、`ADR-061-recovered-delivery-is-decoupled-from-severity.md` 及其落点 `packages/modules/notification-center/**`
- scope：`plan`（被审主张取自上述两份 ADR，依赖路径 = notification-center 模块 + 宿主装配副本 + 设置页 + 宿主声明）
- 调用原话：「floor 的设计是不是有问题？貌似把严重程度和推送耦合了」

## 1. 锚点

| 仓 | branch | HEAD | dirty | 被审域是否 dirty |
| --- | --- | --- | --- | --- |
| newbie-modules | dev | `f9010c8` | 11 | 否（dirty 全在 `aws-cloudwatch` + `ADR-059` 未跟踪） |
| nightwatch-backend | dev | `5a22e9c` | 17 | 否（dirty 全在 `aws-cloudwatch`、`authorization`、`prisma/migrations`） |
| nightwatch-frontend | dev | `7e433d9` | 12 | 否 |

- 评审时间：2026-11-13 19:15–19:30 CST
- 装配一致性：`diff -rq packages/modules/notification-center src/modules/notification-center` → 输出为空，`diff_exit=0`（registry 与宿主逐字节一致）
- 并行会话：两个后端仓均有在途改动，但均不落在 notification-center 路径，故本报告结论**不标 provisional**。

## 2. 范围与方法

- 取证命令：
  - 计数：`grep -rho 'defaultSeverity\s*=\s*"[a-z]*"' src/application/notifications --include='*.ts' | sort | uniq -c | sort -rn` → `9 high / 5 medium / 3 critical / 2 low`，合计 19 条声明。
  - 执行：`npx tsx --test src/modules/notification-center/notification-center.service.test.ts`（宿主装配副本，容器 `66b958b39256`）→ `tests 8 / pass 8 / fail 0`。
  - 静态：逐行读 `notification-center.service.ts`、`notification-center.constants.ts`、`prisma/schema.prisma`、`notification-setting.service.ts`、`notification-registry.service.ts`、`README.md`、两份 ADR、宿主 19 条声明、前端设置页与通知列表页。
- 主张清单由调用者的追问拆解为 4 条（C1–C4），逐条给出判定；方案外新发现按 §5 记。
- 未使用子代理；反驳轮由主会话自查（部分独立，同基础模型），已在每条判定中给出反证路径。

## 3. 结论摘要

**用户主张成立：floor 确实把"严重程度"与"推送投递"耦合了。** 但这不是实现 bug，而是 ADR-060 §决策的显式设计——`minimumSeverity` 以 severity 为比较键、以 push 为输出。

真正的设计缺陷不在"耦合"本身，而在于 **severity 一个字段同时承担两种职责**：

1. 语义影响面（前端徽章、severity 筛选、`highestSeverity` 聚合）；
2. 打扰预算（是否值得推送到聊天通道）。

两者不同源时冲突无法表达，于是产生了三类可观测代价（均有 `file:line`）：

- **为无级别的事件造特例**：recovery 没有告警级别，于是引入 `recoveryOf` 字段 + 额外的 registry 查表 + 未注册告警分支（`notification-center.service.ts:208-214`）。若投递策略独立于 severity，这个字段不必存在。
- **反向激励**：ADR-060 §影响原文——「`web.js-error-digest` 若要求默认推送，应显式提高其默认级别或降低中心 floor」。即"想推送 → 虚报严重程度"，而 severity 同时是站内展示口径。
- **判定结果与语义字段不一致**：recovered 记录落库 `severity = "low"` 占位（`notification-center.service.ts:233`），而列表接口按 severity 过滤（`notification-center.service.ts:425`），导致"按 critical/high 筛选"看不到对应的恢复记录。

维度评分（1–5，5 最优）：

| 维度 | 分 | 说明 |
| --- | --- | --- |
| 契约 | 3 | `NotifyResult.pushSuppressed` 字段名与 ADR 一致，但三处注释仍声称"recovered 永不被 floor 门控"，与代码/测试相反（F1） |
| 架构 | 2 | severity 双职责；floor 与 per-key 开关串联且优先级对操作者不可见 |
| 一致性 | 3 | 同一张设置卡上，中心开关只管 system track，floor 却管 system + project track |
| 测试 | 3 | 8 条全绿，覆盖 floor 两个方向与 recovered 两分支；但"firing/recovered 开关镜像"这条不变式没有测试或代码校验（F4） |
| 治理 | 4 | ADR-060/061 链条完整、跨宿主检验已写；缺一篇"投递策略是否应独立于 severity"的决策 |

## 4. 主张判定表

| # | 主张（出处） | 判定 | 依据 |
| --- | --- | --- | --- |
| C1 | ADR-060：floor 只约束推送，不约束落库；低于 floor 的通知始终写入 `NotificationRecord` | **成立** | 记录创建在门禁之前且无条件（`notification-center.service.ts:244-266`），`pushSuppressed` 只短路 `dispatchPush`（`:284`）；executed：测试 "a delivery below the center floor is recorded in-app but not pushed" 断言 `created.length === 1 && pushed === false` |
| C2 | ADR-061：恢复通知的投递**与 severity 完全解耦**，且与 firing 同进同退 | **部分成立** | "同进同退"成立（前提是 `recoveryOf` 被正确声明）：executed 测试 "a dedicated recovered declaration is judged at its firing key's severity" 断言自身 `low` + firing `critical` → 推送。"完全解耦"**不成立**：推送判定仍 100% 由 severity 派生，只是把判定源从"自身 severity"换成"firing 声明 severity"（`:214-216`）。恢复真正解耦的只有"不提供自己的级别"这一半 |
| C3 | 推送粒度是"每个 notificationKey"，不是每条事件实例 | **成立** | `NotificationSetting.isPushEnabled` 逐 key（`prisma/schema.prisma:16-36`），声明 bootstrap 只建缺失行不覆盖（`notification-setting.service.ts:63`）；前端逐行开关（`notification-settings-card.tsx:364`）。`NotifyInput` 无逐实例推送覆盖（`:85-86` 只有 `severity` 覆盖） |
| C4 | floor 把"严重程度"与"推送投递"耦合 | **成立**（事实层） | 比较键 `SEVERITY_LEVEL[floorSeverity] < SEVERITY_LEVEL[center.minimumSeverity]`（`notification-center.service.ts:215-216`）、输出为 push/not-push（`:284`）；UI 文案直接对外承诺该耦合（`src/i18n/messages/zh.json:1164`「低于该级别的通知仍会记录在站内，但不会推送」）。耦合是设计选择而非缺陷；缺陷见 §3 的三类代价 |

耦合的量化影响（命令见 §2）：19 条声明中 **7 条**默认低于 floor=`high`（5 medium + 2 low），在默认配置下"装完即不进聊天通道"；其中 `web.slow-*` 的声明注释明确写着 "Medium severity: in-app bell only"，说明作者已把 severity 当作投递标签使用。

## 5. 方案外 findings

### R37-01（P2，文档与代码相反）

`NotifyResult.pushSuppressed` 的注释断言"recovered 永不被 floor 门控"：

- `notification-center.service.ts:119-123`（"Always false for recovered-phase deliveries, which the floor never gates (ADR-061)"）
- `notification-center.service.ts:163-167`（`notify()` 文档注释同义）
- `src/application/notifications/project-notification-push.service.ts:37-38`（"Recovered deliveries are never floor-gated"）

反证：`:215-216` 对 recovered 同样计算 `pushSuppressed`（用 firing severity）；测试 `notification-center.service.test.ts:131-139` 明确断言"shared key 的 recovered 保持 firing 的抑制结论"。这是第一个提交（`2a52a2c` 的 `!recovered` 豁免）留下的注释，未随后续 `recoveryOf` 实现更新。影响：契约读者会以为恢复不受 floor 影响，进而误判"为什么恢复了却没推送"。
可达性：不可达（纯文档）。暴露面：source + live（注释随装配进入宿主）。

### R37-02（P2，正确性/UX）

recovered 记录以 `severity = "low"` 落库占位（`notification-center.service.ts:233`，存的是 `severity` 而非 `floorSeverity`），而列表查询按 `severity` 等值过滤（`:425`）：

- 用户按 `critical`/`high` 筛选 → 看不到这些告警的恢复记录；
- 任何按 severity 聚合的统计都会把"critical 告警的恢复"计为 low。

前端列表虽已用 `RecoveredBadge` 替代 severity 徽章（`src/app/(dashboard)/notifications/page.tsx:94-98`），但筛选器仍按 severity 值下发（`page.tsx:41-45,153`）。可达性：任意登录用户。暴露面：live。影响：正确性（告警闭环在筛选视图里断裂）。

### R37-03（P2，设计一致性）

floor 跨 track 生效，而中心开关只对 system track 生效：

- `notification-center.service.ts:284-291`：中心 `isPushEnabled` 与 per-key 开关同时为真 + `scope === "system"` 才走中心端口；
- `src/application/notifications/project-notification-push.service.ts:31-38`：project track 明确声明"中心推送总开关不门控本 track"，但"中心 severity floor 同样门控本 track"。

同一张"推送策略"卡片上的两个控件（`notification-settings-card.tsx:198` 开关、`:203-215` floor 下拉）作用域不同，操作者无法从界面推断。可达性：仅管理员（中心设置写权限）。暴露面：live。影响：可运维性/正确性（关掉中心开关后 floor 仍静默拦截项目推送）。

### R37-04（P2，不变式无强制）

ADR-061 不变式 2 要求"专用 recovered 声明的 `defaultPushEnabled` 必须镜像其 firing 声明"，但：

- 模块内只有 `notification-setting.service.ts:63` 的 `defaultPushEnabled ?? true` 默认值，无任何跨 key 一致性校验（`grep -rn defaultPushEnabled` 只命中 3 个文件：`notification-registry.service.ts:46`、`notification-setting.service.ts:63`、`notification.ts:27,44`，均无配对检查）；
- 无对应测试。

后果：新增 recovered 声明时若忘记镜像，会出现"firing 推送、recovery 不推送"（或反向），而 floor 判定已经对齐、测试也不会红。当前宿主 2 对 recovered 声明（`url-check.recovered`→`url-check.down`、`heartbeat.recovered`→`heartbeat.offline`）恰好都正确，属于约定维持而非机制保证。可达性：不可达（需代码变更）。暴露面：source。

## 6. 误报剔除

- **"floor 违反 ADR-060（丢弃记录）"** —— 不成立。记录无条件写入在门禁之前，executed 测试已证。ADR-060 的落地是完整的。
- **"recovered 完全不受 floor 影响，所以 recoveryOf 是多余抽象"** —— 不成立。移除 `recoveryOf` 会使 dedicated recovered 声明按自身 `low` 判定，与 firing 脱钩，直接违反不变式 2。
- **"per-key 开关可以覆盖 floor"** —— 不成立。`dispatchPush` 中 floor 是独立前置短路（`:284`），per-key 开关为真也无法越过 floor；两者是串联 AND，不是优先级关系。这条恰是 §3 指出的可解释性缺陷，而非误报。

## 7. 已核验通过的不变量

1. 低于 floor 的投递必定落库（`service.ts:244-266`；测试 114-121）。
2. floor 不改变返回值中的记录 id / dedup 语义：dedup 在推送之前解析（`:247-266`），命中时不重复推送（`:268`）。
3. `pushSuppressed` 对 system 与 project 两条 track 都被消费（`service.ts:284`、`project-notification-push.service.ts:58`），不存在"标记了但没人读"的悬空字段。
4. 推送缺少 `pushPort`、中心开关关闭、per-key 关闭、scope 非 system 四种情况均安全短路（`:284-291`），无异常路径。
5. recovered 展示层不再渲染 severity 徽章（`page.tsx:94-98`），severity 的 low 占位不会在列表行上泄露为"LOW"标签。
6. registry 与宿主装配逐字节一致（`diff_exit=0`）。

## 8. 覆盖率清单

已审：

- `packages/modules/notification-center/`：`notification-center.service.ts`（全量）、`.constants.ts`、`.dto.ts`（`pushSuppressed`/`minimumSeverity` 字段）、`.test.ts`（8 条）、`notification-setting.service.ts`、`notification-registry.service.ts`、`notification.ts`、`README.md`、`prisma/schema.prisma`
- 宿主：19 条通知声明（severity/push 分布）、`project-notification-push.service.ts`、`url-check-recovered`、`heartbeat-recovered`、`web-error-digest`
- 前端：`notifications/settings/notification-settings-card.tsx`、`notifications/page.tsx`、i18n `minSeverityHint`
- 文档：ADR-060、ADR-061

未审（明确排除）：

- notification-center 控制器与 HTTP 端点细节（权限装饰器）、`lark` 模块推送实现、digest 任务的调度与数据来源、其他模块、`prisma/migrations/**`、生成代码（`src/api`）。

## 9. 修复优先级

1. **R37-01**（文档纠错，成本最低）：把三处"never floor-gated"改为"按 firing 级别门控，故与 firing 同进同退"。
2. **R37-02**：recovered 记录的 severity 占位污染筛选与聚合。最小改法是在列表查询中让 `status=recovered` 的筛选语义显式化（或前端对 recovered 禁用 severity 筛选并说明）；根治依赖第 4 条。
3. **R37-03**：把 floor 的作用域在 UI 文案中写明（"同时约束系统推送与项目推送"），或让 floor 与中心开关同域。
4. **架构建议（另起 ADR，不在本评审内实施）**：把"语义分级"与"投递策略"拆成两个字段。可行形态：
   - A（最小）：保留 floor，但在声明层引入显式 `pushPolicy`（`always` / `floor` / `never`），bootstrap 时按当前 severity 一次性推导初始值；`recoveryOf` 降级为"投递策略镜像"而非"severity 查表"。成本：`NotificationSetting` 加列（nightwatch 已 live，需 `prisma migrate`）、DTO/前端设置页、既有行回填。
   - B（彻底）：删除 floor，投递只由 per-key 开关 + 聊天绑定（显式订阅）决定。语义最干净，但会放行全部 7 条低级别声明到项目群，噪声风险由使用者承担；需产品决策。
   - C（现状加强）：保留现状，仅补齐 R37-01/03/04 的文档与校验。零迁移成本，但 severity 双职责长期存在。

   主会话倾向 A：它在不改变"floor 是噪声旋钮"这一产品结论的前提下，让 severity 回归纯语义字段，并消除 `recoveryOf` 的查表特例；但 A/B 属产品与迁移决策，应交 ADR。

## 10. 台账指针

- 本轮 findings 尚未写入 `.trae/documents/findings.md`（评审会话只读，不修改台账）；ID 预留 `R37-01`–`R37-04`。
- 关联：ADR-060（floor 只挡推送）、ADR-061（恢复投递与 severity 解耦）。
