# 专家评审 round50 — alert-center（source definitions 批次）

## 1. 锚点

| 仓                  | branch | HEAD      | dirty | 最近提交                                                                  |
| ------------------- | ------ | --------- | ----- | ------------------------------------------------------------------------- |
| newbie-modules      | dev    | `64f2c3f` | 0     | 2026-11-15 18:22 `test(security-evaluation): mirror the material row …`    |
| nightwatch-backend  | dev    | `554379a` | 20    | 2026-11-15 18:16 `feat(alerts): declare each host source's alert definitions` |
| nightwatch-frontend | dev    | `045b696` | 5     | 2026-11-15 18:17 `feat(alert-center): list alert definitions in the source settings` |

- 评审时间：2026-11-15 18:27–18:52 +08:00。
- 并行会话：backend 20 个 dirty 与 frontend 5 个 dirty 全部落在 security-evaluation 域（`prisma/models/security-evaluation.prisma`、`src/modules/security-evaluation/**`、`src/application/{evaluation,security-evaluation,project/security}/**`、前端 `security-evaluation/**`），另 frontend 两个 i18n 文件为并行会话追加非 `alertCenter` 命名空间的键。**alert-center 域无在途改动**，本轮结论不标 provisional。
- 本轮三个仓的 alert-center 改动均已提交并推送（`newbie-modules 02ea4bc`、`nightwatch-backend 554379a`、`nightwatch-frontend 045b696`），评审对象是工作树现状。

## 2. 范围与方法

- `scope: modules: [alert-center]`。
- 真源：`newbie-modules/packages/modules/alert-center`（11 个文件：3 源码 + 1 registry + 1 dto + 1 controller + 1 module + 1 manifest + 1 prisma + 2 测试 + README）。
- 装配面：`nightwatch-backend/newbie-modules.json` 命中 alert-center（sourceCommit `64f2c3f…`）；`diff -rq packages/modules/alert-center src/modules/alert-center` 退出码 0（空 diff）。
- 随之纳入：宿主 `src/application/alerts/**`（7 个 source 声明、9 个 producer `raise()` / 9 个 `resolve()` 调用点）、`src/application/notifications/project-notification-push.service.ts`、`prisma/seeds/{permission-groups,roles}.ts`、`newbie-modules ADR-065`、`nightwatch-frontend` settings 卡片与 `src/api/_gen/api.ts`。
- 方法：单路深读 + 不变量验证（definitions ↔ producer 实际 alertKey；pinned rhythm 的实际优先级；write 端点可达性与 scope 守卫）+ 模式扫描（`alerts.raise({` / `source: "` 字面量 / `repeatIntervalMinutes` 透传）+ 执行门禁。未启用子代理反驳轮：本轮无 P0/P1，全部结论为 static 级 P2；按 §4 铁律不经独立复核不得升 P1，故不升。
- 失败/重跑：无。

## 3. 结论摘要

本批次实现与声明本身一致：`definitions` 从 registry → DTO → apits 生成类型 → 前端渲染 → i18n 全链路贯通，装配零差异，后端 tsc/eslint/22 个单测与前端 tsc 全绿。风险集中在**声明与实际行为的绑定缺失**：`definitions` 是纯描述字段，模块既不校验 producer 的 alertKey 是否属于某个定义，也不阻止 API 覆盖定义里“固定”的节奏；契约真源 ADR-065 未同步。

维度评分：

| 维度 | 评分 | 依据 |
| --- | --- | --- |
| 安全 | 良好 | 本批次未新增可达面；写入端点的 scope 守卫（R44-03）未被削弱 |
| 架构 | 待加固 | definitions 与 producer 身份无机器可校验关系（R50-01） |
| 契约 | 需改进 | ADR-065 仍只写 key/displayName/defaultRepeatMinutes（R50-05） |
| 测试 | 需改进 | 新增 4 条启动期校验分支零测试（R50-04） |
| 门禁 | 通过 | tsc / eslint / 22 单测 / 前端 tsc / 装配 diff 全绿 |
| 治理 | 需改进 | 契约文档滞后于已发布 DTO（R50-05） |

