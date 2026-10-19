# ADR-004: 统一 LLM model 提供者——抽取 llm 模块，模型记录按 scope 服务全部消费方

状态：已采纳（2026-10-13 用户批准三项核心决策 + 三项细化决策：在途前端改动先独立提交、页面挪至 /settings/models、health 发射点上移 resolver decorator）
日期：2026-10-13
归属注记：本决策治理 newbie-modules 模块代码，单一源存放于本仓（nightwatch-backend 侧编号 ADR-005，该处现为同编号重定向存根）。2026-10-19 起按单一源规则执行。
Supersedes：ADR-004 的"health 发射点位于 copilot kernel（AgentRunner 内经 ModelHealthSink seam）"一节（见决策 3）

## 背景

架构原则（用户声明）：**系统中只能有一个 AI model 提供者**。现状违反该原则——存在三处独立的模型客户端与三份凭证来源：

| 消费方                                    | 现状                                                                            | model                    |
| ----------------------------------------- | ------------------------------------------------------------------------------- | ------------------------ |
| backend-monitor/ai-analysis               | `new OpenAI()`，env `BACKEND_MONITOR_DEEPSEEK_KEY`                              | 写死 `deepseek-v4-flash` |
| application/jdy（receipt/statement 两处） | `new OpenAI()`，env `JDY_DEEPSEEK_API_KEY`，依赖 `response_format: json_object` | 写死 `deepseek-chat`     |
| copilot                                   | ChatModelPort + adapter + CopilotModel 动态管理 + health（ADR-004）             | DB 动态配置              |

copilot 的 model port 已是"唯一提供者"雏形，但存在三个结构性缺口：

1. **归属错位**：port/adapter/model 管理/health 物理与命名都绑在 copilot 模块下，提供者是某个消费方的私有财产。
2. **能力缺口**：`ChatModelPort.ChatRequest` 不支持 JSON mode（jdy 强依赖）；`ActiveChatModelResolver` 只解析全局唯一 active 记录，无法支撑各消费方使用不同 model。
3. **health 覆盖缺口**：ADR-004 的发射点在 copilot kernel 的 AgentRunner 内（ModelHealthSink seam），只有 copilot 对话落 health；ai-analysis/jdy 调用不经过 kernel，统一 provider 后其 model 记录将永远显示"从未调用"。

涉及 registry 模块结构变更、prisma schema 重命名（migration）、跨宿主 API 契约重命名（apits 重生成）、ADR-004 部分取代，属架构决策点，必须在写代码前决定。

## 候选方案

### 方案 A：抽取系统级 llm 模块（本 ADR 提议）

新建 registry 模块 `llm` 承接 port + adapters + model 管理 + resolver + probe + health；模型记录增加 `scope` 维度，每消费方一条 active 记录；copilot/ai-analysis/jdy 均为纯消费方。

### 方案 B：留在 copilot 模块，其余消费方依赖 copilot

改动最小，但提供者绑在消费方 copilot 名下，语义不纯；jdy（财务凭证）依赖 copilot（聊天助手）在模块边界上无法自洽。

### 方案 C：仅凭证级统一（合并 env key，各自仍 `new OpenAI()`）

不消除多调用点，无统一管理面与 health，等于放弃"一个提供者"原则本身。

## 决策

1. **新建 registry 模块 `llm`**（`packages/modules/llm`，NestJS `LlmModule` 保持 @Global）：承接 `chat-model.port.ts`（port/types/errors）、`adapters/`（ai-sdk.bridge、openai-compatible、anthropic）、model 管理（service/controller/dto/providers 常量）、resolver、status probe、prisma fragment。copilot 模块删除 `model/` 全部与 `kernel/chat-model.port.ts`、`kernel/model-health-sink.ts`，`moduleDependencies` 由 `["lark"]` 改为 `["llm", "lark"]`；backend-monitor manifest 增加 `"llm"` 依赖并删除 `config-service.deepseekKey`、`env.BACKEND_MONITOR_DEEPSEEK_KEY`、`dependencies.openai`。

