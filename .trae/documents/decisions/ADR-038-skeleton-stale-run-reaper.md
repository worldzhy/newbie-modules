# ADR-038: 骨架内建 stale run reaper

状态：已采纳
日期：2026-10-27
归属：框架层（newbie-modules registry，`packages/modules/evaluation`）
关联：ADR-020（骨架，本 ADR 承接其生命周期面）、ADR-032 D2/D5（终态事件发射点与错误文案单一来源，本 ADR 在其上扩展第二个发射路径）

## 背景

run 的 stale 判定与行翻转早已存在（`expireStaleRuns`），但只在 `startRun` 准入口处按 subject+version **局部**触发。后果有两层：

1. **读模型撒谎**：一个进程死在 run 中途、且该 subject+version 再也没有新 run 发起时，行永久停留在 `RUNNING`——列表、详情、并发入口全部把它当活 run。
2. **事件契约有洞**：ADR-032 D2 规定"终态落库之后必发 `evaluation.run-*`"，但 reaper 这条终态路径从不发事件——消费方（通知、消息卡片、webhook）对超时死亡完全无感知。

需要决定：stale 清扫由谁触发、在哪一层、发不发事件。

## 候选方案

- **A. 骨架内建 interval reaper**：runner 服务在 `OnModuleInit` 启动 `setInterval`（unref），周期性全局扫描并翻转 stale 行。
- **B. 宿主装配调度器**（如 `@nestjs/schedule` cron 调骨架暴露的 sweep 方法）：触发器在骨架外。
- **C. 什么都不做**，维持 startRun 局部触发。

## 决策

选 A。决定性理由：ADR-020 的核心卖点是"实现四组端口即继承生命周期"——若清扫需要宿主记得装一个 cron，则生命周期对宿主不再完整，每接一个新宿主就多一处可遗忘的装配点；B 把骨架的不变量外包给了宿主的记性。C 让读模型与事件契约的洞永久存在。

### D1. 触发器内建于骨架，宿主零装配

`EvaluationRunnerService` 实现 `OnModuleInit`/`OnModuleDestroy`：启动时创建 `setInterval` 并 `unref`（永不阻碍进程退出），销毁时清理。不引入 `@nestjs/schedule`——骨架零新增依赖，一个裸 interval 足够。

### D2. 全局扫描 + 行级条件更新，多实例安全

每轮扫描全部 subject 的 active 过期行；翻转用行级条件更新（`WHERE id AND status IN active AND updatedAt = 选中时的值`），`updatedAt` 条件挡住"选中后恰好收到心跳"的行。多副本部署下两个实例选中同一行时，条件更新保证恰好一个实例的 `count = 1`——**只有实际抢到行的实例发事件**，无需分布式锁。

### D3. reap 是终态翻转，走与 execute 相同的事件契约

对每个实际 reap 的行：先发 `evaluation.run-failed`（identity 复用 runner 的 resolveRunIdentity，解析失败只记日志、跳过事件），再通知 `EvaluationObserver.onRunFinished`。error 文本 = 行持久化文本——reaper 写入行的就是同一段常量文案，ADR-032 D5 的"同源"在此天然成立。ADR-032 D2 的"唯一发射点"由此扩展为**骨架 runner 内的两条路径**（execute 终态 + reaper），发射方仍是同一个骨架服务，feature 依旧不得自行发射。

### D4. 移除 startRun 的局部触发，reap 只剩一条路径

保留局部触发意味着同一语义有两份实现（且局部那份若不发事件就继续违背 D3，若发事件则事件路径变成三条）。移除后：死行解除阻塞的最大延迟 = 一个扫描周期（默认 60s），准入口径统一为"active 行存在即 409"。

### D5. 配置

`EvaluationRunOptions` 新增 `reapIntervalMs`（默认 60_000）；`staleRunTimeoutMs` 语义不变。`reapIntervalMs` 只影响死行被发现的延迟，不影响正确性。

### D6. 失败隔离

单轮 sweep 的异常只记日志、不中断 interval；上一轮未结束时下一轮直接跳过（reap 幂等，重叠无收益）。

## 跨宿主 / 演进检验

| 维度     | 检验结论                                                                               |
| -------- | -------------------------------------------------------------------------------------- |
| 可移植性 | 任意宿主装上骨架即获得 reaper，零装配、零新增依赖；不引入任何宿主概念                   |
| 多副本   | 行级条件更新保证恰好一个实例完成翻转并发事件，无需锁                                    |
| 进程语义 | interval unref，不阻碍宿主进程退出；`OnModuleDestroy` 清理，测试/热重载不残留定时器     |
| 演进     | 未来若要改 cron 表达式/分布式锁，只需替换 D1 触发器，D2/D3 的清扫与事件语义不动         |

## 影响

- 更容易：死 run 最长一个扫描周期内被收口，读模型不再撒谎；通知链路对超时死亡可感知；#6 的骨架测试补齐获得明确目标（reaper、fencing、markFailed 冲突路径）。
- 更难：无新增依赖；骨架进程内多一个常驻 interval（unref，代价可忽略）。
- 契约变化：`startRun` 不再顺带清扫——对"死行挡路时立刻重试"的调用方，409 可能持续到下一个扫描周期。