## 4. P0

无。

## 5. P1

无。

## 6. P2（按主题归并）

### R50-01 definitions 与 producer 的 alertKey 之间没有任何运行时/编译期绑定

- 仓：newbie-modules + nightwatch-backend。暴露面：source（registry 契约）/ live（settings 展示）。可达性：自动路径。
- 证据：
  - registry 只校验结构，不接触 alertKey：`packages/modules/alert-center/alert-source-registry.service.ts:56-87`。
  - `raise()` 只校验 source 已注册并计算 fingerprint，不查询 definitions：`alert-center.service.ts:136-150`。
  - README 把 definitions 定义为“来源真正发出的生命周期族”，并承诺 settings 面据此展示（`README.md:9`）。
  - 9 个 producer `raise()` 调用点的 alertKey 形态（命令：`grep -rn "alerts.raise({" src --include="*.ts" | grep -v "\.test\.ts"`，10 条中 1 条为 controller）与声明值无对应关系：`url-check:<targetId>:<bucket>`、`heartbeat:<id>:<iso>`、`frontend-monitor:<app>:<signal>[:cat][:fp]`、`<applicationId>:<fingerprint>`、`<scheduleKey>`、`<subjectId>:<standardKey>`、`risk-spike:<subjectId>:<standardKey>`、`finding:<findingId>` 对 definitions 的 `down/offline/slow-*/error-spike/run-failed/dispatch-watchdog/run-failure/risk-spike/hit`。
  - 同一类漂移已有一处实例：source key 在 producer 里以裸字面量重复而非共享常量（`url-check.alert.ts:32,59`；`heartbeat-offline.alert.ts:43,70,92`），拼写仍靠注册期抛错兜底，但没有任何东西保证 family 列表同步。
- 影响：producer 新增/改名生命周期时，settings 面静默展示过期清单；`POST /alerts` 可写入任意未声明 alertKey（无 family 校验），清单与写入面互不约束。
- 修复方向（二选一，避免过度设计）：(a) 在 `AlertDefinitionDeclaration` 增加最小可校验归属（family 前缀或 matcher），注册期对 producer 传参断言；(b) 明确把 definitions 定为“描述性提示”，同步改写 README 与前端文案，不再宣称“列出真正会发出的族”。

### R50-02 definition 里“固定节奏”只约束来源覆盖，不约束写入 API

- 仓：newbie-modules + nightwatch-backend。暴露面：live。可达性：持 `module/alert-center` 全动作的登录用户（MEMBER 组）。
- 证据：
  - 优先级为 `requested > source override > default`：`alert-center.service.ts:144-148`、`:528-538`。
  - `POST /alerts` 原样透传 `repeatIntervalMinutes`：`alert-center.controller.ts:43-51`；DTO 只要求 `>=1`：`alert-center.dto.ts:40-43`。
  - settings 面把 pinned 声明渲染为 “Fixed {minutes} min”：`alert-center/settings/alert-source-settings-card.tsx:71-73`；README 同口径（`README.md:9`）。
  - reopen 会按请求值重置节奏（`alert-center.service.ts:196-214`），因此 `repeatIntervalMinutes=1` 可把 `risk-spike`（声明固定 1440）改成分钟级提醒。
  - 权限可达性：`prisma/seeds/permission-groups.ts:104-105`（Projects 组整体授予 `module/alert-center`）、`:211-217`（Alert Center 组同样授予该命名空间全部动作）；`prisma/seeds/roles.ts:6-8` 说明 MEMBER 绑定除 IAM/JDY/Overview 外的全部内置组；controller 仅在 body 带 scopeId 时校验可见性（`alert-center.controller.ts:107-115`）。
