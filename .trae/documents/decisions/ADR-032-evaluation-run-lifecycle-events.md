# ADR-032: 骨架统一 run 生命周期事件

状态：已采纳
日期：2026-10-26
归属：框架层（newbie-modules registry，`packages/modules/evaluation`）
关联：ADR-020（骨架）、ADR-022（security-evaluation 接续计划）、ADR-025 D1（模块 forRoot 接线，仍有效）、ADR-028（事件声明与宿主激活，本 ADR 遵循其机制）

## Background

两个旧安全模块各自发射扫描事件，并已被通知/消息链路消费：

- `aws-audit.scan-completed` / `aws-audit.scan-failed`（`src/modules/aws-audit/aws-audit.events.ts`）
- `dependency-scan.scan-completed` / `dependency-scan.scan-failed`（`src/modules/dependency-scan/dependency-scan.events.ts`）

骨架（`packages/modules/evaluation`）当前**零事件声明**：检索 `defineEvent` 无命中。这意味着按 D1-B 并轨切换时，即使 run 语义完全等价，通知、消息卡片、webhook 的触发源也会整段消失——这是替换动作中唯一"用户可感知但代码不可见"的断裂点。

ADR-028 已经确立了事件的正確姿势：事件定义文件归发射方模块所有（`defineEvent`），是否在启动时激活由**宿主**决定（`EventCatalogService`），发射方不得在 `onModuleInit` 里替宿主做决定。

用户决策：**D3-A —— run 事件由骨架统一声明**，而不是每个 feature 各写一套。

## Decision

### D1. 两个事件，不引入 run-started

骨架声明两个 run 终态事件：

| 事件 key                   | 触发条件                          |
| -------------------------- | --------------------------------- |
| `evaluation.run-succeeded` | run 进入 `SUCCEEDED` 且结果已归档 |
| `evaluation.run-failed`    | run 进入 `FAILED` 且失败原因已落库 |

不新增 `evaluation.run-started`：旧模块没有对应事件，当前也没有消费方。新增事件属于能力扩展，应在出现真实消费场景时另行决策，不随本次切换搭车。

### D2. 唯一发射点：骨架 runner 的终态落库之后

发射位置固定在 `EvaluationRunnerService` 完成终态写入之后（成功：result + manifest 归档；失败：`status=FAILED` + `error`），发射前状态已可在库中读到——消费者收到事件后立即查询不会读到中间态。

feature 模块（security-evaluation / work-evaluation / people-evaluation）**不得**自行发射 run 事件。同一 run 只能有一个事件源，否则消费方无法去重。

### D3. 事件由骨架声明，骨架新增 event-emitter 依赖，但不激活

- 骨架自有事件定义文件（与 feature 的事件文件同构），使用 `defineEvent`。
- 骨架 `newbie.module.json` 的 `moduleDependencies` 增加 `event-emitter`，`dependencies` 增加 `@nestjs/event-emitter`。
- 骨架**不**调用 `EventCatalogService` 声明：是否上架由宿主决定（ADR-028）。
- 宿主不激活 = 事件只在本进程内广播，不进入事件目录；这仍然优于"没有事件"，因为接线点已经存在。

### D4. payload 只含标识与终态，不含 finding 内容

```text
{
  runId: string;
  subjectId: string;
  subjectKind: string;          // repository | cloud-account | ...
  criteriaVersionId: string;
  family: string;               // dependency-osv | cis-aws-1.5 | aws-custom | ...
  status: "SUCCEEDED" | "FAILED";
  error?: string;               // 仅 FAILED，与 run 行 error 同源
}
```

不含 findings / coverage / summary：这些是可变的读模型，塞进事件等于把读模型复制一份并立刻过期。消费方需要明细时以 `runId` / `subjectId` 查询既有 endpoint。

### D5. 错误文案单一来源

`evaluation.run-failed` 的 `error` 必须与 run 行持久化的 `error` 完全一致（同一截断上限，当前 1000 字符）。禁止为事件另写一份更"友好"的文案——两份文案必然漂移，且会让排障时看到两个不同的失败原因。

### D6. observer 端口与事件通道职责不合并

- `EvaluationObserver`（`ports/observer.port.ts`）：feature 内部钩子，承载 finding 变更（created/reopened/resolved/suppressed）与 remediation 轨迹，**同步**、进程内、面向模块内审计。
- `evaluation.run-*` 事件：宿主面向通道，**异步**、可被事件目录/通知消费。

两者受众和语义不同，不合并、不互相转发。

## Cross-host check

| 维度       | 框架层（evaluation 骨架）                                                                        | 宿主层（nightwatch-backend）                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 事件声明   | 骨架自有文件，`defineEvent` 两个 run 终态事件                                                    | 不复制定义；通过 `EventCatalogService` 决定是否上架（ADR-028）                                                   |
| 依赖关系   | `moduleDependencies` 增加 `event-emitter`（单向，不反向依赖任何 feature）                         | 无新增依赖；宿主若已有 event-emitter 接线，事件自动可用                                                          |
| 发射时机   | runner 终态落库后，唯一发射点                                                                    | 不发射；消费方以 `evaluation.run-*` 为准                                                                         |
| payload    | 标识 + 终态（D4）                                                                                | 消费方按需查询 findings/report，不要求事件携带结果内容                                                            |
| 可移植性   | 任意宿主装上骨架即获得接线点；未激活事件目录时仍可在进程内广播                                    | 通知/卡片/webhook 改绑 `evaluation.run-*` 后，与 feature 无关                                                     |
| 失败语义   | 事件发射失败不得改变 run 终态（发射在落库之后，异常只记录日志）                                   | 同左                                                                                                             |

## Consequences

- 骨架新增一个模块依赖，但不引入事件目录里的"僵尸声明"（未激活时不上架）。
- feature 模块少一份各自维护的事件定义；切换旧模块时通知链路只需改绑一次。
- run 事件不携带 findings，通知内容需要明细时会产生一次额外查询——这是刻意的（避免把读模型固化进事件）。
- `threat-intelligence` 等尚未迁移的 feature 同样自动获得该事件，无需单独改动。
