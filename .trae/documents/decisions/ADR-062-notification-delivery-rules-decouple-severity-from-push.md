# ADR-062: 投递规则是唯一配置实体，severity 降级为匹配标签

状态：已采纳
日期：2026-11-13

取代：ADR-060（severity floor 门控推送）、ADR-061（恢复投递与 severity 解耦）

## 背景

ADR-060 把 `minimumSeverity` 确立为"推送噪声旋钮"，ADR-061 又为恢复通知补了 `recoveryOf` 与"按 firing 级别判定 floor"两条特例。两轮修补后，`notification-center` 的推送路径变成五道串行门禁（floor → per-key 开关 → 中心开关 → scope → pushPort），并留下三个结构性问题：

1. **severity 一词双职责**。它同时表示"告警影响面"和"打扰预算"。想把某类通知推进聊天通道，唯一手段是提高它的 severity——这是反向激励，也是 `url-check.recovered` 曾经显式传 `high` 的真实原因。
2. **`recoveryOf` 是为配对而生的方言**。恢复本身没有级别，只能靠一个指向 firing key 的字段让 floor 有东西可判；未注册时还要 warn + 回退。
3. **不可解释**。五道 if 短路后只返回一个 `pushSuppressed` 布尔：既不说命中哪条规则，也不说被哪道门拦下。宿主还要自己读这个布尔再决定项目级是否推送，等于把判定逻辑复制了两份。

业界（Alertmanager 的 route、Sentry 的 alert rule、Grafana 的 alert rule）都把 severity 当标签，把投递决策当独立策略对象。本 ADR 采用同一模型，并按本模块规模裁剪到最小形态。

## 候选方案

- A. 继续修补现状：给 `minimumSeverity` 改名、把 `pushSuppressed` 换名。改动小，但 severity 双职责、`recoveryOf` 特例、不可解释三条一条都没解决。
- B. 引入 `DeliveryPolicy` 容器 + `DeliveryRule` 两层：接近 Alertmanager 的 route 树，但当前只有一个中心配置与三层作用域，容器只提供 fallback、scope 归属与整块版本号三件可内化的事，属于为假设需求预留抽象。
- C. 单层规则表 + 告警实例：配置面只有一个实体 `NotificationDeliveryRule`；投递决策分"可固化的规则裁决"与"每次实时求值的运行时判定"两段。

## 决策

采用 C。

### 1. 三个概念，配置面只有一个实体

| 概念 | 性质 | 说明 |
| --- | --- | --- |
| `NotificationDeclaration` | 代码注册 | key、模板、默认 severity、`notifyOnRecovery`；不是数据库实体 |
| `NotificationAlert` | 运行时状态 | 一条告警的生命周期，持有规则裁决 |
| `NotificationDeliveryRule` | 配置 | 唯一的配置实体，有序规则表 |

不设 `Policy` 容器：容器的职责（fallback、作用域归属、整块版本）分别由硬编码默认、`condition` 条件维度、行级编辑承担。不设 `groupId` 预留字段——需要规则集复用时再加列，成本远低于长期维护一个无当期依据的抽象。

### 2. `NotificationDeliveryRule`

```prisma
model NotificationDeliveryRule {
  id        String   @id @default(uuid()) @db.Uuid
  priority  Int      @unique          // 升序求值，小的先命中
  condition Json                      // DeliveryCondition
  action    String   @db.VarChar(10)  // deliver | suppress
  isEnabled Boolean  @default(true)
  updatedAt DateTime @updatedAt
}
```

- 字段名用 `action` 而不是 `then`、用 `condition` 而不是 `when`：两个连接词离开彼此都无法自解释；`condition` / `action` 是两个名词，各自独立成立。
- 不设 `scope` / `scopeId` 列。"某项目""某 key"只是 `condition` 的匹配维度，不是归属。
- 不设 `fallback` 字段。所有规则都不命中时硬编码为 `suppress`——安全默认不需要一条数据来表达。

### 3. 条件语义

```ts
type DeliveryCondition = {
  phase?: "firing" | "recovered";   // 枚举，单值
  severityAtLeast?: Severity;       // 阈值，单值
  notificationKeys?: string[];      // 集合
  projectIds?: string[];            // 集合
  tags?: Record<string, string>;    // 映射
};
```

单值只用于枚举与阈值，集合只用于多选匹配。集合字段的空值语义固定：

| 取值 | 语义 |
| --- | --- |
| 字段缺省 | 该条件不参与过滤，命中所有 |
| `[]` | 永不命中（任何值都不属于空集），等价于禁用该条件 |
| 非空数组 | 命中其中任一 |

空数组取"永不命中"而不是"不限"，与既有 `visibleProjectIds: []` 的约定一致：清空选择只能收窄、不能放大范围。UI 不应让用户手动产生 `[]`——多选框清空时删除该条件或阻止保存。

### 4. 两段式判定

**固化段（一个告警周期只算一次）**：

```text
ruleVerdict = first enabled rule (order by priority asc) whose condition matches(labels) ?? SUPPRESS
```

结果写入 `NotificationAlert`（`verdictRuleId`、`verdictAction`、`verdictAt`）。恢复事件复用同一裁决——"firing 与 recovered 同进同退"由数据模型保证，不再需要 `recoveryOf` 配对、级别继承或未注册回退。

**实时段（每次投递求值）**：

```text
runtimeReason =
  subscription-off     per-key 开关关闭
  recovery-opt-out     恢复事件且声明的 notifyOnRecovery=false
  channel-off          中心通道关闭
  silenced             处于静默窗口（P3）
  inhibited            被其他活动告警抑制（P3）
  no-port              通道无 pushPort
```

