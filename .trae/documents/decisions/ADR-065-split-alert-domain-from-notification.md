# ADR-065: 告警域独立成模块，拥有自己的数据表

状态：已采纳
日期：2026-11-14
取代：ADR-062 §4/§5（每次投递开告警实例、裁决冻结在告警上）、ADR-064（通知侧的 fingerprint 配对键）、ADR-063 的静默机制（`NotificationSilence` 与 `silenced` 原因）
保留：ADR-051 的生命周期术语，但统一为 `firing | resolved`（`recovered` 降为文案与 template key 后缀，不作枚举值）；ADR-062 §1-§3、§6 的规则表与可解释性设计；ADR-063 的投递原因落库（`NotificationDeliveryAttempt`）

## 背景

告警现在住在通知的 schema 里（`packages/modules/notification-center/prisma/schema.prisma` 的 `NotificationAlert`），并且由 `notify()` 创建。这带来三个结构性后果：

1. **因果颠倒**：告警的存在由通知调用次数决定，而不是由状态变化决定。`notify()` 第 268 行无条件 `upsertAlert`。
2. **数据污染**：宿主 13 处 `notify()` 调用点里只有 4 处（url-check、heartbeat 的 firing/resolved）真在做生命周期，其余 9 处是纯事件（digest、weekly report、task-status、job-failure、error spike 等），每次投递留下一行永远停在 `firing` 的告警，占用唯一索引与 `@@index([state, lastSeenAt])`。
3. **演进被锁死**：TTL、自动 resolved、抑制、分组都必须先排除这 9 类僵尸行，所以这些能力一件也落不了地。

取证：`NotificationAlert` 只被模块自身的 service 读写；宿主 9 处事件生产者、其他 registry 模块、前端都没有引用它。搬表没有外部读面。

## 设计原则

1. 告警的产生不依赖通知。
2. 告警是通知的调用方。
3. 通知是通用通道，支持告警类、系统事件类等多种消息。
4. 每个域拥有自己的表；跨域只传 id 与最小契约，不建数据库外键。
5. 模块之间用端口解耦，由宿主装配时绑定。

## 决策

### 1. 模块划分

| 模块 | 职责 | 数据表 |
| --- | --- | --- |
| `alert-center`（新建） | 告警身份、状态机、提醒节奏、来源暂停、生命周期查询 | `Alert`、`AlertSource`（自己 schema） |
| `notification-center`（收缩） | 声明注册、模板渲染、投递规则、推送、未读 | 通知相关表，不再含告警表与静默表 |

`newbie.module.json`（草案）：

```json
{
  "key": "alert-center",
  "layer": "capability",
  "wiring": { "file": "alert-center.module", "className": "AlertCenterModule", "prismaSchema": "prisma/schema.prisma" }
}
```

两个模块之间**不声明 `requires.modules`**：告警域不 import 通知域，通过端口由宿主绑定（与 `NOTIFICATION_PUSH_PORT` 同一模式）。

### 2. 告警域数据模型

```prisma
model Alert {
  id                    String    @id @default(uuid()) @db.Uuid
  fingerprint           String    @unique @db.VarChar(255) // scopeId + source + alertKey，超长截断 + sha256
  source                String    @db.VarChar(100)         // 生产者标识，如 url-check / heartbeat / cloudwatch
  scopeId               String?   @db.VarChar(100)         // 作用域（项目 / 租户 / 平台），对模块不透明
  severity              String    @db.VarChar(20)          // 告警影响面，生命周期内稳定
  labels                Json                               // 可匹配维度（路由、筛选）
  data                  Json?                              // 消息渲染上下文，模块不解释
  state                 String    @db.VarChar(20)          // firing | resolved
  repeatIntervalMinutes Int       @default(60)             // 未恢复期间的提醒间隔
  nextNotificationAt    DateTime?                          // 下一次该外发提醒的时刻；resolved 后为 null
  lastNotificationAt    DateTime?                          // 上一次实际外发提醒的时刻
  firstSeenAt           DateTime  @default(now())
  lastSeenAt            DateTime  @updatedAt
  resolvedAt            DateTime?
  occurrences           Int       @default(1)
  createdAt             DateTime  @default(now())

  @@index([state, nextNotificationAt])
  @@index([scopeId, source])
}

model AlertSource {
  key                  String    @id @db.VarChar(100) // frontend-threshold / backend-error-spike / health / url-check / cloudwatch
  displayName          String    @db.VarChar(200)
  defaultRepeatMinutes Int       @default(60)        // 新告警继承的提醒间隔
  notifyPausedUntil    DateTime?                     // 暂停外发到这个时刻，到期自动失效
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
}
```

要点：

