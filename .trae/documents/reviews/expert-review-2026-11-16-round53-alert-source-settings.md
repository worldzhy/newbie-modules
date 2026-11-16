# 专家评审 round53 — alert-center（Alert source settings 面）

## 1. 锚点

| 仓                  | branch | HEAD      | dirty | 最近提交                                                              |
| ------------------- | ------ | --------- | ----- | --------------------------------------------------------------------- |
| newbie-modules      | dev    | `d628aa0` | 2     | 2026-11-16 05:33 `refactor(security,account): key access tokens by session id` |
| nightwatch-backend  | dev    | `5cf9ab3` | 5     | 2026-11-16 05:33 `refactor(security,account): key access tokens by session id` |
| nightwatch-frontend | dev    | `2a51b47` | 0     | 2026-11-16 10:29 `chore(frontend): switch dev server to turbopack`     |

- 评审时间：2026-11-16 10:54–11:42 +08:00。
- dirty 清单：
  - newbie-modules：`M .trae/documents/findings.md`、`?? .trae/documents/reviews/expert-review-2026-11-15-round51-security-evaluation.md`（均非代码）。
  - nightwatch-backend：`M .trae/documents/findings.md`、`M prisma/seeds/permission-groups.ts`、`M prisma/seeds/roles.ts`、`?? .trae/documents/reviews/expert-review-2026-11-16-round52-user-permission-control.md`、`?? solidcore-admin-report-2026-11-13.pdf`。
- 并行会话：backend 的 seeds 改动属 round52 用户权限控制会话。`git diff -- prisma/seeds/*.ts` 只把 Overview 组从 MEMBER 排除项移除，**未触碰 `module/alert-center` 授权**；因此 R53-04（授权面）标记 **provisional**，其余结论不受影响。

## 2. 范围与方法

- `scope: modules: [alert-center]`，聚焦 **Alert source settings 面**：`GET/PUT /alert-sources` + 前端 `/alert-center/settings` 卡片。
- 真源：`newbie-modules/packages/modules/alert-center`（12 个文件，命令 `find packages/modules/alert-center -type f | wc -l`）。
- 装配面：`nightwatch-backend/newbie-modules.json` 命中 alert-center（`sourceCommit d2dcc2e…`）；`diff -rq packages/modules/alert-center src/modules/alert-center` 退出码 0。
- 随之纳入：宿主 `src/application/alerts/alert-source.registrar.ts`（声明侧）、权限 seed（授权面）、前端 settings 页面与卡片、`DateTimePicker`、`RequirePermission`、i18n。
- 方法：单路深读 + 不变量验证（节奏覆盖的作用域、暂停即时性、并发覆盖、权限可达性）+ 模式扫描（`updateSource` 测试命中、`audit` 命中、i18n 键、装配 diff）+ 执行门禁。未启用子代理反驳轮：无 P0/P1，全部结论为 static 级 P2。
- 失败/重跑：无。
- 范围外观察（不计 finding）：`newbie-modules.json` 的 pin `d2dcc2e` ≠ registry HEAD `d628aa0`，但 `git diff d2dcc2e..HEAD -- packages/modules/alert-center` 为空（alert-center 内容一致）。`apply --check` 若按 pin 字符串断言会报伪漂移，属 `repo-pr-fix-module-drift` 场景，不在本轮 settings 面结论内。

## 3. 结论摘要

设置面的读、写、清理、暂停与权限门都能跑通，装配零差异，tsc/eslint/27 单测全绿。问题集中在**设置的作用域与可观测性**：节奏覆盖只在生命周期开局快照一次，对已 firing 的告警永不生效，而界面把它呈现为当前生效值；设置变更没有审计、没有 `updatedAt` 出口；平台级设置在权限模型里由项目成员继承的权限修改，没有独立的平台运维门。

维度评分：