最终投递 = `verdictAction === "deliver" && runtimeReason === null`。`notifyOnRecovery` 声明在 firing 上，恢复读同一份声明。

分段的理由：策略是配置，可以在事件发生时定案；开关、静默、通道是环境，必须实时读。二者混成一个布尔正是 `pushSuppressed` 不可解释的根源。

### 5. 生命周期

| 转换 | 动作 |
| --- | --- |
| firing → firing | 只更新 `lastSeenAt`；同 `deduplicationKey` 的记录合并 |
| firing → resolved | `state=resolved`、`resolvedAt=now`；记录一条 recovered；跑实时段后投递 |
| resolved → firing | `state=firing`、`resolvedAt=null`、**清空裁决并重算**（新周期） |

### 6. 可解释性

每次投递写一条 `NotificationDeliveryAttempt`：`decision`、`reason`、`ruleId`、`recordId`。规则裁决定案时也落一条。宿主不再自行判断，改为读 `decision`：

```ts
// 现在
if (result.pushSuppressed) return;

// 之后
if (result.decision !== "delivered") return;
```

### 7. 交互

- 有序规则表 + 拖拽排序，不向用户暴露 `priority` 数字。
- 条件渐进披露：默认只显示级别，其他条件收进"添加条件"。
- `suppress` 规则归入"例外"分区，主流程只写 deliver 规则。
- **模拟器为必需项**：选中一条最近通知，跑同一求值函数，显示命中第几条规则。这是有序规则模型唯一可靠的纠错手段。
- seed 两条默认规则，使默认用户零操作：`{ priority: 10, condition: { severityAtLeast: "high" }, action: "deliver" }` 与 `{ priority: 20, condition: { phase: "recovered" }, action: "deliver" }`。第二条保留"恢复必达"这一既有可用行为（旧实现靠 `recoveryOf` 继承 firing 级别实现），否则升级后所有恢复推送会被静默。最后一条规则不允许删除，因此"空表"只存在于首次 seed 之前。

## 跨宿主 / 演进检验（registry 模块设计必填）

- 无宿主或厂商词：规则表、条件、动作、裁决均为领域通用概念；`NotificationPushPort`、`NotificationVisibilityPort` 契约不变。
- 对所有消费方一致：低于规则阈值的 firing 只落站内，其恢复同样只落站内；规则改为 `deliver` 时两者一起推送。行为由规则表统一决定，不再存在"某类声明靠提级别绕过阈值"。
- 演进路径已明确：规则集复用加 `groupId` 列；静默与抑制只改实时段；多通道只扩 `action` 的通道维度。三者都不需要推翻本 ADR。

## 影响

- registry `notification-center`：
  - schema 新增 `NotificationDeliveryRule`、`NotificationAlert`、`NotificationDeliveryAttempt`；`NotificationRecord` 增加 `alertId`。
  - `notify()` 拆为规则裁决与实时判定两段；`NotifyResult` 由 `pushSuppressed: boolean` 改为 `decision` + `reason`。
  - 删除 `recoveryOf`、`NotificationCenterSetting.minimumSeverity`、`pushPolicy`、`pushSuppressed`。
  - README、测试同步改写。
- 宿主（nightwatch-backend）：
  - `project-notification-push.service.ts` 改读 `decision`。
  - 声明类去掉 `recoveryOf`，恢复的推送与否交给规则表。
  - `prisma/models/notification-center.prisma` 随 registry 渲染更新。
- 前端（nightwatch-frontend）：
  - `notification-settings-card.tsx` 由"开关 + 级别下拉"改为规则表 + 模拟器。
  - 通知列表增加投递原因的可展开说明。

迁移分阶段，每阶段可独立交付：

| 阶段 | 内容 | 行为变化 |
| --- | --- | --- |
| P0 | 三张新表 + 裁决计算（等价现状 floor）+ 双写 | 无 |
| P1 | 宿主读 `decision`；`DeliveryAttempt` 落库 | 无 |
| P2 | 删除 §影响 中的旧字段；规则编辑 UI + 模拟器 | 有（配置面变化） |
| P3 | 静默 / 抑制的实时求值 | 有（新增能力） |

## 术语退场

| 旧术语 | 去向 |
| --- | --- |
| floor / `minimumSeverity` | 一条 `severityAtLeast` 规则 |
| `pushPolicy` | 规则表的平凡形态 |
| `recoveryOf` | 删除，靠 Alert 实例配对 |
| `pushSuppressed` | `decision` + `reason` |
| `evaluatedSeverity` / `alertSeverity` / `floorSeverity` | 不再需要中间变量名，比较写在规则匹配里 |

## 非目标

- 不做 Alertmanager 式 route 树：作用域由 `condition` 维度表达，不建层级容器。
- 不做规则集复用、整体版本发布：出现真实需求时加一列，不预先建模。
- v1 不做多通道（邮件 / 短信）与分组聚合。
- 不追溯回填历史 `NotificationRecord`，历史行按现状展示。

## 后果

正面：恢复跟随告警由模型保证；新增策略不改判定链；每次投递可解释；配置面从一个枚举字段收敛为一张表，语义单一。

负面：规则数随场景组合线性增长，"某项目特殊处理"需要复制一行规则；有序规则对顺序敏感，必须靠模拟器兜错；`condition` 为 JSON 列，写入需校验、读取需宽容解析。