- 未定 P1 的理由：影响限于单条生命周期的提醒频率（噪音/成本），无跨租户写（scope 守卫生效），且写入权限是 seed 有意授予的既有信任模型；本轮不重开 R44-03 已裁决面。
- 修复方向：settings 文案区分“来源覆盖不可改”与“单次 raise 可覆盖”，或在 `raise()` 对声明了 pinned rhythm 的 family 忽略 `repeatIntervalMinutes`（前提是先落地 R50-01 的归属映射）。

### R50-03 job-scheduler 的两个 definition 实际是同一生命周期

- 仓：nightwatch-backend。暴露面：live。可达性：自动路径。
- 证据：
  - 普通失败 alertKey = `scheduleKey`（`job-run-failure.alert.ts:17-30`）。
  - 看门狗 alertKey = 调用方传入的 `ALERT_DISPATCH_REMINDERS_JOB_KEY`（`job-run-failure.alert.ts:57-82`；`alert.watch-reminder-dispatch.job.ts:62`），该常量就是调度键本身（`alert.dispatch-reminders.job.ts:6`）。
  - 两者共用同一通知键 `JOB_RUN_FAILED_NOTIFICATION_KEY`（`job-run-failure.alert.ts:24,69`）。
  - 声明把二者列为两个“lifecycle family”：`alert-source.registrar.ts:61-68`；README 将 definitions 定义为生命周期族（`README.md:9`）。
- 影响：settings 面把一个族展示成两个；运维可能以为暂停/节奏可按族区分（实际只能按 source），也可能以为看门狗有独立生命周期。
- 修复方向：合并为一个 definition（描述两种触发原因），或把看门狗拆出独立 alertKey 空间（会改变现有行为，需 ADR 决策）。

### R50-04 新增的 4 条启动期校验分支零测试

- 仓：newbie-modules。暴露面：source。可达性：维护期。
- 证据：`register()` 的四条抛错路径（重复 source、非法 `defaultRepeatMinutes`、非法 definition `repeatMinutes`、重复 definition key）在 `alert-source-registry.service.ts:57-79`；命令 `grep -rn "Duplicate alert definition\|Invalid repeatMinutes\|Invalid defaultRepeatMinutes" src/**/*.test.ts` 在消费仓 0 命中，registry 目录亦无 `alert-source-registry.service.test.ts`。现有 22 个用例只覆盖 `listSources` 的 definitions 映射（`alert-center.service.test.ts:410-437`）。
- 影响：校验逻辑回归无门禁；未来放宽/改写校验不会被测试拦住。
- 修复方向：为 registry 补 4 条用例（含正向：空 definitions、pinned 与 null 归一）。

### R50-05 契约文档滞后于已发布 DTO

- 仓：newbie-modules。暴露面：template / docs。可达性：维护期与新宿主接入期。
- 证据：
  - ADR-065 的来源注册口径仍是三元组 `key / displayName / defaultRepeatMinutes`（`.trae/documents/decisions/ADR-065-split-alert-domain-from-notification.md:72-73`、`:89-90`）；命令 `grep -n "definitions" ADR-065…` 0 命中。
  - 模块 schema 注释的 source 示例仍含 `cloudwatch`（`packages/modules/alert-center/prisma/schema.prisma:17`），而 registrar 只注册 7 个来源（命令：`grep -c "this.sources.register({" src/application/alerts/alert-source.registrar.ts` → 7），无 cloudwatch producer。
- 影响：新宿主按 ADR 实现注册时会漏掉 definitions；文档示例指向不存在来源，弱化“来源是代码注册制”的可信度。
- 修复方向：ADR-065 增补 definitions 段（含 pinned rhythm 的语义与 R50-01/02 的边界裁决）；schema 注释示例改为泛化描述或宿主真实来源。

## 7. 误报剔除