2. **模型表重命名 + scope 维度**：`CopilotModel` → `LlmModel`，物理表迁至 `module/llm` schema 并改名；新增 `scope String` 列（migration 回填 `'copilot'`）；激活语义改为 **per-scope 唯一**——现有单 active partial unique index 替换为 `(scope) WHERE "isActive"`。scope 为不透明字符串，消费方各自硬编码常量：`"copilot"` / `"ai-analysis"` / `"jdy"`（jdy 两个 service 共享一条记录，与现状单 key 单 model 一致）。

3. **health 发射点上移为 provider 级 decorator（supersedes ADR-004 该节）**：`ActiveChatModelResolver` → `ChatModelResolver.resolve(scope)`，返回的 port 由 resolver 包装 health decorator——complete/stream 终态（成功/失败，aborted 不计）fire-and-forget 落库，与 ADR-004 同语义但覆盖全部消费方。kernel 不再发射 health：`ModelHealthSink` port 与 `ChatModelPort.modelRecordId` 一并删除，AgentRunner 仅保留审计；status probe 遍历所有 scope 的 active 记录且不再手动上报（decorator 代劳）。ADR-004 文档正文不改，本 ADR 记录取代关系。

4. **`ChatRequest` 增加 `responseFormat?: "json"`**：openai-compatible adapter 映射为上游 `response_format: { type: "json_object" }`；anthropic adapter 不支持时显式抛 `ModelCallError("bad-request", ...)`——能力声明 + 明确报错，不静默降级。

5. **三处收敛**：ai-analysis 注入 resolver（scope `"ai-analysis"`），两次 SDK 调用替换为 `complete()`（120s timeout）与 `stream()`（text-delta → analysis-token），`NoActiveModelError` 映射为现有友好错误事件；jdy receipt/statement 注入 resolver（scope `"jdy"`），`complete({ responseFormat: "json" })` 替换 SDK 调用，env 守卫删除。`openai` npm 依赖随三处改造全部移除。

6. **env 清理，不做迁移桥**：删除 `BACKEND_MONITOR_DEEPSEEK_KEY` 与 `JDY_DEEPSEEK_API_KEY`（backend `modules.config.ts`、registry manifests、`.env`、相关文档）。升级后 ai-analysis/jdy scope 无记录，功能不可用直到管理员在 models 管理页配置——pre-launch 阶段可接受，不引入 env→DB 自动播种（避免第二凭证来源复活）。

7. **API 契约正名**：`/copilot/models` → `/llm/models`，DTO 全量改名 `LlmModel*` 且 `LlmModelResponseDto`/`CreateLlmModelDto` 增加 `scope`；activate 在 scope 内事务切换；active 记录不可删除（语义不变，按 scope 判定）。前端 models 管理页泛化（scope 列 + per-scope 激活 + 创建表单 scope datalist 预填三已知值、允许自由输入），copilot dock 过滤 `scope === "copilot" && isActive`；apits 重生成。页面归属已定：**挪至 `/settings/models`**，nav/breadcrumb 同步，组件正名 `llm-model-*`。

## 影响面

- **newbie-modules registry**：新增 llm 模块；copilot、backend-monitor 两个模块改动 → 装配进 backend；registry 自身 clean 全量构建 + 测试 + `newbie dev lint`。
- **nightwatch-backend**：手写 migration（建 `module/llm` schema、表迁移改名、加 `scope` 列回填、索引替换）；host 层 copilot transports/skills/tests import 更新；jdy 收敛；`modules.config.ts` 与 `.env` 清理。
- **nightwatch-frontend**：models 页泛化（+可能的位置迁移）、dock、model-status 组件类型更新、apits 重生成；并行会话在途的"Test Connection 挪入弹窗"未提交改动需先收口。
- **验证**：migration 后创建三条 scope 记录；E2E 覆盖 copilot web 对话、ai-analysis SSE（含无 active 记录的友好错误）、jdy JSON mode、models 页 per-scope 激活与三态 health 展示。
