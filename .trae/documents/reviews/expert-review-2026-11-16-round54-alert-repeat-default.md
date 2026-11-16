# 专家评审 round54 — alert-center 提醒默认语义（plan scope）

## 1. 锚点

| 仓                  | branch | HEAD      | dirty | 说明 |
| ------------------- | ------ | --------- | ----- | ---- |
| newbie-modules      | dev    | `d628aa0` | 3     | 均为 `.trae/documents` 下的报告/台账 |
| nightwatch-backend  | dev    | `c0cadae` | 5     | seeds 2 个为 round52 并行会话在途；`git diff 5cf9ab3..HEAD -- src/modules/alert-center src/application/alerts src/application/scheduled-jobs/tasks` 为空 |
| nightwatch-frontend | dev    | `2a51b47` | 8     | `alert-center/page.tsx`、`i18n/messages/{en,zh}.json` 等为并行会话在途 |

- 评审时间：2026-11-16 12:11–12:30 +08:00。
- 装配：`diff -rq packages/modules/alert-center src/modules/alert-center` 退出码 0。
- 并行会话：frontend 的 `alert-center/page.tsx` 与 i18n 在途；本轮涉及前端文案的结论标 **provisional**。alert-center 模块与宿主 alerts 目录自 round53 锚点以来无变化，round53 的执行门禁结论（后端 tsc/eslint/27 单测、前端 tsc 全绿）继续适用于被测树。

## 2. 范围与方法

`scope: plan`，方案为两条决定：

- **C1**：首条 firing 消息在 `raise()` 时立即投递；首条之后默认不 repeat。
- **C2**：暂时只做来源级设置。

主张拆解与依赖路径：

| 主张 | 依赖路径 |
| --- | --- |
| C1 前半（首条立即投递） | `alert-center.service.ts:184-186`、`:194-214`、`:493-525` |
| C1 后半（默认不 repeat） | `alert-center.constants.ts:16-17`、`alert-source-registry.service.ts:60-63`、`prisma/schema.prisma:33-34`、`application/alerts/alert-source.registrar.ts:84`、`README.md:28-38`、`ADR-065:59,111-114,135-141` |
| C2（只做来源级设置） | `prisma/schema.prisma:59-71`、`README.md:42-44`、`ADR-065:91-92` |

方法：读码定位每个主张的现状实现，逐条判定；对 C1 后半与 C2 做影响面推演（契约、宿主注册、存量数据、前端、测试）。无 P0/P1，未启用独立反驳代理（全部为 static 级结论）。

## 3. 结论摘要

- C1 前半**成立**，但“立即投递”有三条前提：来源未暂停、宿主绑定了通知端口、适配器调用成功。适配器异常只记日志，不会回滚告警（`alert-center.service.ts:522-525`）。
- C1 后半**作为现状不成立**：模块缺省 60 分钟、宿主 Threat Intel 显式 1440 分钟，另外三个来源都继承 60。作为**目标语义**可以实施，但当前契约与代码都无法表达“不 repeat”，且有一个未定义交互（暂停 × 无重复）会导致首条永久丢失。
- C2 **成立且与现有架构一致**：来源级两列已经承载全部来源级状态，不需要 schema 变更；但“来源级设置”不能包含 `enabled`，否则与 ADR-065 §2 的既有裁决冲突（`ADR-065:92`）。

## 4. 主张判定表

| 主张 | 判定 | 依据 |
| --- | --- | --- |
| C1-a 首条 firing 在 `raise()` 时立即投递 | **成立（有条件）** | 新建与重开都在落库后同步调用 `deliver(row, 0, …)`（`alert-center.service.ts:184-186`、`:213`）；暂停时 `deliver` 直接返回（`:500-502`），未绑定端口时只 warn（`:503-506`），适配器异常被吞（`:522-525`） |
| C1-b 首条之后默认不 repeat | **不成立（现状）**；作为目标**需补契约** | 模块缺省 `DEFAULT_REPEAT_MINUTES = 60`（`alert-center.constants.ts:16-17`），注册缺省回落 60（`alert-source-registry.service.ts:60`），`Alert.repeatIntervalMinutes` 非空且默认 60（`prisma/schema.prisma:33-34`），宿主 Threat Intel 显式 1440（`alert-source.registrar.ts:84`） |
| C2 暂时只做来源级设置 | **成立** | 来源级状态只有 `repeatMinutes` 与 `notificationPausedUntil` 两列（`prisma/schema.prisma:59-71`），不需要 `scopeId` 或实例列；“来源级设置”与现有端点形状一致（`README.md:42-44`） |