| 维度 | 评分 | 依据 |
| --- | --- | --- |
| 安全 | 待加固 | 全局设置在 MEMBER 可达面内，且无可追溯记录（R53-03/R53-04） |
| 架构 | 待加固 | 覆盖值语义（开局快照 vs 即时生效）未在契约与 UI 中统一（R53-02） |
| 契约 | 需改进 | 未知 key 400、DTO 缺 `updatedAt`、孤儿覆盖行（R53-05/R53-06/R53-03） |
| 测试 | 需改进 | 写路径 `updateSource` 零用例（R53-01） |
| 门禁 | 通过 | 后端 tsc/eslint/27 单测、前端 tsc、装配 diff 全绿 |
| 治理 | 需改进 | 设置面缺少变更人/变更时间/影响面提示（R53-03/R53-09） |

## 4. P0

无。

## 5. P1

无。

## 6. P2（按主题归并）

### R53-01 设置写入路径 `updateSource` 零测试

- 仓：newbie-modules（装配副本 nightwatch-backend）。暴露面：source / live。可达性：维护期。
- 证据：
  - `grep -n "updateSource" src/modules/alert-center/alert-center.service.test.ts` → 0 命中；测试文件只在 mock 对象里声明 `alertSource`（`alert-center.service.test.ts:90`）。
  - 用例分布（命令 `for f in *.test.ts; do grep -c "^test(" $f; done`）：controller 4、service 18、registry 5，共 27；没有一条覆盖 `updateSource` 的 keep / clear / delete-row / 非法值四条分支（`alert-center.service.ts:433-462`）。
- 影响：设置面唯一的写路径没有任何回归门禁；`undefined` 保留、`null` 清除、双空删行这三条语义最容易在后续改动中被破坏。
- 修复方向：4 条用例（只改节奏保留暂停、只清暂停保留节奏、双空删行、非法值为 400），与现有 mock 的 `upsert/deleteMany` 直接对接。

### R53-02 节奏覆盖对已 firing 的生命周期永不生效，与界面语义不符

- 仓：newbie-modules + nightwatch-frontend。暴露面：live。可达性：MEMBER 改设置后，所有已在运行的告警。
- 证据：
  - `raise()` 只在生命周期开局/重开时把当时的来源节奏快照进 `Alert.repeatIntervalMinutes`（`alert-center.service.ts:136-148`、`:194-214`）。
  - 提醒扫描用的是行上的快照值，不读来源当前覆盖（`alert-center.service.ts:298-305`，`:302` 的 `alert.repeatIntervalMinutes`）。
  - `updateSource` 只写 `AlertSource` 行，不回写任何 `Alert`（`alert-center.service.ts:433-462`）。
  - UI 把输入框标为 “Reminder rhythm (minutes)”，默认值与提示只说明继承关系（`alert-source-settings-card.tsx:82-92`；i18n `sourceRepeatLabel/sourceRepeatHint`），没有说明“只对新建/重开的告警生效”。
  - 对照：暂停是即时生效的（扫描前先排除暂停来源，`alert-center.service.ts:267-283`），同一张卡上的两个控件生效时机不一致。
- 影响：运维把某来源改成 5 分钟后，正在 firing 的告警仍按旧节奏提醒，且这些生命周期后续每次提醒都继续用旧值；界面没有解释，容易被判为“设置没生效”。
- 修复方向（二选一，避免过度设计）：(a) `updateSource` 成功后按新节奏重排该来源的 firing 行 `nextNotificationAt`；(b) 保持快照语义，但在设置面文案明确“仅对新建或重开的告警生效”，并说明暂停是即时生效。

### R53-03 设置变更无审计，DTO 也没有 `updatedAt`

- 仓：newbie-modules + nightwatch-backend。暴露面：live。可达性：MEMBER（改设置的人）。
- 证据：
  - `AlertSource` 表有 `updatedAt`（`prisma/schema.prisma:68-69`），但 `AlertSourceDto` 没有该字段（`alert-center.dto.ts:191-216`），`toSourceDto` 也不映射（`alert-center.service.ts:467-484`）。
  - `grep -rn "audit" src/modules/alert-center src/application/alerts --include=*.ts` → 0 命中。
