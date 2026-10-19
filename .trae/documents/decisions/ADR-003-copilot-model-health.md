# ADR-003: Copilot 模型健康态收敛为服务端单一事实源，展示位与语义锚点分离

状态：已采纳（2026-10-13 用户批准）
日期：2026-10-13
副本注记：本决策原件存于 nightwatch-backend `.trae/documents/decisions/`（nightwatch-backend 侧编号 ADR-004、newbie-modules 侧编号 ADR-003，同文）。

## 背景

Copilot 对话实际依赖一个共享的上游模型（CopilotModel active 记录），但系统里没有任何地方陈述"这个模型当前是否可用"：

- header Copilot 按钮上的指示灯只读 `isActive`（配置态：是否激活了模型），对"模型最近调用是否成功"零感知。真实事故：对话报 `Insufficient balance`，灯仍然绿色。
- 每次模型调用的成败**已经被** kernel 在单一落点分类记录（`agent-runner` 的 `copilot.model_call` 审计条目，`success + errorCategory`，web SSE 与 Lark 两个渠道共享同一 runner），但审计流是 append-only 事实流，没有收敛成"当前态"，`GET /copilot/models` 无从透出。
- 前端设计讨论中确认的第二个缺陷：指示灯的**语义锚点是它的物理位置**——灯在 Copilot 按钮上，用户只会读成"这个聊天板的状态"；把"模型健康"（共享基础设施的属性）嫁接到按钮上，在瞬时失败场景（如 Lark 侧一次 timeout）会造成灯所述与位置所暗示的不一致。

为什么必须在写代码前决定：涉及 registry 模块 schema 变更（migration）、kernel 新增 port（跨宿主契约）、DTO 契约扩展（apits 重生成）、以及 UI 展示位重构，属架构决策点。

## 候选方案

### 方案 A：服务端落库为唯一事实源，展示位归属模型实体（本 ADR 提议）

- `CopilotModel` 增加当前态健康字段（`lastCallAt` / `lastCallSuccess` / `lastFailureCategory` / `lastFailureMessage`），由 kernel 在模型调用成败的同一单点经新 port `ModelHealthSink` 写入（fire-and-forget，不阻塞 run loop）。
- 健康态在"模型实体所在的位置"展示：模型管理页每行健康点 + tooltip；dock 顶栏显示活跃模型名 + 健康点（dock 顶栏是"聊天板范围"与"模型范围"唯一重叠的位置，用户输入第一条消息前可见，保住预测价值）。
- header 按钮指示灯**维持现状**（配置态语义），不改。

### 方案 B：前端判定（对话失败时前端更新本地状态）

事实源被拆散到每个浏览器；Lark 渠道失败不可见；刷新即丢；反映的是"我上次用失败过"而非"模型可用"。

### 方案 C：后端定时探测上游

无消费也外呼，余额不足场景反而继续打上游、触发限流；探测路径 ≠ 推理路径，结果可能失真；改变了系统与上游的交互面。

### 展示位子决策（已随方案 A 一并拍板）

- **按钮灯 = 模型健康**（原讨论稿）：被否决——位置语义锚点错位（见背景第三条）。
- **tooltip 加渠道归因（via Lark）**：被否决——模型健康是 per-model 事实，渠道归因把"为什么 Lark 的失败算在这里"显式摆到用户面前；比模糊的真相更糟。
- **四态灯（红 = 致命）**：被否决——"致命"依赖错误分类到致命性的稳定映射，而上游对余额不足等场景的返回（402/429/200+body）不统一，现有 `ModelErrorCategory` 六类不支持可靠区分；灯回答"要不要担心"，tooltip 回答"具体是什么问题"。

## 决策

采纳**方案 A**。决定性理由：健康状态的真源只能是对模型的真实调用结果，而该事实**已经发生且已被分类记录**（`copilot.model_call` 审计），缺的只是"事实流 → 当前态"这一步收敛；把它放在服务端使 web/Lark 全渠道、跨浏览器共享同一个真相，且不引入任何主动外呼。展示位遵循"指示灯语义必须与其位置锚点一致"：模型健康属于模型实体，展示在标识/管理模型的地方；按钮灯维持配置态承诺，对话内失败解释由既有 banner 承担。

实施细则（约束实现，不再另行决策）：

1. **kernel**：新增 `kernel/model-health-sink.ts`（`ModelCallOutcome` / `ModelHealthSink` / `NOOP_MODEL_HEALTH_SINK`，与 `AuditSink` 同型）；`ChatModelPort` 增加可选 `modelRecordId` 元数据（记录 id 由 resolver 经 adapter 配置传入，无状态模型源可省略，健康缝自动跳过）；`AgentRunner` 增加可选第 5 构造参数。成败记录点与审计同位；`category === "aborted"`（用户取消）与健康记录无关，不计失败。
2. **模块**：`CopilotModelService` 实现 `ModelHealthSink`（fire-and-forget，DB 异常只 warn 不抛入 run loop；成功清空失败字段，失败消息截断 500）；schema 增加四个可空列；`CopilotModelResponseDto` 透出健康字段（masked key 先例，无敏感信息）。
3. **宿主装配**：`src/application/copilot/copilot.module.ts` 的 AgentRunner factory 注入 `CopilotModelService` 作为 health sink。
4. **migration**：手写 `ALTER TABLE "module/copilot"."CopilotModel" ADD COLUMN ...`，registry + host 双落。
5. **前端**：`npm run apits` 重生成；模型管理页加 Health 列（点 + tooltip：分类 · 上游消息 · 时间）；dock 顶栏加"模型名 + 健康点"（复用 `["copilot-models"]` query key）；header 按钮不动。
6. **状态判定**（前端展示）：`lastCallSuccess === false` → 黄；`lastCallSuccess === true` → 绿；`lastCallAt == null`（从未调用）→ 中性灰。成功写入清空失败字段，回绿由下一次真实调用驱动。