- **没有 verdict 列**。投递策略属于通知域，不写进告警表。
- **severity 在告警上稳定**。firing 与 resolved 用同一个 severity，通知规则按 severity 匹配时两侧自然一致，不需要冻结裁决。
- `labels` 与 `data` 分工：`labels` 供匹配与筛选（可索引、可枚举），`data` 是给消息渲染用的不透明上下文（URL、错误文本、恢复时间等）。
- `source` 是一等身份，不是自由文本备注：它决定提醒间隔的默认值、暂停开关的作用范围，也是通知侧 `(source, state) → notificationKey` 映射的左键。
- `AlertSource` 由 `raise` 惰性 upsert（只写 `key` 与默认值），不需要宿主预注册；`displayName`、`defaultRepeatMinutes`、`notifyPausedUntil` 由用户或宿主后续编辑。未声明的来源自动出现在设置面上，代价是首次噪声，收益是零配置即可接入。
- `AlertSource` **不设 `enabled`**。暂停只停外发不停记录；若拒收 `raise`，后续 `resolve` 将找不到行，状态机会出现无法闭合的窗口。
- 无跨域外键；通知侧要溯源时只存 `(sourceType="alert", sourceRef=<Alert.id>)` 字符串。

### 3. 告警域接口

```text
raise({ source, alertKey, scopeId?, severity, labels?, data?, repeatIntervalMinutes? })
                                                                 -> { id, state, isNew }
resolve({ source, alertKey, scopeId?, resolvedAt? })             -> { id } | null
list({ state?, source?, scopeId?, cursor?, limit })              -> 分页
get(id)                                                          -> 详情
dispatchDueReminders({ now?, limit? })                           -> { dispatched: number }
```

状态机：

| 当前 | 事件 | 动作 | 外发 |
| --- | --- | --- | --- |
| 无 | raise | 建行，`state=firing`，`firstSeenAt=now`，按 §4 计算 `nextNotificationAt` | 是（firing） |
| firing | raise | `lastSeenAt` 前推、`occurrences+1`；`nextNotificationAt` 不动 | 否（去噪，节奏不被重复上报重置） |
| firing | 提醒到点 | `lastNotificationAt=now`，`nextNotificationAt=now+repeatIntervalMinutes` | 是（firing，同一模板） |
| resolved | raise | 重开：`state=firing`、`resolvedAt=null`、`occurrences=1`、`firstSeenAt=now`，重算 `nextNotificationAt` | 是（firing） |
| firing | resolve | `state=resolved`、`resolvedAt=now`、`nextNotificationAt=null` | 是（resolved） |
| resolved | resolve | 幂等返回，不改数据 | 否 |
| 无 | resolve | 返回 null 并记日志（迟到的恢复不凭空造告警） | 否 |

术语：全链路只用一组值 `firing | resolved`，与 Alertmanager / PagerDuty / Grafana 对齐。告警表、通知端口、规则条件都用同一个字段名 `state`，不设 `phase`，也不引入 `recovered` / `raised` / `pending`——`recovered` 仅作中文文案与宿主 `notificationKey` 后缀（`url-check.recovered` 是模板名，不是枚举值）。

| 场景 | `state` | 用户看到 |
| --- | --- | --- |
| `raise` 新建或重开 | `firing` | 「发生」 |
| 提醒到点 | `firing` + `reminderCount` | 「仍未恢复（第 N 次提醒）」 |
| `resolve` | `resolved` | 「已恢复」 |

提醒复用 `firing` 的 `notificationKey` 与模板，key 不随提醒次数分裂，按 key 静音与规则分流因此稳定。

并发：`fingerprint` 唯一约束是唯一仲裁点；`raise` 捕获唯一冲突后重读 winner 行继续推进，不向调用方抛错。

`dispatchDueReminders` 是幂等扫描：取 `state=firing AND nextNotificationAt <= now AND 来源未暂停` 的行，逐条外发并推进节奏。**模块不内置调度器**（与静默窗口「到期自动失效、无定时任务」的既有约定一致），由宿主用自己的 job 机制周期调用。

### 4. 提醒节奏取代静默

「静默一条告警」在用户视角有三种意图，现在统一由节奏字段表达，不再需要独立的静默实体：

| 用户意图 | 表达方式 |
| --- | --- |
| 每 5 分钟提醒一次 | `repeatIntervalMinutes = 5` |
| 一天后再提醒 | 把 `nextNotificationAt` 直接改到 `now + 24h` |
| 认领后别再提醒 | 把 `nextNotificationAt` 置空（`repeatIntervalMinutes` 保留，恢复或重开时重新启用） |

新建与重开时的初值计算：

```text
nextNotificationAt = max(source.notifyPausedUntil ?? now, now) + repeatIntervalMinutes
```

