# Expert Review — round39（2026-11-13，scope=`modules: [notification-center]`）

被审对象：ADR-062（投递规则与 severity/推送解耦）+ ADR-063（静默为运行时机制）落地的 notification-center 模块，含 registry 真源、nightwatch-backend 装配面与 nightwatch-frontend 展示面。

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 时间（CST） |
| --- | --- | --- | --- | --- |
| newbie-modules（真源） | dev | `60b2a20` | clean | 2026-11-13 23:55:12 → 2026-11-14 00:05 |
| nightwatch-backend（装配） | dev | `8d67da2` | clean | 同上 |
| nightwatch-frontend（展示） | dev | `b271eb6` | dirty 8 个，全部位于 3D 全景并行会话域（panorama 组件 / 文档 / i18n），与本模块无路径交集 | 同上 |

审计环境：宿主无 node；全部命令在 devbie-work 容器 `66b958b39256` 内对 `/home/worldzhy/src/*` 挂载树执行（容器内 `/tmp/newbie-modules` 为 `0f3c793` 旧快照且缺依赖，未使用）。registry 仓不装模块运行期依赖，模块单测按 AGENTS.md 约定在消费仓装配面执行；装配面与真源 `diff -rq` 为空（见 §2）。

并行会话判定：前端 dirty 路径不落在 notification 域，本报告无 `provisional` 结论。

## 2. 范围与方法

- scope：`modules: [notification-center]`；仓 = newbie-modules（真源）+ nightwatch-backend（装配）+ nightwatch-frontend（消费展示）。未纳入：copilot、security-evaluation 等其他模块；宿主 `src/application/**` 只审直接调用 notify 的域。
- 装配一致性（命令）：
  ```
  diff -rq /Users/worldzhy/src/newbie-modules/packages/modules/notification-center \
           /Users/worldzhy/src/nightwatch-backend/src/modules/notification-center
  → diff_exit=0
  ```
- 机械计数（命令）：
  ```
  ls -1 packages/modules/notification-center | wc -l                  → 14
  grep -Ec "@(Get|Post|Put|Delete|Patch)\(" controller.ts             → 23
  grep -Ec "@RequirePermission" controller.ts                         → 18
  grep -Ec "^\s*(it|test)\(" *.test.ts                                → 20
  ls prisma/migrations | grep -c notification                         → 5
  ```
- 分区：① 判定链与 Alert 生命周期；② 授权/可见性；③ 静默实体与审计；④ 前端展示契约；⑤ 门禁与治理。高敏域 ① ② 采用「模式扫描 + 逻辑评审」双角度。
- 并行：主会话顺序取证 + 1 个独立反驳代理（仅移交候选 P1 的结论与 file:line，未移交推理过程）；无失败重跑。
- 执行证据（被测树断言：newbie-modules `60b2a20` clean / backend `8d67da2` clean，装配面 diff 为空；容器内 `/home/worldzhy/src/nightwatch-backend`）：
  ```
  node --import tsx --test src/modules/notification-center/notification-center.service.test.ts
  → tests 20 / pass 20 / fail 0
  npx tsc --noEmit            → TSC_EXIT=0
  npx prettier --check src/modules/notification-center/**  → All matched files use Prettier code style
  ```
  前端（HEAD `b271eb6`，本轮触碰 6 文件）：
  ```
  npx tsc --noEmit → TSC_EXIT=0
  npx eslint silence-card.tsx delivery-rules-card.tsx delivery-runtime.ts notification-detail-panel.tsx → ESLINT_EXIT=0
  npx prettier --check <同上 6 文件> → All matched files use Prettier code style
  ```

## 3. 结论摘要与维度评分

重构方向成立：判定（规则表）与投递（实时段）分层、每次投递可解释（`NotificationDeliveryAttempt` + `runtimeReason` + `silenceId`）、静默只拦推送不拦站内记录，均按 ADR-062/063 落地且装配一致。问题集中在**「配对」假设与真实调用方不一致**、**新增加的全局告警控制面被默认角色继承**、以及**Alert 唯一键缺 projectId**。