- 影响：平台级暂停/节奏变更既看不到“谁改的”，也看不到“什么时候改的”；出现“提醒突然不来”时无从追溯。
- 修复方向：DTO 增补 `updatedAt`；写路径接入宿主审计（actor + before/after），或在模块内落一条最小变更记录。

### R53-04 平台级设置由项目成员继承的权限修改（provisional）

- 仓：newbie-modules + nightwatch-backend。暴露面：live。可达性：任意 MEMBER。
- 证据：
  - `module/alert-center` 全动作同时授予 Projects 组（`prisma/seeds/permission-groups.ts:104-107`）与 Alert Center 组（`:209-217`）。
  - MEMBER 绑定除 IAM/JDY 外的全部内置组（`prisma/seeds/roles.ts:5-8`）。
  - 设置接口只要求 `List/Update AlertSource`（`alert-center.controller.ts:85-99`），没有项目维度过滤——这是全局配置，按设计。
- 影响：任一项目成员都可以暂停某来源对**所有项目**的外部投递。当前权限模型下这是既有信任模型（R50-02 已按此裁决），但设置面比告警列表的爆炸半径更大，且无审计（R53-03）放大风险。
- 修复方向：若维持现状，至少在设置面写明“对所有项目生效”；若要收口，为设置写入增加独立的平台运维权限原子或 ADMIN 门。
- provisional 说明：seeds 正被 round52 会话改动；当前 diff 只调整 Overview 组，未改 alert-center 授权，故结论在 diff 落定后仍需按新 seeds 复核一次。

### R53-05 未注册来源的覆盖行不清理，重新注册后静默生效

- 仓：newbie-modules。暴露面：source / live。可达性：来源下线再上线时。
- 证据：`listSources` 只映射 registry 中仍注册的来源（`alert-center.service.ts:422-426`）；`AlertSource` 行没有按 registry 清理的路径；`raise()` 读行时只按 key 命中（`:143`）。
- 影响：来源被移除后其暂停/节奏覆盖行仍在库中且设置面不可见；同一 key 重新注册后，旧覆盖与旧暂停窗口会静默套到新告警上，与 README “表里只存真实覆盖”的口径不符（`README.md:8`）。
- 修复方向：启动时按 registry prune 未注册行，或在 `listSources` 暴露 orphan 行以便运维清理。

### R53-06 未知来源 key 返回 400 而非 404

- 仓：newbie-modules。暴露面：source。可达性：调用 `PUT /alert-sources/:key` 的客户端。
- 证据：`require()` 抛 `BadRequestException`（`alert-source-registry.service.ts:90-96`），被 `updateSource` 原样复用（`alert-center.service.ts:434`）；资源不存在属于路径语义，应为 404。
- 影响：API 语义不一致，客户端无法区分“请求体非法”与“资源不存在”。
- 修复方向：`updateSource` 对未知 key 改用 `NotFoundException`；`POST /alerts` 里的 400 保持不变（那里是请求体引用未知来源）。

### R53-07 前端表单陈旧快照 + 无冲突检测

- 仓：nightwatch-frontend。暴露面：live。可达性：两个操作者/两个标签页先后保存同一来源。
- 证据：
  - 行内 `minutes` / `pausedUntil` 只在挂载时取一次 props（`alert-source-settings-card.tsx:23-26`），mutation 成功后只 invalidate、不回填（`:35-38`）。
  - 保存总是同时提交两个字段（`:28-34`），后端 `undefined` 才保留（`alert-center.service.ts:441-446`），因此本页的旧值会覆盖他人的新值。
  - DTO 没有 `updatedAt`/版本号（R53-03），前端也无法做冲突提示。
- 影响：并发编辑静默丢失；`60s` staleTime 内的外部变更在保存时被回滚。
- 修复方向：暴露 `updatedAt` 并做乐观并发校验（不匹配返回 409，前端提示刷新），或至少用 `useEffect` 在服务端值变化时同步未编辑的行。

