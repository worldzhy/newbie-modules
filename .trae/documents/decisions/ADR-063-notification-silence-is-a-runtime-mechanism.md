# ADR-063: 静默是实时段的独立机制，抑制等待告警状态机收敛

状态：已采纳
日期：2026-11-13
部分取代：ADR-062 的 P3（抑制部分暂缓）

## 背景

ADR-062 把 P3 定义为"静默 / 抑制的实时求值"，只留了两行 reason 枚举，没有细化设计。落地前确认到两个事实：

1. **P2 只落了规则段的原因**。`NotificationDeliveryAttempt.reason` 目前只有 `rule` / `no-rule-matched`；实时段的 `subscription-off`、`channel-off`、`no-port` 在 `dispatchPush()` 里直接 `return`，不记录任何东西。结果是 `decision: "deliver"` 但实际未推送，用户展开投递原因会看到"已交付"，可解释性比 ADR-062 改造前更差。
2. **抑制依赖的告警活动状态不可靠**。`NotificationAlert.state` 只在 `notify()` 收到事件时改写，没有超时或自动 resolved。抑制的判定是"存在另一条 state=firing 的告警"，源告警一旦停止上报而没发 recovered，状态会永久停在 firing，目标告警被永久抑制且无法解除。

同时确认了术语分层：`suppress` 已被规则裁决动作占用（`action: deliver | suppress`），`reason: "rule"` 的语义就是"某条规则判了 suppress"。实时段的抑制不能再叫 suppression，否则重演 ADR-062 要消灭的一词多义。

## 决策

### 1. 静默是独立实体，不是 DeliveryRule 的特例化存储

```prisma
model NotificationSilence {
  id        String   @id @default(uuid()) @db.Uuid
  condition Json                      // 与 DeliveryCondition 同一套 matcher
  startsAt  DateTime @default(now())
  endsAt    DateTime
  comment   String?  @db.VarChar(512)
  createdBy String?  @db.Uuid
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([endsAt])
  @@schema("module/notification-center")
}
```

- 不设 `isActive` 列：生效条件是 `startsAt <= now < endsAt`，天然支持提前创建维护窗口，也天然过期。
- `condition` 复用 `DeliveryCondition` 与 `matchesDeliveryCondition()`，不新写匹配逻辑。空集合 `[]` 仍是"永不匹配"，清空选择只能收窄。
- 不并入 `NotificationDeliveryRule`：静默的输入是时间，规则表的输入是事件标签；静默没有 priority，不参与有序求值。合表会引入 `stage` / `startsAt` / `endsAt` 三个可空列，并让 `priority` 有序求值分叉，破坏 ADR-062 刚建立的"配置面唯一实体"。

### 2. 规则段与实时段的原因分列落库

```prisma
model NotificationDeliveryAttempt {
  // 既有
  decision String  @db.VarChar(10)  // deliver | suppress（规则裁决）
  reason   String? @db.VarChar(40)  // rule | no-rule-matched
  ruleId   String? @db.Uuid
  // 新增（P3）
  runtimeReason String? @db.VarChar(40) // silenced | subscription-off | ...
  silenceId     String? @db.Uuid
}
```

- `reason` 保持规则段语义不变，`runtimeReason` 记录实时拦截原因，两者可同时存在：规则判 deliver、实时段被静默。
- `silenceId` 指向命中的静默，便于从通知反查是哪次维护窗口拦的；该关系在建表时声明 `onDelete: Restrict`，这条溯源链不可被删除抹掉。
- 补齐既有缺口：`subscription-off`、`recovery-opt-out`、`channel-off`、`no-port` 一并写入 `runtimeReason`，不再被 `dispatchPush()` 静默丢弃。

### 3. 术语三层，一词一职

| 位置 | 名字 | 依据 |
| --- | --- | --- |
| 配置实体 | `NotificationSilence` | 对应 Alertmanager 的 `silences`，名词 |
| 实时拦截原因 | `runtimeReason: "silenced"` | 被动分词，描述这条投递的状态 |
| 规则裁决动作 | `action: "deliver" \| "suppress"` | 已有，保持 |
| 规则裁决原因 | `reason: "rule" \| "no-rule-matched"` | 已有，保持 |

`Suppression` 不复用：它已被 `suppress` 动作占位，同时表示"配置裁定"和"运行时互斥"会让投递原因不可解释。

### 4. 实时段求值顺序

```text
subscription-off → recovery-opt-out → channel-off → silenced → no-port
```

静默排在通道判定之前：人工显式静默应优先解释为 `silenced`；`no-port` 是宿主未接适配器，属于环境缺失，排最后。命中即短路，只记录第一个原因。

### 5. 抑制暂缓

不做 `NotificationInhibition`。前置条件是 `NotificationAlert` 具备过期 / 自动 resolved（例如按 `lastSeenAt` 加 TTL 的巡检任务），否则抑制会因源告警悬挂而永久生效。该前置条件本身是独立决策，届时另立 ADR。

## 跨宿主 / 演进检验

- 无宿主或厂商词：静默、matcher、时间窗均为领域通用概念；`NotificationPushPort`、`NotificationVisibilityPort` 契约不变。
- 对所有消费方一致：静默按 matcher 全局生效，`projectIds` 只是 matcher 维度之一，宿主不需要注册额外作用域。
- 演进路径：抑制在告警状态机补齐 TTL 后以独立实体加入实时段，只新增一个 `runtimeReason` 取值，不推翻本文与 ADR-062。
- 静默复用 `DeliveryCondition`，将来规则条件新增维度时静默自动获得同一维度，不需要二次改造。

## 影响

- registry `notification-center`：schema 新增 `NotificationSilence` 与两个审计列；`notify()` 增加实时段求值，`dispatchPush()` 改读求值结果；新增静默创建 / 查询 / 结束接口（不提供删除：已产生投递记录的窗口只能提前结束），模拟器返回实时拦截结果。
- 宿主（nightwatch-backend）：`project-notification-push.service.ts` 追加读 `runtimeReason`，对 `silenced` 与 `recovery-opt-out` 跳过推送。中心通道原因（`channel-off`、`no-port`）不适用于项目轨道——绑定聊天即该轨道的订阅，这是既有语义；`subscription-off` 仍由该轨道自己的 `isPushEnabled` 检查。
- 前端：本轮不做静默管理 UI；apits 重新生成以同步新增 DTO 字段。

## 非目标

- 不做抑制（见 §5）。
- 不做静默管理 UI 与通知列表内的静默快捷入口。
- 不做静默的审批流、重复静默合并、按用户订阅的静默。
- 不追溯回填历史 `NotificationDeliveryAttempt.runtimeReason`。

## 后果

正面：`decision: deliver` 与"实际未推送"的矛盾消除；静默有明确生命周期，创建即预告、到期即失效；实时段与规则段的原因分列，模拟器和详情面板都能给出一句完整解释。

负面：多一张配置表和一个审计列；静默 matcher 与规则 condition 共用类型，意味着两者的校验规则也会一起变化。