| 维度 | 评分 | 依据 |
| --- | --- | --- |
| 安全 | B- | 无 P0；授权面无越权读写，但全局告警控制面对 MEMBER 全开（R39-02）；未发现注入/链接绕过 |
| 架构 | B | 分层清晰，但 ADR-062 的配对承诺在消费侧失效（R39-01）；Alert 键设计缺租户维度（R39-03） |
| 契约 | C+ | ADR 文本 vs 实现/调用方冲突（R39-01）；前后端链接谓词不一致（R39-08）；DTO 校验缺口（R39-05） |
| 测试 | B- | 20 用例全绿、覆盖面合理；但「同键 firing/recovered」这一生产未使用的形态是唯一被覆盖的配对路径（R39-01 的测试盲区） |
| 门禁 | A- | tsc / prettier / 单测全绿；`next build` 未跑（3001 并行 dev server 占用 `.next`，见 §9） |
| 治理 | B | ADR-062/063 存在且细化；但新增全局控制面未补授权决策（R39-02） |

## 4. P0

无。R39-02 虽由「任意登录用户」可达，但其权限由 seed 显式授予（非越权），影响为可逆配置变更而非数据丢失/密钥泄露，按矩阵定 P1。

## 5. P1（按仓分组）

### R39-01 `newbie-modules` + `nightwatch-backend` — firing/recovery 配对在真实调用方失效，被 suppress 的告警其恢复仍会推送

- 设计承诺：ADR-062 `:86`「恢复事件复用同一裁决——'firing 与 recovered 同进同退'由数据模型保证」；`:135`「对所有消费方一致：低于规则阈值的 firing 只落站内，其恢复同样只落站内」；`:168`「`recoveryOf` 删除，靠 Alert 实例配对」。schema `prisma/schema.prisma:167-169` 注释同样声明 `fingerprint` 用于配对 firing/recovered。
- 实现：配对键是 `(notificationKey, fingerprint)`（`prisma/schema.prisma:189`），`fingerprint = deduplicationKey ?? notificationKey`（`notification-center.service.ts:232-238`），查询/创建见 `:380-413`。
- 真实调用方：firing 与 recovered 使用**不同 notificationKey 且不同 dedupKey**——
  - `url-check-alerts.notifications.service.ts:38-55`（`url-check.down` + `url-check:<targetId>:<bucket>`）与 `:73-92`（`url-check.recovered` + `url-check:<targetId>:recovered:<bucket>`）；
  - `heartbeat-offline.notification.ts:16`（`heartbeat.offline`）与 `heartbeat-recovered.notification.ts:21`（`heartbeat.recovered`）。
- 后果：恢复永远落到新 Alert 行上重新求值（seed 默认规则 `phase=recovered → deliver`，ADR-062 `:130`），因此「firing 被 suppress」时恢复仍会推送——正是本 ADR 声称消除的噪声。同时恢复记录挂在另一个 `alertId`，`NotificationAlert.state` 永远停留在 `firing`（`upsertAlert` 的 `resolved` 只在同键事件里产生，`:402`）。
- 可达角色：无攻击者参与，任意触发 url-check/heartbeat 事件的常规运行即可复现。
- 暴露面：live（backend `8d67da2` 已装配）。
- 复现：对某 target 制造一次 `severity` 低于规则阈值的 down（firing 落站内不推送）→ 恢复事件按 `url-check.recovered` 新建 Alert → 命中默认恢复规则 → 推送。静态可证：两条 INSERT 路径的 `notificationKey` 不同即不可能命中 `notificationKey_fingerprint` 唯一键。
- 测试盲区：`notification-center.service.test.ts:227-233` 只覆盖「同 key + `status: "recovered"`」的复用，生产无调用方使用该形态——测试证明的是实现-契约一致，不是契约适配（§10 教训 5）。
- 修复方向（不在本会话实施）：二选一——(a) 模块提供显式配对入口（firing 返回 `alertId`，recovered 按 `alertId`/`fingerprint` 复用，恢复可带独立 notificationKey）；(b) 统一消费方在同一 notificationKey 上用 `status: "recovered"` 表达恢复，并在 README/ADR 固化「恢复必须复用 firing 的 key+dedupKey」为强制契约 + 增加跨 key 调用方的回归测试。

