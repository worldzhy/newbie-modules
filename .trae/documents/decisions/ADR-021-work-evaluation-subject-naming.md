# ADR-021: work-evaluation 命名与被评对象的界定

状态：已采纳
日期：2026-10-25

> 归属：registry 模块词汇与契约决策 → 本仓。本 ADR 只决定命名与被评对象的界定，不决定 work-evaluation 的模块内容（准则条目、证据采集范围）。

> Errata（2026-10-25，用户校正，正文保留原样）：
>
> 1. **不做删除处置**：旧模块 `people-evaluation` 只冻结、长期保留，不设删除时点。D1 中「待切换完成后整体删除」、决策段「旧模块的终态是被删除」、以及影响段「旧模块删除后消失」均不再成立；两模块并存是长期状态，是否切换、是否删除由用户后续单独决定。
> 2. **`work` 词根是同一词族的刻意一致，不是命名冲突**：`work-evaluation`（评估）、`workspace`（工作区证据）、`worklog`（采集 agent）三者对应良好，词根相同表示同领域。下文「命名风险与处置」段不再作为需要缓解的风险，`work-evaluation` 的命名得到确认。

## 背景

`people-evaluation` 的词汇把被评对象写成「人」：README 明确写着「The person being evaluated is `evaluateeUserId` everywhere」。但它的证据与准则全部指向**工作**：

1. 三种上报证据是 `workspace`（IDE 工作区）、`session`（AI 编码会话，ClickHouse 全文）、`declared document`（设计稿/研究/原型）。没有任何品格、健康、态度类证据。
2. 结论形态是 `dimensionScores`（`score` + `confidence` + `coverage` + `evidenceRefs` + `rationale`），度量的是工作表现。
3. `HomeGround` 是专精维度声明（工作分工），不是性格特质。
4. 模块自述第一句即「Evidence-driven performance evaluation」。

也就是说：**被评对象是工作，决策后果才落到人**（PipPlan 的改进与去留决定）。把决策后果的承受者当成被评对象，会让名字长期指向系统并不评估的维度。

同时存在一个未被对象化的追踪需求：`PipPlan.checkpoints` 是自由文本 JSON（`[{dueDate, description, status}]`）——系统已经在跟踪「上次评估提出的问题是否解决」，却没有任何实体承载被跟踪的「问题」。

## 候选方案

- **A 更名并新建**：新模块名 `work-evaluation`，旧 `people-evaluation` 原地冻结、不作任何改动，待切换完成后删除；准则允许两种形态（评分型 → verdict，断言型 → finding），整改计划的检查点改为引用 finding。
- **B 保持 `people-evaluation` 名称**，仅在内部引入 finding。名字与被评对象的错位保持存在。
- **C 不做任何改动**（维持现状：既是 people-evaluation，也无 finding）。

## 决策

选 **A**。决定性理由：证据与准则都指向工作，只有决策后果指向人——名字应当反映被评对象，而不是决策后果的承受者。这一判断与 ADR-020 的骨架设计一致：骨架的 `EvaluationSubject` 是泛化的被评对象，work 与 asset 都只是它的 `kind`。

顺带解决了过渡期的命名问题：新模块直接取得长期成立的域名 `work-evaluation`，因此**不需要 `-new` 后缀**，也不需要改旧模块的标识——旧模块的终态是被删除，把临时后缀加在将消失的一方才是正确做法。

### D1. 旧模块冻结

`people-evaluation` 不作任何改动（含目录名、模块键、schema 命名空间），在新模块完成切换后整体删除。并存期间，两个模块的 README 必须显式声明 `work-evaluation` 是 go-forward、`people-evaluation` 是待删除的历史实现。

### D2. 准则允许两种形态

- **评分型准则**（现有 rubric dimensions：`anchorLow` / `anchorHigh` / `calibrationExamples`）→ 产出 verdict，周期冻结、不产出 finding。
- **断言型准则**（如「某个模块缺少测试」「两个 skill 定义重复」）→ 产出 finding，跨周期存活至修复或显式抑制。

引入哪些断言型准则属模块内容决策，不由本 ADR 决定。本 ADR 只确立两条契约：骨架同时支持两种形态；整改计划可以引用 finding。

### D3. 整改计划与 finding 挂钩

`PipPlan` 的 checkpoints 改为引用 `EvaluationRemediationPlan`，其 `triggerRefs` 指向具体 finding；自由文本检查点保留为描述字段，不再是唯一载体。

## 跨宿主 / 演进检验（registry 模块设计必填）

| 维度 | 框架层（骨架） | work-evaluation | 宿主层 |
| --- | --- | --- | --- |
| 主体 | 泛化坐标 | `kind = work`，身份为（成员, 周期） | 成员身份与周期从宿主身份体系解析 |
| 证据 | 只定义 `EvidenceProvider` | workspace / session / document；将来可含代码与 skills | installation token 与工作区采集 |
| 结论 | verdict + finding 两形态 | 现以 verdict 为主，finding 视准则而定 | 读模型与 UI |
| 可移植性 | — | 任意宿主装配即获得同一评估生命周期 | 成员与周期语义属宿主 |

命名风险与处置：`work` 与既有的 `workspace`、以及采集 agent 的产品名 `worklog` 相邻。README 的 Vocabulary 段必须固定一句：`worklog` 是采集 agent 的产品名，`work` 是被评对象，二者不在同一层。

## 未在此 ADR 决定的事

- work-evaluation 的完整模块设计（准则内容、证据采集范围、是否采集代码与 IDE skills 作为证据）。
- 旧 `people-evaluation` 的删除时点。

## 影响

更容易：名字与被评对象一致；整改计划的检查点第一次有了可关闭的对象；work 与 security 两个 feature 共用 ADR-020 的骨架，结论形态与整改对象不再各写一套。

更难：并存期间 registry 内有两个评估类模块，读者需要依赖 README 声明判断哪个是 go-forward。这是过渡期成本，旧模块删除后消失。
