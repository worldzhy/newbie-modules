# Expert Review — 2026-11-06 round20（plan scope：声明侧 defaultSeverity 硬编码）

> 时点快照。scope = `plan: 对话内结论「硬编码可接受、缺陷仅在命名」`。
> 本会话只读，不改代码、不动 backlog/findings。

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 时间（UTC+8） |
|---|---|---|---|---|
| newbie-modules | dev（非 main，合规） | `dabce5a` | dirty 1：`.trae/documents/findings.md`（文档域，不触审域） | 2026-11-06 晚 |
| nightwatch-backend | dev（非 main，合规） | `ae3aa34` | dirty 1：未跟踪 `.trae/documents/expert-review-2026-11-06-R6-13-claim-verification.md`（文档域） | 同上 |
| nightwatch-frontend | dev（非 main，合规） | `f88a394` | dirty 1：`next-env.d.ts`（生成物） | 同上 |

取证 git 客户端：`/Applications/GitHub Desktop.app/Contents/Resources/app/git/bin/git`。

## 2. 范围与方法

- **scope**：plan scope（§0.1）。被审主张来自对话结论，无独立方案文档；主张主要触及 registry 设计，报告落模块真源仓 newbie-modules。
- **主张清单与依赖映射**：

| ID | 主张 | 依赖路径 |
|---|---|---|
| A1 | 声明侧硬编码 `defaultSeverity` 可接受：它只是 bootstrap 建行种子，运行期读 DB | `notification.ts` L13-L42、`notification-setting.service.ts` L49-L66、`notification-center.service.ts` L173-L183 |
| A2 | 真正缺陷仅是声明侧与 DB 字段同名的命名问题 | 同上 + `prisma/schema.prisma` L10-L15 |

- **取证命令**（均在 `newbie-modules/packages/modules/notification-center` 或 `nightwatch-backend` 根执行）：

```
grep -rn "declared.defaultSeverity\|declaration.defaultSeverity" .
grep -rn "getAll()" .
grep -rn "setting.defaultSeverity\|row.defaultSeverity\|updated.defaultSeverity" .
grep -rn "protected readonly defaultSeverity = " src/application/notifications | wc -l
grep -rhn "protected readonly defaultSeverity = " src/application/notifications | sed 's/.*= //' | sort | uniq -c
```

- **并行路数**：1 个独立反驳代理（Explore，无主会话上下文，只接收主张文本 + 依赖路径）。主会话读码裁决。
- **失败/重跑**：无。

## 3. 主张判定表

| ID | 判定 | 依据 |
|---|---|---|
| A1 | **成立（有条件）** | 每个通知的严重级属于声明语义，必须有代码侧默认；替代方案均更差：①模块级 env/`newbie.module.json` 是所有通知共享一份配置，无法区分 critical/medium；②DB 列默认值会抹平每通知差异。因此"硬编码作为初始值"在机制上成立。 |
| A1 的"运行期读 DB"子断言 | **成立** | `notification-center.service.ts` L178 `input.severity ?? setting.defaultSeverity`；声明值在运行期无读取点（见 §6 不变量）。 |
| A2 | **不成立** | 根因不是命名，而是**声明值在建行后失去权威性**：声明侧唯一读取点是 L62 的建行分支；行已存在时 `continue`（L52-L54），代码值永不重读、永不更新。改名 `initialSeverity` 只是把症状写清楚，不消除"代码与运行期静默分叉"这一事实。 |

**裁决**：上一轮回复的 "硬编码本身不算错，问题只在命名" 应修正为——**硬编码作为机制成立；但把它称为"没有问题"不成立，且把根因归为命名不成立**。正确表述：当前设计同时扮演"声明语义"与"运行期可编辑策略"两个角色，代码值只在全新库的第一个启动周期有效。

## 4. 反驳轮与裁决

- 独立代理只返回依赖路径的代码摘录，未发现任何建行之外的 `declared.defaultSeverity` 读取路径 → A1 的前提（代码值仅作种子）未被击穿。
- 主会话对 A2 的裁决依据：`grep` 结果中 `declared.defaultSeverity` 仅 1 处消费（`notification-setting.service.ts:62`），且位于 `if (existing) continue` 之前的建行分支；运行期读取全部落在 DB 行（`notification-center.service.ts:178`、`notification-setting.service.ts:82/119`）。A2 判定不成立。

## 5. 方案外 findings