### R53-08 无效节奏没有错误文案，保存被静默禁用

- 仓：nightwatch-frontend。暴露面：live。可达性：任何输入非正整数/小数的操作者。
- 证据：`invalidMinutes` 只驱动 `aria-invalid` 与按钮 `disabled`（`alert-source-settings-card.tsx:42,57,89`），没有可见的错误文本；`type="number"` 允许小数与科学计数法，用户只能看到按钮变灰。
- 影响：操作者不知道校验规则，也无法区分“未改动”与“输入非法”。
- 修复方向：输入框下方按 `invalidMinutes` 显示错误文案（i18n 两条），或改用受控整数步进。

### R53-09 暂停面缺少状态呈现与影响面提示

- 仓：nightwatch-frontend + newbie-modules。暴露面：live。可达性：MEMBER。
- 证据：
  - 界面只把值塞进日期选择器（`alert-source-settings-card.tsx:24-26,94-103`），不区分“生效中 / 已过期”，也没有一键恢复，需要进 popover 点 Clear（`date-picker.tsx:175-186`）。
  - 文案只说 “Pause delivery until”（i18n `sourcePauseLabel`），未说明暂停同时抑制站内通知记录与外部推送、且对该来源的所有项目生效（`README.md:36` 有说明，UI 没有）。
  - 服务端值被 `format("YYYY-MM-DDTHH:mm")` 截到分钟（`alert-source-settings-card.tsx:25`），再次保存会把秒清零（`:33`），造成最多 59 秒的静默漂移。
- 影响：运维需要额外推断暂停是否仍有效，容易误以为已恢复；跨项目影响面不可见。
- 修复方向：行内显示暂停状态（生效中/已过期 + 到期时间）与“立即恢复”按钮；文案补充影响面；比较/写回时保留秒或明确分钟精度。

### R53-10 页面标题与描述在 PageShell 与卡片重复

- 仓：nightwatch-frontend。暴露面：live。
- 证据：`settings/page.tsx:16-19` 用 `sourceSettingsTitle/sourceSettingsDescription` 作 PageShell 标题与副标题，卡片又用同一组 key 渲染 `CardTitle/CardDescription`（`alert-source-settings-card.tsx:131-135`）。
- 影响：同一段标题与说明连续出现两次，页面层级冗余。
- 修复方向：页面级保留标题/描述，卡片去掉 `CardHeader`（或反之）。

## 7. 误报剔除

1. “暂停只拦外部推送、站内通知照发”——不成立：`deliver()` 在构造通知前就因暂停短路（`alert-center.service.ts:493-502`），README 明确“无站内记录也无外推”。
2. “暂停到期会补发一批错过的提醒”——不成立：开局时 `nextNotificationAt = max(pausedUntil, now) + rhythm`（`alert-center.service.ts:166`、`alert-center.constants.ts:71-74`），到期只有一条迟到提醒。
3. “暂停行会占据扫描页、饿死其他来源”——不成立：扫描先查暂停来源再从 `where` 排除，然后才取 limit（`alert-center.service.ts:267-283`）。
4. “没有清空暂停的入口”——不成立：`DateTimePicker` 的 Clear 会 `onChange("")`（`date-picker.tsx:175-186`），卡片映射为 `null`（`alert-source-settings-card.tsx:33`）。
5. “i18n 键缺失”——不成立：15 个 `alertCenter` 键在 `en.json:611-623` 与 `zh.json:611-623` 均存在。
6. “空 definitions 会让卡片渲染异常”——不成立：注册期归一为空数组（`alert-source-registry.service.ts:66`）+ 前端长度守卫（`alert-source-settings-card.tsx:63`）。
7. “alert-sources 端点缺少权限装饰器”——不成立：GET 要求 List、PUT 要求 Update（`alert-center.controller.ts:85-99`）。
8. “registry 与装配副本漂移”——不成立：`diff -rq` 退出码 0。
9. “小数分钟会落库”——不成立：DTO `@IsInt()`（`alert-center.dto.ts:225-228`）+ service 二次整数校验（`alert-center.service.ts:438-440`）均返回 400。
10. “前端可以提交 NaN”——不成立：`invalidMinutes` 覆盖空串以外的非整数（`alert-source-settings-card.tsx:42`），保存被禁用。