**提醒要可区分**。提醒复用 `firing` 的 `notificationKey` 与模板（否则按 key 静音、规则分流都会随提醒次数分裂），但端口额外携带 `reminderCount`（第几次提醒，首次为 0）。模板据此把标题改成「仍未恢复（第 3 次提醒）」并附首次发生时间。`reminderCount` 只进渲染上下文，不进 `notificationKey`、不进规则条件。

按来源暂停的精确语义（`AlertSource.notifyPausedUntil`）：

1. **停外发不停记录**。暂停期间 `raise` 照常建行、推进 `lastSeenAt` 与 `occurrences`，`resolve` 照常落 `resolvedAt`；只是不调用通知端口。
2. **到期最多一条迟到提醒**。恢复外发后只命中当前一次的提醒，不补发暂停期内错过的每一条。
3. **期间发生的恢复不外发**。暂停期内 `resolve` 不发 resolved 消息，但状态照常变为 `resolved`，宿主查询可见。

`notifyPausedUntil` 只放在 `AlertSource` 上。单条告警的「延后提醒」直接写 `nextNotificationAt`，不重复设同义字段。

**按来源暂停取代模块级总开关**。生产者已有五个且持续增加（frontend monitor、backend monitor、health、url-check、heartbeat，之后还有 CloudWatch），全局开关的爆炸半径过大；纯布尔没有结束时间；而「这个来源这段时间别吵我」天然以来源为粒度。批量静默（如「本项目 warning 以上安静 2 小时」）在交互层落成批量修改这些来源的 `notifyPausedUntil`，不需要额外的静默窗口实体。

外部源适配语义：CloudWatch 之类自带 ALARM / OK 状态的生产者，由宿主适配器映射成 `raise` / `resolve`；映射属于宿主业务，registry 侧零外部 API 知识。

### 5. 告警如何调用通知

告警域只定义端口，不知道模板、频道、语言：

```ts
interface AlertNotificationPort {
  notify(event: {
    alertId: string;
    source: string;
    scopeId?: string;
    state: "firing" | "resolved";
    severity: string;
    labels: Record<string, string>;
    data: Record<string, unknown> | null;
    reminderCount?: number; // 提醒复用 firing 模板，次数只用于渲染
  }): Promise<void>;
}
```

宿主适配器负责把 `(source, state)` 映射成通知 key（如 `url-check` + `firing` → `url-check.down`，`url-check` + `resolved` → `url-check.recovered`），再调用 `NotificationCenterService.notify()`。映射属于宿主业务，registry 侧零模板知识。

### 6. 通知域收缩

- **删除 `NotificationAlert` 模型**，告警表迁出。
- **删除 `NotificationSilence` 模型与 `silenced` 投递原因**，静默能力整体由 §4 的提醒节奏与按来源暂停承接。
- `NotificationRecord` 与 `NotificationDeliveryAttempt` 删除 `alertId` 外键，改为：

```prisma
sourceType String? @db.VarChar(20)  // alert | event
sourceRef  String? @db.VarChar(100) // Alert.id 或其他来源 id，无外键
```

- `NotificationDeclaration` 增加 `kind: "alert" | "event"`（代码注册）。`kind` 只决定可用模板形态（`alert` 允许恢复模板），不再影响规则维度；声明不再持有默认 severity，severity 一律由调用方传入（见 ADR-062「severity 契约」）。
- `notify()` 入参：移除 `alertKey`、`status`、`recoveredAt`；保留 `notificationKey`、`context`、`severity`（必传，词表固定五档）、`scopeId`、`link`、`deduplicationKey`；新增 `state`（仅 `kind=alert` 使用，取 `firing | resolved`，驱动标题/正文模板选择与规则 `state` 条件）与 `sourceType` / `sourceRef`（溯源）。
- **投递规则按次求值，不再冻结**。同一告警的 firing 与 resolved 因为 severity 稳定，命中同一侧的规则；只有显式按 `state` 区分的规则才会分开——这是操作者的明确意图，不需要模型层强制。
- 按 key 开关、中心开关、通道判定保持原样，判定痕迹继续落在 `NotificationDeliveryAttempt`。通知域不再有任何「这条消息要不要因为时间窗口而不发」的判断：要不要发由调用方（告警域）决定，通知域只管发得成发不成。

### 7. 表结构与迁移

- 新文件 `packages/modules/alert-center/prisma/schema.prisma` 含 `Alert` 与 `AlertSource`。
- 通知侧 schema 删除 `NotificationAlert`、`NotificationSilence`、两处 `alertId`，新增 `sourceType` / `sourceRef`。
- 宿主（nightwatch-backend）按版本化迁移落地，分两次：先加新表与新区列、代码双写可读；再删旧列与旧表。
- **不回溯数据**。存量 `NotificationAlert` 行里 9/13 是僵尸行，且告警状态可由生产者自愈：url-check 与 heartbeat 下一次轮询就会重新 `raise`。历史消息本身保留在 `NotificationRecord`（标题、正文、firing/resolved 状态），审计价值不依赖告警表。
- 旧表删除前确认零读：`NotificationAlert` 与 `NotificationSilence` 当前只有模块 service 读取，随 P0 代码删除即可满足。

