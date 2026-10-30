# ADR-026: runConfig 三端口对称穿线与 work-evaluation subject 懒注册

状态：已采纳
日期：2026-10-26

> 归属：registry 骨架契约决策 → 本仓。本 ADR 是对 ADR-020 骨架与 ADR-023 run config 透传的增量扩展，不取代其中任何决策；相关 ADR 正文保持原样。ADR-024 D3 中「subject `metadata.periodId`」的表述由本 ADR 取代为 run config。

## 背景

work-evaluation 管理员视图定稿后，骨架与 feature 之间暴露出三处不对称，需要在动代码前决定：

1. **periodId 的归属维度错了**。ADR-024 D3 把 `periodId` 钉在 subject metadata 上，这意味着（成员, 周期）每一组合都要预先注册一个 subject 行，且周期从「本次评审的运行参数」升格为「被评对象身份」。但 period 本质上是**本次运行要看哪个时间窗口**——这是运行级参数，与 ADR-023 确立的 modelScope 同层。
2. **config 只透传到判定端口**。ADR-023 让 runner 把 `run.config` 透传进 `JudgmentInput.runConfig`，但 `CriteriaProvider.selectVersion` 与 `EvidenceProvider.collect` 的签名里没有 config。periodId 一旦挪进 config，准则选择与证据采集这两个**恰恰最需要 period 的端口**反而拿不到它。
3. **subject 必须预注册**。管理员视图要直接选成员触发 run，而骨架 `startRun` 要求 subjectId 已存在。若坚持预注册，管理员触发前必须先有一次「确保 subject 存在」的显式调用，把宿主成员体系与骨架注册表的同步责任推给调用方。

## 候选方案

- **A periodId 留在 subject metadata + config 只到判定端口**（ADR-024 现状）：准则与证据端口读 subject.metadata 取 periodId；subject 维持预注册。问题：period 被钉进主体身份，同成员换周期即换 subject，finding family 随周期碎片化——与 ADR-023 否决方案 C 同构的错误。
- **B periodId 进 run config + config 穿线对称化 + subject 懒注册**：`CriteriaProvider.selectVersion(subject, runConfig?)` 与 `EvidenceProvider.collect(subject, criteriaVersion, runConfig?)` 增加可选 config 形参，runner 从行上读出原样透传；feature 控制器在触发 run 前用骨架的 subject 注册服务懒注册（kind + scope + subjectKey 幂等 upsert）；subject metadata 不再承载 periodId。
- **C periodId 作为骨架一等字段**（`EvaluationRun.periodId` 标量列）：问题——period 是 work-evaluation 的领域概念，骨架不解释 config 的边界（ADR-023 D1）会被打破；security-evaluation 没有 period，列对它是噪音。

## 决策

选 **B**。决定性理由：period 与 modelScope 一样是「本次运行的取值」，不是准则内容也不是主体身份——它属于运行维度（ADR-023 已定此原则），唯一的正确做法是把它放进 run config 并让 config 到达所有需要它的端口。穿线对称化不是为 work-evaluation 开口子，而是修正 ADR-023 的半截实现：config 既然定义为「不透明 per-run feature config」，三个消费端口就没有理由只有判定端口拿得到。

### D1. 端口签名扩展（向后兼容）

- `CriteriaProvider.selectVersion(subject, runConfig?)`：第二形参可选，骨架在需要特性选版本时把 `input.config` 传入。
- `EvidenceProvider.collect(subject, criteriaVersion, runConfig?)`：第三形参可选，runner 把 `running.config` 传入。
- `JudgmentInput.runConfig` 已有（ADR-023），不变。
- 三个端口的 config 均为**可选形参**——既有实现（security-evaluation、测试 stub）不声明新形参即满足接口，零涟漪。骨架仍不解释 config 内容。

### D2. subject 懒注册

- 骨架 `EvaluationSubjectService` 提供幂等 `ensureSubject`（按 kind + subjectKey upsert），feature 控制器在请求体直接收领域标识（如 evaluateeUserId）、内部 ensure 后再 open run。
- HTTP 请求体不再暴露骨架 subjectId——subject 注册表是骨架内部机制，不是 feature 的 API 词汇。
- 注册时机从「装配/同步任务」前移到「首次触发」，消灭宿主成员体系与注册表的显式同步责任。

### D3. work-evaluation 的配套改动

- `POST /work-evaluation/runs` 请求体改为 `{ evaluateeUserId, periodId }`；控制器 ensureSubject（kind="work", scopeType="user", scopeId=userId, subjectKey=userId, displayName=用户名），open run 时 `config = { periodId }`。
- period 校验：必须 COLLECTION 类型且已开始（非 UPCOMING）。
- `CriteriaProvider("work")`：从 `runConfig.periodId` 解析 period → 其 pin 的 criteria version；无 periodId 返回 null。
- `EvidenceProvider("work")`：从 `runConfig.periodId` 取窗口，evaluatee = `subject.subjectKey`。
- `JudgmentPort("work")`：home-ground 查询同理读 `runConfig.periodId`；periodId 与 evaluatee 身份不再入 subject metadata——`identityTokens` 改为判定运行时从 account 实时解析，`work-evaluation-subject.ts` 的 metadata helper 整个删除。
- subject 身份从 ADR-024 D3 的「（成员, 周期）复合」修正为「成员」单维——周期进运行维度后，subjectKey 即 userId。finding family 不再随周期分裂，跨周期对比自然落到「同 subject 多 run」的既有骨架语义上。

## 跨宿主 / 演进检验（registry 模块设计必填）

config 仍是不透明 JSON，无任何 nightwatch 或厂商词汇；可选形参对无 config 概念的特性（security-evaluation）完全透明。懒注册只要求骨架提供幂等 ensure，宿主成员语义（scopeType/scopeId/displayName 的取值）由 feature 控制器注入，骨架不学习宿主身份体系。换宿主：新宿主绑定同一骨架即获得同一对称透传通道与 ensure 原语，无需为「预注册同步」自建管线。

## 影响

更容易：period 与未来的运行级旋钮同走一条通道，feature 不再为主体身份维度的膨胀付 finding 碎片化的代价；管理员视图「直接选成员」无需任何预注册步骤；ADR-023 的 config 透传从半截修正为对称。

更难：config 内的键（periodId、modelScope）没有骨架级校验，拼写错误的键会静默无效——README 与各 feature 的 config 解析处必须 fail-fast（未知键不报错，但已知键缺失/类型错必须 400）。

后续工作：work-evaluation 按 D3 改造；骨架测试 stub 对齐新签名；README 端口契约段同步更新。