### C1-b 的现状口径（命令取证）

`grep -rn "defaultRepeatMinutes|repeatIntervalMinutes" src/`（nightwatch-backend）命中宿主侧三处实现：

| 来源 | 节奏来源 | 当前行为 |
| --- | --- | --- |
| Backend Monitor | 未设置 → 模块缺省 | 每 60 分钟提醒 |
| Job Scheduler | 未设置 → 模块缺省 | 每 60 分钟提醒 |
| Security Evaluation `run-failure` | 未设置 → 模块缺省 | 每 60 分钟提醒 |
| Security Evaluation `risk-spike` | definition 固定 `RISK_SPIKE_REPEAT_MINUTES` | 固定节奏，来源覆盖无效 |
| Threat Intel | `defaultRepeatMinutes: 24 * 60` | 每 24 小时提醒 |

因此“默认不 repeat”落地后，**前三个来源会从‘每小时提醒’变成‘只提醒一次’**。这是变更的主要爆炸半径，不是实现细节。

### 实施 C1-b 需要同步的契约点

1. 注册表默认必须变成三态：缺省 = 仅首条、正整数 = 重复（`alert-source-registry.service.ts:60-63`；`alert-source-registry.service.test.ts:17-18` 现有 `0`/`1.5` 校验需扩展到“缺省合法”）。
2. `Alert.repeatIntervalMinutes` 需可空（或去掉 60 默认）；无重复时 `nextNotificationAt` 必须为 null，扫描自然跳过（`alert-center.service.ts:264-305`）。
3. `resolveRepeatMinutes` 与 `raise()` 的返回/参数需允许 `null`；`AlertSourceDto.defaultRepeatMinutes` 由必填 number 改为 nullable（`alert-center.dto.ts:199`），`effectiveRepeatMinutes` 的展示语义随之变化（`alert-center.service.ts:481`）。
4. 前端三态文案：继承（=不提醒）/ 覆盖 N 分钟 / 暂停；`definitionInheritRhythm` 当前文案表达的是“继承默认节奏”，需要改成“继承（仅首条）”等明确表述（frontend i18n 在途，结论 provisional）。
5. 文档与 ADR：`README` 状态机“提醒到点”行、§“Reminder rhythm replaces silences”、`ADR-065:59,111-114,135-141` 都要改；这属于跨宿主契约语义变更，按设计前置规则应先出 ADR（可 supersede 或修订 ADR-065 对应节）。
6. 测试：现有 27 例中，缺省 60 的夹具（`alert-center.service.test.ts:415`）、dispatch 3 例、暂停 2 例、重开断言都要按新语义重写，并新增“无重复时 `nextNotificationAt=null`、dispatch 不取行”的行为用例。

## 5. 方案外新发现（P2）

| ID | 标题 | 证据 | 影响 |
| --- | --- | --- | --- |
| R54-01 | **暂停 × 无重复：首条会被永久丢弃** | `deliver` 在暂停时直接返回（`alert-center.service.ts:500-502`）；当前靠 `nextNotificationAt` 在暂停到期后补一条迟到提醒（`alert-center.constants.ts:66-74`、`README.md:36`）。若默认无 repeat，则 `nextNotificationAt` 为 null，暂停期间 raise 的告警**既没有首条也没有补发** | C1-b 的必要补充：必须三选一——(a) 暂停只作用于提醒，首条始终投递；(b) 暂停推迟首条到到期时刻（需要 pending 标记）；(c) 明确接受丢弃并写入契约。选 (a) 会让“暂停”不再能阻止深夜首条，选 (b) 需要新状态 |
| R54-02 | 存量 firing 行不会跟随新默认 | `Alert.repeatIntervalMinutes` 是开局快照（`alert-center.service.ts:165,209`），dispatch 读行值（`:302`） | 已上线系统：切换默认后，存量 firing 行仍按旧快照提醒，新默认只影响新告警。需定义是否一次性收敛（把未显式配置的行 `nextNotificationAt` 置 null） |
| R54-03 | 注册表无法表达“缺省 = 不提醒” | `defaultRepeatMinutes?: number` 缺省即落 60（`alert-source-registry.service.ts:27,60`）；`AlertSourceDto.defaultRepeatMinutes!: number`（`alert-center.dto.ts:199`） | 实施阻塞点：null/缺省语义不先定，C1-b 无从表达 |
| R54-04 | ADR-065 宣称的“一天后再提醒”没有任何载体 | `ADR-065:135-141` 把三种静默意图映射到 `repeatIntervalMinutes` 与移动 `nextNotificationAt`；端点只有 `POST /alerts`、`POST /alerts/resolve`、GET 与 `GET/PUT /alert-sources`（`README.md:42-44`），没有任何调整 `nextNotificationAt` 的入口 | C2 只做来源级设置后，实例级“延后一次”彻底无载体；要么从 ADR 移除该意图，要么保留为后续项并在文档标注未交付 |
| R54-05 | 若“来源级设置”包含 `enabled`，与 ADR-065 冲突 | `ADR-065:92` 明确“`AlertSource` 不设 `enabled`，拒收 raise 会让 resolve 找不到行” | 需先确认 C2 的范围是否含启用/停用；若含，必须新 ADR 推翻该裁决 |
| R54-06 | C1-b 属契约变更但方案未提 ADR | 变更同时触及 registry 默认、宿主 registrar、DTO、前端文案与 ADR-065 语义 | 按设计前置规则，跨宿主契约语义变更应先出 ADR 再改码 |