| ID | 级别 | 暴露面 | 可达性 | 标题与证据 |
|---|---|---|---|---|
| R20-01 | P2 | live | 维护者/运维 | **声明值失效导致代码与运行期静默分叉**。声明 `defaultSeverity` 只在建行时生效（`notification-setting.service.ts:62`），存量行永不更新（L52-L54）；改代码不改变既有部署行为，读声明无法得知实际投递级别。影响：正确性/可维护性，非安全。修复方向见 §8。 |
| R20-02 | P2 | docs | — | **registry README 与运行期行为矛盾**。README L10 称 "In-app recording is the base layer and is always on; every notification below the severity floor is persisted regardless of push delivery"，但 `notification-center.service.ts` L181-L184 在写库前直接丢弃低于 floor 的投递；前端 `minSeverityHint` 也写 "Notifications below this severity are dropped"。文档与代码二选一必错，属契约一致性缺陷。 |
| R20-03 | 观察（待确认） | live | 运维 | 17 个硬编码声明中 6 个为 `medium`（`grep` 计数：critical 2 / high 9 / medium 6），低于中心默认 `minimumSeverity = high`（`notification-center.constants.ts` L15）。默认配置下这 6 条通知不会落任何记录。若为有意的降噪策略则不构成缺陷；若期望"中等级别照常入库、仅关推送"，则与 R20-02 同源，需产品拍板。 |

## 6. 已核验通过的不变量

| 不变量 | 取证 | 置信级 |
|---|---|---|
| 声明侧 `defaultSeverity` 只有建行一个消费点 | 命令 `grep -rn "declared.defaultSeverity\|declaration.defaultSeverity" .` → 1 处消费（`notification-setting.service.ts:62`）+ 2 处校验（registry L63/L65） | executed |
| 运行期 severity 来自 DB 行 | `grep ... setting.defaultSeverity\|row.defaultSeverity\|updated.defaultSeverity` → `notification-center.service.ts:178` 等 3 处 | executed |
| 存量行不被声明覆盖 | `notification-setting.service.ts` L52-L54 `if (existing) continue` | static |
| 声明值均为合法 severity | registry L63-L67 校验 + 17 条声明值分布（critical 2 / high 9 / medium 6） | executed |

## 7. 覆盖率清单

| 审了 | 没审 |
|---|---|
| 声明基类、registry、settings reconcile、notify 的 severity 读取路径 | `defaultPushEnabled` 的同类问题（用户未点名，仅在第 2 问讨论） |
| 17 条宿主声明的硬编码值与分布 | 设置页 UI 交互细节 |
| schema 注释与 README 的契约一致性 | 推送链路、`NotificationRecord` 查询侧 |
| E2E/测试是否覆盖"改声明值后存量行为不变" | 未运行测试（结论不依赖测试红绿） |

## 8. 修复方向

**方案 A（推荐，声明为真源 + DB 只存显式 override）**

- 声明侧：`defaultSeverity` → required `severity`（这是通知的内在属性，代码是唯一真源）。
- DB 侧：`NotificationSetting.defaultSeverity` → `severityOverride String?`（null = 跟随声明，非 null = 运维显式覆盖）。
- 解析顺序：`input.severity ?? row.severityOverride ?? declared.severity`。
- 设置页展示"生效值 + 跟随声明/显式覆盖"状态；运维仍可覆盖，但代码值不会被复制成一份会过期的快照。
- 系统未上线（判据见 user_profile「系统上线状态」），直接 `db push` 对齐，无迁移成本。
- 同源问题（`defaultPushEnabled` / `isPushEnabled`）按同一模型处理：声明 `pushEnabled`（默认 true）+ DB `pushEnabledOverride Boolean?`。

**方案 B（保留种子语义，最小改动）**

- 声明侧改名 `initialSeverity`、`initialPushEnabled`，文档明确"仅用于建行，存量由运维接管"。
- 能消除误导，但保留静默分叉；仅在确定"运维完全接管 severity"是产品契约时采用。

## 9. 台账指针

- 本报告：`newbie-modules/.trae/documents/expert-review-2026-11-06-round20.md`
- 未追加 `findings.md`：该文件当前有并行在途改动（`M .trae/documents/findings.md`），为避免覆盖，R20-01/02 由修复会话或用户登记。
- 相关前序：`expert-review-2026-11-06-round19.md`（ADR-051 alert lifecycle）。