### R39-02 `newbie-modules` + `nightwatch-backend` — 全局告警控制面（静默/规则/中心开关/广播）对默认 MEMBER 全量开放

- 事实链：
  - seed `prisma/seeds/permission-groups.ts:210-216`：`Notifications` 组命名空间 `module/notification-center`（按命名空间派生全部模型 × 全部动作）；`:429-441`：MEMBER = 除 `All/IAM/JDY/Overview` 外的全部内置组 → 含 `Notifications`。
  - 该命名空间现有 8 个模型（`prisma/schema.prisma:20/45/109/126/144/164/196/225`），新增的 `NotificationDeliveryRule`、`NotificationSilence`、`NotificationCenterSetting` 自动落入同组。
  - 路由侧因此对 MEMBER 开放：删除投递规则 `notification-center.controller.ts:216-218`、新建静默 `:234-236`（`condition: {}` 匹配一切，`notification-center.constants.ts` 的 matcher 空对象语义）、关中心推送开关 `:157-158`、`POST /notifications` 平台级广播 `:57-58`。
  - 前端同组门禁：`(dashboard)/notifications/settings/layout.tsx:11-13`（`<RequirePermission routePath="/notifications">`）。
- 影响：任一普通成员可（1）开一条匹配一切的静默窗口 → 全平台聊天告警静默；（2）删除/重排投递规则 → 改变所有告警的推送判定；（3）关闭中心推送开关；（4）以任意已注册模板 + 任意上下文值向全体用户投递站内通知（`link` 可为任意外部 https 地址，`service.ts:53-66` 只限协议不限域名），构成钓鱼面。
- 可达角色：MEMBER（组织默认成员角色）。
- 暴露面：live。
- 可利用性：直接（普通 REST 调用）。
- 修复方向：把「全局投递控制」从共享命名空间中拆出（独立 namespace/权限原子，仅 ADMIN 或新增运维角色持有），保留 `NotificationSetting` 的成员可读可调；或至少在 ADR 中显式接受「成员可静默全平台」并配套审计。

### R39-03 `newbie-modules` — Alert 唯一键不含 projectId；无 dedupKey 的调用方所有项目共用一行 Alert，裁决永久冻结

- 事实：`@@unique([notificationKey, fingerprint])`（`prisma/schema.prisma:189`）+ `fingerprint` 默认等于 notificationKey（`notification-center.service.ts:234`）；`upsertAlert` 的 where 不含 `projectId`（`:380-413`）。
- 真实调用方：`task-status-changed.notifications.service.ts:45-55` 传 `projectId` 但**不传** `deduplicationKey` → 所有项目的任务状态变更共用同一个 Alert 行。
- 后果：`projectId`/`severity` 被最后写入者覆盖（`:390-397` 的 update 数据）；裁决只在首个事件求值一次并被永久复用，因为该键永不产生 `resolved`（`:402` 的清空条件不成立）。带 `projectIds` 条件的规则因此会把 A 项目的裁决应用到 B 项目；运营改规则对这类通知不生效。
- 暴露面：live。可达性：常规事件触发，无需权限。
- 修复方向：唯一键补 `projectId`（或 `fingerprint` 强制由调用方提供且含项目维度）；对未提供 dedupKey 的调用方按 `projectId` 派生 fingerprint；为「永不恢复」的告警定义过期/自动 resolved（与 R39-11 同一前置）。

## 6. P2（按主题归并）

