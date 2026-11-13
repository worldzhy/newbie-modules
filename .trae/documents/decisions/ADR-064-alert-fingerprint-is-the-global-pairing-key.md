# ADR-064: 告警生命周期的配对键是 fingerprint 单列唯一

状态：已采纳
日期：2026-11-14
部分修订：ADR-062 §4（Alert 配对由 `(notificationKey, fingerprint)` 复合键收窄为 `fingerprint` 单列唯一）

## 背景

ADR-062 用 `@@unique([notificationKey, fingerprint])` 建立 firing 与 recovered 的配对，并声明"同进同退由数据模型保证"。R39-03 把 `fingerprint` 改成携带项目维度的构造（`${projectId ?? "-"}:${deduplicationKey ?? notificationKey}`，超长取前缀 + sha256），但唯一键与注释没有同步：

- 注释仍写"无 deduplication key 时默认等于 notification key"，与实际构造不符。
- 唯一键仍把 `notificationKey` 当作配对维度。同一个 deduplication key 在不同项目下本应各自成对，复合键却允许同一个 `fingerprint` 出现多行（因为 `notificationKey` 不同），按复合键 `findUnique` 会漏配，产生"没有 firing 的已恢复"记录。
- 反向地，同一项目内两个 `notificationKey` 共用同一个 deduplication key 时，`fingerprint` 相同而 `notificationKey` 不同，按复合键会得到两行；一旦改用 `findFirst` 又变成不确定配对。

根因是配对的真实唯一维度早就只剩 `fingerprint` 一个，而 schema 仍按两个维度声明。改 `findFirst` 只是把不确定性藏进查询层，不解决问题。

## 决策

1. **`fingerprint` 是唯一的配对键**，schema 声明 `@@unique([fingerprint])`；`notificationKey` 保留为展示与过滤字段，不参与唯一性。
2. **fingerprint 的构造是模块契约**，消费方不得自行拼接：

   ```text
   scoped = `${projectId ?? "-"}:${alertKey ?? deduplicationKey ?? notificationKey}`
   fingerprint = scoped.length <= 255
     ? scoped
     : `${scoped.slice(0, 255 - 64 - 1)}:${sha256(scoped)}`
   ```

   `alertKey` 是 `notify()` 的可选入参，**firing 与 recovered 必须传同一个值**。它存在的理由是有些告警两侧的 `notificationKey` 和 `deduplicationKey` 都不同（url-check 的 down / recovered、heartbeat 的 offline / recovered），只有显式配对键才能让它们落在同一条 `NotificationAlert` 上。不传时退回 `deduplicationKey`，再退回 `notificationKey`。

3. **读取用 `findUnique({ where: { fingerprint } })`**，不使用复合键、不使用 `findFirst`。配对仍由数据库唯一约束保证，ADR-062 §4 的"由数据模型保证"在改后字面成立。
4. `NotificationRecord.deduplicationKey` 的全局唯一语义不变；本决策只约束 Alert 实例的配对维度。

## 影响

- registry `notification-center`：schema 唯一键与 `fingerprint` 注释同步；`upsertAlert` 改按 fingerprint 查找；测试覆盖「同 deduplication key 跨项目各自成对」与「同项目同 deduplication key 复用同一生命周期」。
- 宿主（nightwatch-backend）：需一次迁移重建唯一索引。notification-center 尚未在生产被真实调用，旧 Alert 数据可直接丢弃，无需数据搬迁。
- 后续消费方：若要让两个不同 `notificationKey` 的事件共用一条告警生命周期，传相同的 `alertKey`（或相同的 `deduplicationKey`）即可，不需要改动查询逻辑。

## 非目标

- 不为 Alert 增加 TTL 或自动 resolved（R39-11 的已知限制另行处理）。
- 不改变 `NotificationRecord` 的 `deduplicationKey` 幂等语义。
