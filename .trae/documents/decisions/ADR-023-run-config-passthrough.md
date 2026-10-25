# ADR-023: run 级 config 透传与判定结果 metadata 回填

状态：已采纳
日期：2026-10-26

> 归属：registry 骨架契约决策 → 本仓。本 ADR 是对 ADR-020 骨架的增量扩展，不取代其中任何决策；ADR-020 正文保持原样。

## 背景

work-evaluation（ADR-021/ADR-024）把多模型判定定为一等能力：同一 subject 用不同 LLM scope 各跑一次，结果可按模型对比。但骨架现有的运行入口没有每次运行的参数通道：

1. `StartEvaluationRunInput` 只有 `{ subjectId, criteriaVersionId?, requestedByRef? }`，触发方无法声明「本次运行用哪个模型」。
2. `JudgmentInput` 只有 `{ subject, criteriaVersion, criteria, evidence }`，判定器拿不到运行级配置。
3. `EvaluationResult.metadata` 字段存在于 schema，但 runner 不写它——判定器无法回填「本次实际使用的 model / scope / promptVersion」，多模型结果对比缺少分组坐标。

需要在动代码前决定：运行级配置以什么机制穿过骨架到达判定器，判定侧注记以什么路径落库。

## 候选方案

- **A run 级 config 透传**：`EvaluationRun` 加 `config Json?`；`StartEvaluationRunInput.config?` 随开行落库，runner 透传进 `JudgmentInput`；`EvaluationJudgment` 加 `metadata?`，由 runner 写入 `EvaluationResult.metadata`。
- **B 模型钉进 criteria version metadata**：每个（准则版本 × 模型）组合发布一份独立版本。污染准则身份——同一 rubric 为对比模型被迫发布 N 份，finding family 随版本分裂，发布工作流噪音大。
- **C 模型编进 subjectKey**：subject 身份变为（成员, 周期, 模型）。污染被评对象身份——finding 与 remediation 按模型碎片化，违背 ADR-021 的主体界定。
- **D 不做扩展**：判定器只能使用绑定时固定的模型，多模型对比不可达。

## 决策

选 **A**。决定性理由：模型选择是**运行的一次性参数**，不是准则内容也不是主体身份——B 和 C 都是把它塞进了错误的身份维度，只有 A 把它放在它所属的运行维度上。config 是不透明的 feature-defined JSON，骨架只透传不解释，与骨架「never calls a model」的边界不冲突。

### D1. config 的形状与边界

- `EvaluationRun.config Json?`：不透明 JSON，骨架不校验内容、不读取任何键；合法性属 feature。
- `StartEvaluationRunInput.config?: Record<string, unknown>`；开行时原样落库。
- `JudgmentInput.runConfig`：runner 从行上读出后透传，判定器自行解释（work-evaluation 用来选 llm scope）。
- config 不参与并发约束（仍是每 (subject, version) 一个活跃 run）；两个不同 config 的运行顺序执行，各产一行 result。

### D2. 判定注记回填

- `EvaluationJudgment.metadata?: Record<string, unknown>`：判定器自述本次判定的执行事实（model、scope、promptVersion 等）。
- runner 原样写入 `EvaluationResult.metadata`；骨架不解释。结果行不可变不变量不受影响——metadata 只在创建时写入。

## 跨宿主 / 演进检验（registry 模块设计必填）

config 与 metadata 均为不透明 JSON，无任何 nightwatch 或厂商词汇；新宿主绑定同一骨架即获得同一透传通道。透传通道不假定 LLM 存在——确定性判定器（security-evaluation 的版本区间/基线判定）可以忽略 config，也可以用 config 传判定预算；语义由 feature 自定。

## 影响

更容易：feature 获得运行级参数通道，多模型对比、判定预算覆盖等需求不再需要骨架改动；结果对比读模型有稳定的分组坐标（result.metadata）。

更难：骨架多一个「不解释但透传」的字段，README 必须写清边界，防止 feature 把宿主身份或大 payload 塞进来（config 只放小体量旋钮，与 evidence payload 同一约束）。

后续工作：work-evaluation 是本扩展的第一个消费方（ADR-024）。