| ID | 仓 | 主题与证据 | 备注 |
| --- | --- | --- | --- |
| R39-04 | newbie-modules | `NotificationDeliveryAttempt.silenceId` 无关系/外键（`prisma/schema.prisma:210`，仅 `@@index`；`NotificationSilence` 模型 `:225-236` 无反向关系）；`notification-silence.service.ts:105-107` 直接 `delete` → 已抑制过的投递审计指向不存在的静默行 | 可解释性损失；建议 FK `onDelete: SetNull` 或改为软删 |
| R39-05 | newbie-modules | `comment` 仅 Swagger 声明 `maxLength: 512`（`notification-center.dto.ts:491-494`、`:513-516`），无 `@MaxLength`；列是 `VarChar(512)`（schema `:230`）→ 超长输入 500 而非 400 | 契约/健壮性 |
| R39-06 | newbie-modules | `simulate({recordId})` 的 `labelsFromRecord` 不做项目可见性校验（`notification-delivery-rule.service.ts:234-241`），而 `getDeliveryAttempt` 做了（`notification-center.service.ts:678-685`） | 需 UUID + `List` 权限；泄露 notificationKey/severity/projectId |
| R39-07 | 前端 | 静默卡只能「从现在开始」（`silence-card.tsx:107` 仅提交 `endsAt`；服务端 `notification-silence.service.ts:52` 支持 `startsAt`），但列表渲染 `scheduled` 状态（`:154-158`） | 能力与展示不一致 |
| R39-08 | 前端 + 模块 | 后端允许绝对 http(s) 链接（`notification-center.service.ts:53-66`），前端 `isSafeNotificationLink` 委托 `isSafeInternalPath`（`use-open-notification.ts:23-24`）→ 绝对链接仍显示「打开关联页面」按钮但点击无跳转 | 谓词双实现不一致 |
| R39-09 | newbie-modules | dedup 竞态兜底 `recordId = existing?.id ?? ""`（`notification-center.service.ts:293`），返回空 id + `deduplicated: true` | 边界；调用方仅按 `deduplicated` 早退 |
| R39-10 | newbie-modules | `getOrCreateCenterSetting` 先查后建，无 P2002 兜底（`:567-580`）；首次并发投递可能 500 | 一次性窗口，静态推断 |
| R39-11 | newbie-modules | `NotificationAlert` 无 TTL/自动 resolved（schema `:164-190`；`upsertAlert` `:402` 仅在 resolved 后重开时重算）——这也是抑制（inhibition）暂缓的前置条件 | 已知限制，与 `devbie/.trae/documents/backlog.md:84` 记录一致 |
| R39-12 | newbie-modules | 模拟器 `runtimeReason` 只判静默（`notification-delivery-rule.service.ts:217-229`），忽略 channel-off / subscription-off / no-port，可能给出「会推送」的错误结论 | 代码注释已自认；建议 UI 标注覆盖范围 |

## 7. 误报剔除（反驳轮）

| 候选 | 处置 |
| --- | --- |
| 「恢复永远新建 Alert」原句 | **收窄后保留**：反驳代理指出同键场景复合唯一键确实复用（单测 `:227-233`）。主会话裁决：生产调用方全部使用不同 key，因此 R39-01 结论按「真实调用方场景」成立，原句过宽已改写 |
| 「静默会拦截站内记录」 | **推翻**：静默只 gate `dispatchPush` 与项目轨道推送（`notification-center.service.ts:306-345`），record/attempt 照写 |
| 「项目轨道忽略 channel-off 是缺陷」 | **推翻**：设计如此（`project-notification-push.service.ts:61-67` 明示中心通道原因不适用于项目轨道） |
| 「`//host`、`/\host` 可绕过链接校验」 | **推翻**：`isSafeNotificationLink` 显式拒绝 `//`、反斜杠与 C0 控制符（`notification-center.service.ts:53-66`） |
| 「设置类端点缺鉴权」 | **推翻**：23 条路由中 18 条 `@RequirePermission`，其余 5 条为 `@RequireOwner`（本人域：list/unread-count/read/read-all/delivery-attempt） |
| 「前端直接渲染 `notification.link` 为 href」 | **推翻**：详情面板与弹层均经 `onOpenLink` → `router.push`，前置 `isSafeNotificationLink`（`notification-detail-panel.tsx:127-132`、`notification-detail-sheet.tsx:101-106`、`use-open-notification.ts:59-76`） |