## 跨宿主 / 演进检验（registry 模块设计必填）

- **无宿主词**：`source`、`scopeId`、`alertKey`、`labels`、`data` 均领域通用；宿主把 `projectId` 映射为 `scopeId`，registry 不出现 `project`。
- **对所有消费方一致**：装配 `alert-center` 即得到统一状态机与提醒节奏；不装则通知域仍可独立工作（纯事件通道），两者可分开采用。
- **演进路径**：TTL、自动 resolved、抑制、分组都只改告警域，不需要触碰投递管道；多通道只改通知域。R39-11 在本 ADR 落地后可独立设计。

## 影响

- registry：
  - 新建 `packages/modules/alert-center/`（manifest、module、service、controller、DTO、schema、README、测试）。
  - `notification-center` 删除告警与静默相关 service 逻辑、DTO 字段、schema 模型与对应测试；`notify()` 契约按 §6 调整；README 重写投递流程。
- 宿主（nightwatch-backend）：
  - `newbie modules add alert-center` 装配，注册 `AlertNotificationPort` 适配器（source → notificationKey 映射）。
  - url-check 与 heartbeat 从 `notify({ status, alertKey })` 改为 `AlertCenterService.raise / resolve`。
  - 其余 9 处事件生产者零改动。
  - 宿主 job 周期调用 `dispatchDueReminders`。
  - 两次 Prisma 迁移（加表/加列，删列/删表）。
- 前端（nightwatch-frontend）：现有通知 UI 不读告警表，无破坏性变化；告警列表页与来源设置面（重复间隔、`notifyPausedUntil` 批量编辑）属后续独立需求，不在本 ADR 内。

## 迁移阶段

| 阶段 | 内容 | 行为变化 |
| --- | --- | --- |
| P0 | `alert-center` 模块 + 单元测试；通知域按 §6 收缩 | 事件类不再产生告警行；静默能力下线 |
| P1 | 宿主装配 + 端口适配器 + 迁移（加表/加列）；接入 `dispatchDueReminders` | 新告警写入新表，未恢复告警开始按节奏提醒 |
| P2 | url-check / heartbeat 改接告警域；观察一轮 | 告警行为不变，数据落新表 |
| P3 | 迁移删除旧列、旧 `NotificationAlert` 与 `NotificationSilence` 表 | 无 |

## 非目标

- 不做 TTL / 自动 resolved / 抑制 / 分组 / 多通道。
- 不做告警列表与来源设置的前端页面。
- 不做存量告警数据回填。
- 不在本 ADR 内评价或修改通知规则模型本身（规则仍按次求值）。
- 不把 `alert-center` 再拆成更细的子模块。
- 不内置调度器；提醒扫描由宿主驱动。

## 被否掉的方案

- **`notify()` 传 `alertKey` 才建告警**：仍然是「通知决定告警是否存在」，因果未纠正；而且纯事件调用点只要忘了去掉 `alertKey` 就继续造僵尸行。
- **模块级告警总开关 / `quietWindow`**：爆炸半径覆盖所有生产者，且没有结束时间语义；维护窗口内新产生的告警只能靠额外规则兜底。
- **保留静默实体，只收窄适用范围**：静默与提醒节奏是同一件事的两种说法，并存会产生「静默窗口 + 节奏」两套时间语义互相覆盖。
- **`pausedUntil` / `notifyPausedUntil` / `mutedUntil` 命名**：`pausedUntil` 看不出暂停的是什么；`notifyPausedUntil` 与方法动词族混用。最终取名词族 `notificationPausedUntil`，与 `nextNotificationAt`、`lastNotificationAt` 一致；方法侧继续用 `notify*`、`raise`、`resolve`。

## 后果

正面：告警与通知各自拥有表与入口，依赖方向唯一；事件类消息不再污染告警；静默、延后、重复提醒收敛为一个可解释的节奏字段；告警能力可以独立演进；通知域可以单独使用。

负面：多一个模块与一次宿主装配；两个域之间靠字符串 id 关联，没有数据库级约束，需要靠端口契约与测试保证；提醒依赖宿主周期调用 `dispatchDueReminders`，宿主不接则不会提醒（可在 README 与装配检查中提示）；`NotificationDigest` 等既有表删除 `alertId` 后，历史投递的告警溯源依赖 `sourceRef` 字符串。