## 跨宿主 / 演进检验

- kernel 不依赖任何持久化概念：`ModelHealthSink` 是纯发射缝，`modelRecordId` 是可选元数据——无模型库的宿主（如纯环境变量配置模型）不传即自动禁用健康缝，kernel 语义不变。
- copilot 模块自治：健康字段在模块自有 schema，健康写入在模块自己的 service，宿主只做 factory 注入；任何宿主装配 copilot 模块即免费获得同一能力（Lark bot 宿主同理）。
- 展示位（模型页、dock 顶栏）是宿主产品表面，不涉及框架仓（newbie/fewbie/SDK 零影响）。

## 影响

**变得更容易**：管理员诊断"对话失败但灯是绿的"类问题（如 Insufficient balance）从翻审计日志降为看模型页/打开 dock；聊天用户在输入第一条消息前即可见模型最近成败；上游模型故障期间即使 web 无流量，Lark 产生的失败也能让状态可见。

**变得更难 / 代价**：三仓联动（newbie-modules registry + nightwatch-backend 装配 + nightwatch-frontend）；一条 additive migration；DTO 契约扩展 + apits 重生成；健康写入是每步模型调用一次额外 UPDATE（fire-and-forget，可接受）。

**验收项**：

1. registry 改动后装配产物一致；nightwatch-backend `nest build` 通过；migration deploy 通过。
2. 前端容器内 `tsc --noEmit` 通过；模型页 Health 列渲染；dock 顶栏显示活跃模型名 + 健康点。
3. E2E：激活一个坏 endpoint 模型 → 对话失败 → 健康点黄 + tooltip 出现分类与上游消息 → 切回正常模型对话 → 回绿。
4. header 按钮指示灯行为与改动前完全一致；tooltip 无渠道归因字样。

## Amendment (2026-10-13): 定时主动探测 + payment 分类 + UI 重构

原始 ADR 的被动快照模型存在两个验证后发现的缺陷：

1. **被动快照失真**：健康状态仅在用户 chat 调用时更新，模型费用在两次调用之间变化（如 DeepSeek 余额耗尽）时，DB 仍显示上次成功快照，UI 呈现"灯绿但实际不可用"——正是原始事故的复现。
2. **UI 语义重叠**：模型页同时存在 Status 列（Active/Inactive badge）和 Health 列（dot），两者都有颜色信号且对用户而言"能否使用"的区分无价值；"health" 术语与 monitoring 模块的 health 设施同名易混。

### 补充决策

- **D2 定时主动探测**：新增 `ModelStatusProbeService`（registry copilot 模块内），每 5 分钟通过 `ChatModelPort.complete()` 对活跃模型发起极简探测（`"Hi"` + `maxTokens=1`），与 AgentRunner 走同一 ChatModelPort 路径，错误分类一致。探测结果经同一 `ModelHealthSink` 落库，成功清空失败字段、失败记录 category+message。用户取消（aborted）不计。`probeNow()` 方法暴露为 public，E2E 与手动触发可绕过间隔。
- **D3 payment 错误分类**：`ModelErrorCategory` 新增 `"payment"`。`classifyError` 中先于 `statusToCategory` 检查 `isPaymentFailure`：HTTP 402 或 message 匹配 `insufficient balance` / `insufficient_quota` / `quota exceeded` / `out of credits` / `payment required` 时归类为 `payment`，避免误导管理员去改配置而非充值。
- **D1 UI 列重构**：删除 Health 列；原 Status 列（Active/Inactive badge）改为 Active 列（Switch 开关组件，点击切换激活态，活跃模型 Switch ON 且 disabled 防止取消唯一活跃模型）；原 Health 列内容改名为 Status 列（dot + 文字 + tooltip）。`model-health.tsx` 重命名为 `model-status.tsx`，导出符号全量正名（`ModelStatusDot` / `modelStatusState` / `modelStatusTooltip`）。底层字段名（`lastCallSuccess` 等）与 API 契约不变。"health" 术语在 copilot 模块 UI 面消除，专属 monitoring 模块。

### 补充验收项（替代原始验收项 2-3）

5. 探测服务 `probeNow()` 手动触发后，DeepSeek "Insufficient Balance" 被分类为 `payment` 并落库（E2E PASS，2026-10-13）。
6. 前端 `tsc --noEmit` 通过；模型页表头列 = Name/Provider/Model ID/API Key/Active/Status/Created At/Actions；无 "Health" 列。
7. dock 顶栏活跃模型名 + Status dot 显示与模型页一致。