## 8. 已核验通过的不变量（正面结论）

1. **装配一致**：真源与消费仓 notification-center 目录 `diff -rq` 零差异（§2 命令）。
2. **链接注入**：写入侧拒绝 `javascript:`/`data:`/`//`/反斜杠/C0；展示侧二次守卫；无 `dangerouslySetInnerHTML`。
3. **可见性隔离**：`list/get/unread-count/markRead/getDeliveryAttempt` 全部经 `buildProjectVisibilityWhere` + `getVisibilityFloor`；`getDeliveryAttempt` 先校验记录可见再读 attempt。
4. **权限面**：18/18 特权路由带 `@RequirePermission`；5 条本人域路由带 `@RequireOwner`。
5. **推送解耦**：最终推送 = `verdictAction === "deliver" && runtimeReason === null`（`dispatchPush`），项目轨道由宿主决定且只认 `silenced`/`recovery-opt-out`。
6. **静默语义**：静默不删除、不改写站内记录，只影响推送；`silenceId` 随 attempt 落库，前端详情与模拟器均可解释。
7. **判定顺序**：`subscription-off → recovery-opt-out → channel-off → silenced → no-port` 与 ADR-063 一致（`notification-center.service.ts:435-462`）。
8. **门禁**：20/20 单测、backend `tsc`、prettier 全绿；前端本轮 6 文件 tsc/eslint/prettier 全绿（§2 executed 证据）。

## 9. 覆盖率清单

审了：
- 模块全部 14 个文件（service / silence service / rule service / registry / setting service / controller / dto / constants / module / notification base / README / prisma schema / manifest，及单测）。
- 装配面 `nightwatch-backend/src/modules/notification-center/**`（经 `diff -rq` 与真源一致后以真源为准阅读）。
- 宿主消费点：`project-notification-push.service.ts`、`url-check/url-check-alerts.notifications.service.ts`、`task-management/task-status-changed.notifications.service.ts`、`heartbeat-*.notification.ts`。
- 前端：`silence-card.tsx`、`delivery-runtime.ts`、`delivery-rules-card.tsx`、`notification-detail-panel.tsx`、`notification-detail-sheet.tsx`、`use-open-notification.ts`、`settings/{page,layout}.tsx`、`messages/{en,zh}.json`（通知命名空间）。
- 治理：ADR-062/063、`prisma/seeds/permission-groups.ts`、`prisma/seeds/roles.ts`、迁移 `20261113152829_add_notification_silence`、`findings.md` 台账格式。

没审 / 未跑：
- `next build`（3001 端口并行 dev server 占用 `.next`）；`npm run build`（nest build）与 `newbie doctor` 未跑，以 `tsc --noEmit` 替代。
- 未跑运行时 E2E：silenced 分支的落库取证发生在交付会话（2026-11-13），本报告只引用其结论，不重复执行。
- 生成物 `src/api/_gen/api.ts`、其他模块、CI workflow、依赖版本矩阵未纳入（与本模块无直接契约变更）。
- 迁移 SQL 只核对了静默表部分，未做全量迁移链一致性核验。

## 10. 修复优先级

1. R39-01（配对失效 → 恢复噪声，直接影响用户可感行为）
2. R39-02（全局告警控制面对成员全开）
3. R39-03（Alert 键缺 projectId → 跨项目裁决污染）
4. R39-04 / R39-05（审计完整性与输入校验，低成本）
5. R39-08 / R39-07（前后端契约与 UI 能力对齐）
6. R39-06 / R39-09 / R39-10 / R39-12（边界与健壮性）
7. R39-11（与 inhibition 前置绑定的已知限制，先补 TTL 再谈抑制）

## 11. 台账指针

findings 台账：`newbie-modules/.trae/documents/findings.md` 的 `round39` 小节（R39-01 … R39-12）。