1. “definitions 未进前端生成类型 / apits 过期”——不成立：`src/api/_gen/api.ts:4926-4976` 含 `AlertDefinitionDto` 与 `AlertSourceDto.definitions`，前端 `tsc --noEmit` 通过。
2. “source 覆盖会改写 risk-spike 的固定节奏”——不成立：请求值优先于覆盖值（`alert-center.service.ts:528-538`），producer 传 `RISK_SPIKE_REPEAT_MINUTES`（`security-evaluation.alert.ts:32,133`），source override 只在无请求值时生效。
3. “重复 definition key 会静默覆盖”——不成立：注册期抛错（`alert-source-registry.service.ts:77-79`）。
4. “空 definitions 会让 settings 渲染异常”——不成立：`declaration.definitions ?? []`（`alert-source-registry.service.ts:66`）+ 前端长度守卫（`alert-source-settings-card.tsx:63`）。
5. “R49-05 的 500 行上限”——carry-over，仍 open（`nightwatch-backend/.trae/documents/findings.md`），本轮未改该路径，不重复计新 finding。

## 8. 已核验通过的不变量

- 装配一致性：`diff -rq` registry ↔ `nightwatch-backend/src/modules/alert-center` 为空；`newbie-modules.json` pin `64f2c3f…` 与 registry HEAD 一致。
- 单一映射出口：`toSourceDto` 被 listSources 与 updateSource 两个出口共用（`alert-center.service.ts:422-426,451-461`），definitions 只在此处映射（`:475-479`），无第二真源。
- definitions 不落库：`AlertSource` 无 definitions 列（`prisma/schema.prisma`），本批次无 schema/migration 变更。
- 启动期校验完整：重复 source、非法 default rhythm、非法 definition rhythm、重复 definition key 四条路径均 fail-fast（`alert-source-registry.service.ts:57-79`）。
- pinned 节奏双端同源：registrar 与 producer 共用 `RISK_SPIKE_REPEAT_MINUTES`（`alert-source.registrar.ts:10,77`；`security-evaluation.alert.ts:32,133`）。
- 展示语义与优先级一致：inherit 显示 `effectiveRepeatMinutes`，pinned 显示 definition 值（`alert-source-settings-card.tsx:71-73`），与 service 的三段优先级一致。
- 权限未被削弱：`GET/PUT alert-sources` 分别要求 List/Update（`alert-center.controller.ts:85-99`）；写端点 scope 守卫仍在（`:107-115`）。
- i18n 齐备：`en.json:619-621` / `zh.json:619-621` 四键齐全。
- 执行门禁（证据：容器 `devbie-work`，源挂载 `/home/worldzhy/src`）：后端 `npx tsc --noEmit` 退出 0；`npx eslint src/modules/alert-center src/application/alerts` 退出 0；`node --import tsx --test src/modules/alert-center/*.test.ts` 22/22 通过；前端 `npx tsc --noEmit` 退出 0。

## 9. 覆盖率清单

审了：alert-center 全部 11 个文件；registry↔装配全量 diff；宿主 registrar 7 个声明与 9+9 个 producer 调用点的 alertKey 形态；alert-source 常量与 `RISK_SPIKE_REPEAT_MINUTES` 流向；权限 seed 的 Projects / Alert Center 两组绑定与 MEMBER 角色组合；通知 adapter 的 labels→notificationKey 路由与 projectId 缺失时的外发短路；前端 settings 卡片、生成 API 类型、i18n；ADR-065 相关段落。

没审：alert-center 前端列表/详情页渲染；notification-center 模块内部；job-scheduler 实现；DB 存量数据；生产部署事实；Lark SDK 内部；CI 模板门（未复跑）；security-evaluation 并行在途改动（按锚点排除）。

## 10. 修复优先级

1. 先定契约口径（R50-01 + R50-05 同一决策）：definitions 是描述性提示还是可校验契约。口径定了再决定 R50-02 的文案/实现取向。
2. R50-04 补 4 条 registry 用例，作为后续改动的回归门禁。
3. R50-03 合并或拆分 job-scheduler 声明（改写 declaration 时零成本）。
4. R50-02 软化 “Fixed” 文案或按 R50-01 的映射在 `raise()` 内锁定。

## 11. 台账

新增 R50-01 … R50-05，见 `.trae/documents/findings.md` round50 段。
