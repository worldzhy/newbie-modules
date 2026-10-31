# ADR-046: 判定机制的声明式组合与结果合并契约

状态：已采纳（2026-10-31）
日期：2026-10-31
归属：框架层（newbie-modules registry，`packages/modules/security-evaluation`）
关联：registry ADR-037 D9（判定输入材料契约）、ADR-033（CIS 与 custom 两个 Evaluation）、ADR-022 D3（kind-scoped judgment port）、ADR-045（判定层去持久化依赖）

## 背景

`security-evaluation-judgment.service.ts` 目前用一个 `switch (evaluationKey)` 把每个 key 一对一绑到单个判定类：

```ts
switch (input.ruleSetVersion.evaluationKey) {
  case NPM_OSV: return this.dependency.judge(input);
  case AWS_CIS_1_5:
  case AWS_CUSTOM: return this.awsConfig.judge(input);
  case THREAT_INTEL: return this.intel.judge(input);
  default: throw new BadRequestException(...);
}
```

`aws-cis-1.5` 与 `aws-custom` 已共享同一个判定类，规则区分靠 `aws-config.rulebook.ts` 中每条规则自带 `evaluationKey` 字段后做过滤。也就是说，**多对多复用已经发生，只是以"类内按 key 过滤"的隐式形式存在**，且新增机制必须修改 switch。ADR-037 已把"judgment mechanism 多对多组合"登记为正确方向但未落地。

## 候选方案

### A. 什么都不做（继续 switch）

每新增一个 evaluationKey 就加一个 case。复用要么靠类内 if，要么复制判定类。分支数与 key 数线性增长，且"哪个 key 由哪些机制组成"无法静态回答。

### B. 声明式注册表（key → 单个机制）

把 switch 改成 `Map<evaluationKey, mechanism>`。分支消失，但结构上仍假设"一个 key 只能有一个机制"，一旦同一 key 需要第二维度（如 dependency + license），必须改注册表形状。

### C. 机制组合（key → 机制列表）+ 合并契约（建议）

注册表声明每个 key 的机制列表，判定时并行执行、按契约合并结果。当前每个 key 只声明一个机制，形态上是 C 但行为等价于 B；新增维度时只改注册表数据，不改判定层代码。

合并契约（必须写进代码，不能靠约定）：

- `verdicts`：同一 `criterionKey` 只允许一个机制产出。冲突即 fail-fast（抛错并指明两个机制名），禁止隐式加权——多个机制给同一准则打分会产生无法解释的分数。
- `findings`：按 `fingerprint` 去重；重复时 severity 取最高（复用现有 `security-evaluation-severity.ts` 的排序），`metadata` 浅合并且不覆盖已有非空值。
- `evaluatedRefs`：并集。
- `skipped`：计数累加，`note` 按机制名拼接。
- `metadata`：以机制名为命名空间合并（`{ [mechanismName]: {...} }`），保证 ADR-023 的可比性不被覆盖。
- `summary`：非空的按机制名顺序拼接。

## 决策

建议 **C**。决定性理由：**复用已经发生，问题不是"未来是否需要多机制"，而是"今天这份复用是不可见的"**。aws-cis-1.5 与 aws-custom 共享同一套判定逻辑，这个事实只能从 rulebook 的一个字段和 switch 的 fall-through 里读出来；把它提升为注册表数据后，"某 key 由哪些机制判定"变成可读、可测、可静态校验的结构。合并契约不是为将来预付的成本，而是 C 成立的必要条件——没有它，多机制命中同一个问题是未定义行为。

B 是 C 的子集形态，单独采纳会在第二个维度出现时被迫再改一次注册表形状；A 则把分支增长固化进代码。

## 跨宿主 / 演进检验

机制清单与合并契约都声明在 security-evaluation 模块内，宿主只实现 subject 级端口（repository 读取、aws-config 读取），不参与编排。新增宿主不需要改机制清单；新增机制也不需要宿主改装配（模块内 `@Injectable` 注册即可）。机制名是模块内常量，不携带宿主或厂商词汇。

## 影响

- 判定服务退化为"查表 → 并行执行 → 合并"，新增 key 只改注册表一处。
- finding 去重与 severity 取值集中在一个纯函数里，可单测，不再散落在各判定器。
- 需要新增组合契约测试：两个 fake 机制产出同 fingerprint 的 finding，断言 severity 取高、metadata 合并且不覆盖；两个机制产出同 criterionKey 的 verdict，断言 fail-fast。
- 与 ADR-045 相互独立，但都让 judgment 目录成为"无基础设施依赖"的纯层，静态契约测试可一并覆盖。

## 实现切面（按顺序）

1. `judgment/security-evaluation-mechanism.ts`：定义 `SecurityEvaluationJudgmentMechanism`——`readonly name: string` + `judge(input): Promise<EvaluationJudgment>`。现有三个判定类实现该接口并声明稳定 `name`（`dependency` / `aws-config` / `intel`）。
2. `judgment/security-evaluation-mechanism.registry.ts`：导出 `evaluationKey → readonly mechanism[]`（`aws-cis-1.5` 与 `aws-custom` 各声明一个 `aws-config` 机制，即把现有共享关系显式化）。
3. `judgment/security-evaluation-judgment-merge.ts`：纯函数 `mergeJudgments(parts)`，实现上述五条合并规则，冲突 fail-fast。
4. `security-evaluation-judgment.service.ts`：改为查表 + `Promise.all` + `mergeJudgments`；未知 key 仍抛 `BadRequestException`。
5. 测试：机制注册表断言每个 key 至少一个机制且机制名唯一；合并契约测试覆盖去重、severity 取高、verdict 冲突、metadata 命名空间。
6. 宿主：无改动（装配仍只绑定 `SecurityEvaluationJudgmentService`）。