## 6. 误报剔除

1. “适配器异常会打断 `raise()`、丢告警”——不成立：异常被捕获并记日志，告警已落库（`alert-center.service.ts:507-525`）。
2. “暂停会丢告警记录或影响 resolve”——不成立：暂停只拦投递，记录与解决照常（`README.md:36`、`alert-center.constants.ts:57-64`）。
3. “重复上报会重置提醒节奏”——不成立：firing 分支只推进 `lastSeenAt`/`occurrences`（`alert-center.service.ts:217-225`）。
4. “无 `nextNotificationAt` 的扫描会报错或空转占页”——不成立：扫描按到期时间取行并有上限（`alert-center.service.ts:264-283`）。
5. “只做来源级设置需要加 `scopeId` 或改 schema”——不成立：现有两列已覆盖来源级状态（`prisma/schema.prisma:59-71`）。

## 7. 已核验不变量

- 首条投递与生命周期开局在同一次调用内完成，失败不回滚告警。
- `fingerprint` 唯一索引是并发仲裁点，first-report 竞争不会产生双行（`alert-center.service.ts:154-181`）。
- 提醒扫描幂等：先条件更新 claim 再投递，适配器失败归还提醒（`:264-305`；单测 :354-366）。
- 暂停先于投递判定，且不会饿死未暂停来源（`:267-283`；单测 :252-293）。
- 装配一致：`diff -rq` 退出码 0；alert-center 相关宿主目录自 round53 锚点无改动（`git diff --stat 5cf9ab3..HEAD -- src/modules/alert-center src/application/alerts src/application/scheduled-jobs/tasks` 为空）。
- 执行门禁沿用 round53 证据（同一被测树）：后端 tsc/eslint/27 单测、前端 tsc 全绿。

## 8. 覆盖率清单

审了：C1/C2 的每处现状实现（raise/deliver/dispatch/resolve、registry 默认、schema 默认、DTO、README 状态机与节奏节、ADR-065 节奏与 `enabled` 裁决、宿主 registrar 全部来源、前端文案依赖点）；存量数据行为；端点清单与实例级动作缺口。

没审：告警列表页与详情页渲染（frontend 在途）、notification-center 规则实现、job-scheduler 内部、生产库真实存量行、`newbie doctor` / `modules apply --check`。前端文案与 page.tsx 相关结论因并行改动标 provisional。

## 9. 实施顺序（先决策后改码）

1. 先定 R54-01：暂停与首条的关系（三选一），它决定 schema 是否需要 pending 状态。
2. 定 R54-02：存量 firing 行是否一次性收敛。
3. 定 C2 边界（R54-05）：来源级设置是否含 `enabled`；含则先写 ADR 推翻 ADR-065 §2。
4. 出 ADR（R54-06）并同步 README / ADR-065 节奏节。
5. 改模块：registry 三态、schema nullable、DTO、dispatch、测试。
6. 改宿主：逐来源决定 Backend Monitor / Job Scheduler / Security Evaluation `run-failure` 是否显式保留 60；Threat Intel 保持 1440。
7. 改前端：三态文案与设置面状态呈现（与 round53 R53-09 同批）。

## 10. 台账

新增 R54-01 … R54-06，见 `.trae/documents/findings.md` round54 段。