## 8. 已核验通过的不变量

- 单一映射出口：`listSources` 与 `updateSource` 都经 `toSourceDto`（`alert-center.service.ts:422-426,451-461`），definitions 不落库。
- 写语义完整：`undefined` 保留、`null` 清除、双空删行（`alert-center.service.ts:437-454`）；删除是 `deleteMany`，幂等。
- 暂停即时且可自愈：扫描按 `notificationPausedUntil > now` 排除，暂停期间仍记录/解析（`alert-center.service.ts:264-283`；`alert-center.constants.ts:57-64`）。
- 启动期校验完整：重复 source、非法默认节奏、非法 definition 节奏、重复 definition key 四条 fail-fast（`alert-source-registry.service.ts:56-87`），5 条用例覆盖（`alert-source-registry.service.test.ts`）。
- 权限门在：GET List / PUT Update（`alert-center.controller.ts:85-99`）；前端 `/alert-center` 整路由由权限组门控（`src/app/(dashboard)/alert-center/layout.tsx:5-8`），后端仍逐请求授权。
- i18n 齐备：15 个键 en/zh 各有（`en.json:611-623`、`zh.json:611-623`）。
- 装配一致性：`diff -rq` 为零；pin 提交存在，且 alert-center 目录在 `d2dcc2e..HEAD` 无差异。
- 执行门禁（证据：容器 `devbie-work`，源挂载 `/home/worldzhy/src`；被测树 HEAD 见 §1）：后端 `npx tsc --noEmit` 退出 0；`npx eslint src/modules/alert-center` 退出 0；`node --import tsx --test src/modules/alert-center/*.test.ts` 27/27 通过（controller 4 + service 18 + registry 5）；前端 `npx tsc --noEmit` 退出 0。

## 9. 覆盖率清单

审了：alert-center 全部 12 个文件（controller/dto/service/registry/constants/module/manifest/schema/README + 3 个测试）；`GET/PUT /alert-sources` 全链路（装饰器 → service → Prisma → DTO）；前端 settings 页面、卡片、`DateTimePicker` 的清空与时间语义、`RequirePermission` 路由门；权限 seed 的 Projects / Alert Center / MEMBER 绑定；i18n 两语言键；装配 diff 与 pin 提交内容；`updateSource` 测试命中与 audit 命中。

没审：告警列表/详情页渲染；notification-center 模块内部；job-scheduler 实现；DB 存量数据；生产部署事实；`newbie doctor` / `modules apply --check`（未执行，pin 字符串滞后已在 §2 注明）；round52 的在途 seeds 改动全量语义（只核对了与 alert-center 相关的差异）。

## 10. 修复优先级

1. R53-01 先补 `updateSource` 四条用例，作为后续改动的回归门禁（成本最低，收益最先）。
2. R53-02 定语义：节奏覆盖是“即时重排”还是“仅新生命周期生效”；定完同步 UI 文案（与 R53-09 同批改文案）。
3. R53-03 + R53-07 同批：DTO 暴露 `updatedAt`，前端显示并做冲突提示；审计接入可随后。
4. R53-04 需要用户拍板权限口径（维持现状并写明影响面，还是新增平台运维门）；拍板前不要动 seeds。
5. R53-05 / R53-06 / R53-08 / R53-09 / R53-10 作为清理批次。

## 11. 台账

新增 R53-01 … R53-10，见 `.trae/documents/findings.md` round53 段。carry-over：R50-01、R50-02 复验仍 open；R50-03/04/05 复验已 fixed。
