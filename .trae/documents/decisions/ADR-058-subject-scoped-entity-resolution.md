# ADR-058: INTEL 实体供给改为按 subject 解析（subject-scoped entity resolution）

状态：已采纳（2026-11-13 用户批准方案 B）
日期：2026-11-13

> 归属：registry 模块契约变更（`packages/modules/security-evaluation` 的 SPI 形状）→ 本仓。宿主侧实施（`ProjectSecurityProfileService` 改为按 subject 解析实体）归 nightwatch-backend，随本决策同步改造。

Supersedes: ADR-039 D4 的实体供给契约形状（"输入无，输出 `{scopeType, scopeId, entities[]}` 列表"）。ADR-039 其余章节（D1–D3 迁入范围与落库、D5 ADR-018 护栏、D6 通知与调度重绑）保持生效。

修订：ADR-045「跨宿主 / 演进检验」中"`scopeKey` 由 `subject.scopeType/scopeId` 组成"一句；ADR-018「跨宿主 / 演进检验」表中实体来源行的 SPI 形状描述。两份 ADR 正文不改，新语义由本 ADR 承接。

## 背景

ADR-039 把 security-evaluation 平台化：所有 subject 的主体坐标固化为模块常量 `platform:deployment`（`SECURITY_EVALUATION_PLATFORM_SCOPE_TYPE` / `SECURITY_EVALUATION_PLATFORM_SCOPE_ID`，见 `security-evaluation.constants.ts`），宿主不再挑选坐标值。

但同一份 ADR 的 D4 保留了实体供给 SPI 的旧形状：`listScopeEntities()` 无输入、返回按宿主自有 scope 枚举的 `{scopeType, scopeId, entities[]}` 列表；宿主唯一实现 `ProjectSecurityProfileService` 仍按 project 逐条输出 `{scopeType: "project", scopeId: project.id}`。平台化只迁移了「主体坐标」，没有迁移「实体供给契约」。

运行后果（2026-11-13 专家评审 R3-01，P1）：INTEL 评估的 subject 为 `platform:deployment`，宿主返回的 scope 列表只有 `project:<id>`，evidence provider 的精确匹配永不命中，抛 `BadRequestException`。fail-closed 保住了"不产出空洞 clean"，但功能 100% 不可用：本地 109/109 FAILED、0 SUCCEEDED，生产同现象。模块测试替身仍使用 `scopeType: "project"`，掩盖了契约错位（R3-02）。

次级缺陷：`scopeKey = subject.scopeType:subject.scopeId` 在平台化后退化为全局常量 `platform:deployment`。负缓存唯一键 `(knowledgeItemId, scopeKey)` 因此让所有资产共用一个判定域，跨资产误复用"不相关"结论；同一坐标在 evidence provider 与 INTEL judgment 两处各自拼接，存在漂移风险。

## 候选方案

- **A 宿主侧单一 platform scope + 全部署实体并集**：契约不动，宿主把全部项目的实体合并成一个 `platform:deployment` scope 返回。止血最快，但语义错误——不同资产的实体混在同一集合，任一资产的情报会被归因到所有资产；提示词成本随全量资产线性增长；负缓存仍全局共用。
- **B SPI 改为按 subject 解析（推荐）**：`listScopeEntities(subject)` 让宿主按本次 run 的 subject 返回它自己的实体集，`null` 表示宿主不认识该 subject、模块 fail-closed；`scopeKey` 改为 `${subject.kind}:${subject.subjectKey}`。契约与平台化对齐，一次 run 只处理一个资产。
- **C 回退 ADR-039 平台化**：恢复按 project 枚举与逐项目 run。等于放弃"一个自然资产一次评估"的平台语义，排除。

## 决策

选 **B**。

### D1. 端口签名

```ts
export interface SecurityEvaluationScopeEntitiesProvider {
  /** null = the host does not know this subject; the module must not judge. */
  listScopeEntities(subject: EvaluationSubjectRef): Promise<SecurityEvaluationScopeEntity[] | null>;
}
```

- `null`：宿主不认识该 subject。模块必须 fail-closed，保留现有 `BadRequestException` 语义（对未知 subject 的 run 会报告空洞 clean）。
- `[]`：宿主认识该 subject 但没有可匹配实体。沿用"空实体 → 空集合"短路（`emptyCollection`），不视为错误。

`SecurityEvaluationScopeEntity` 保留；删除 `SecurityEvaluationScopeEntities` 包装类型——它是"一次返回所有 scope"的产物，按 subject 取实体后坐标由 subject 提供，包装类型没有存在理由。

### D2. 模块侧改动边界

1. `judgment/intel/security-evaluation-scope-entities.port.ts`：改签名、删包装类型、注释去掉 "e.g. project"。
2. `evidence/security-evaluation-evidence.provider.ts`：`const entities = await provider.listScopeEntities(subject)`；`null` → `BadRequestException`；`[]` → `emptyCollection`。
3. `scopeKey` 收敛为共享 helper（单点定义），evidence provider 与 `judgment/intel/security-evaluation-intel.judgment.ts` 都必须调用它，禁止两处各自拼键。取值 `${subject.kind}:${subject.subjectKey}`。
4. 测试：替身按 subject 返回；新增"未知 subject → null → 抛出"负向用例；断言 `scopeKey` 为 subject 维度而非 `platform:deployment`。

### D3. 宿主实施（nightwatch-backend）

`ProjectSecurityProfileService` 改为 subject-aware：

- `subject.kind !== "repository"` → 返回 `null`（当前宿主只解析仓库资产，`aws-account` 的 INTEL 尚未接入）。
- 仓库解析以 `repository.id = subject.subjectKey` 为主，兼容 `repository.url` / `repository.fullName = subject.subjectKey`。subjectKey 存在 `repository|<cuid>` 与 `repository|<url>` 两种历史形态（评审 R3-04），只认单一形态会再次 fail-closed。
- 实体集：`fullName` 的 `owner/repo` slug、`fullName` 原值、`applications[].name`、`applications[].project.name`；大小写归一、去重，单资产上限 80（沿用 `MAX_ENTITIES_PER_PROFILE`）。
- 找不到仓库 → 返回 `null`，不抛异常（判定权在模块）。
- 新增 `project-security-profile.service.test.ts`：id 命中 / URL 命中 / 未知 subject → null / 去重与上限 / 非 repository kind → null。

### D4. 数据影响

`SecurityEvaluationThreatNegativeCache` 唯一键含 `scopeKey`。旧键 `platform:deployment` 的行在新语义下不再被读取；这些行是本缺陷下的误判产物（该坐标下 run 全部失败，预期写入量为 0），落地时核对并清理。无 schema 变更，无需迁移。

## 跨宿主 / 演进检验

| 维度 | 框架层（registry） | 宿主层（实施） |
|---|---|---|
| SPI 签名 | `listScopeEntities(subject) → Entity[] \| null` | 按宿主业务表解析本次 subject 的实体 |
| 未知 subject | `null` → fail-closed，绝不产出空洞 clean | 返回 `null` 而非抛异常，判定权在模块 |
| 空实体 | `[]` → 空集合短路 | 认识 subject 但确无实体 |
| 主体坐标 | 模块常量 `platform:deployment` 不变（ADR-039） | 不挑选坐标值 |
| 缓存键 | `${subject.kind}:${subject.subjectKey}`，与宿主无关 | 不感知 |
| 可移植性 | 任意宿主实现一个按 subject 解析的 port 即可 | 仓库/账号的实体推导是宿主特有 |

无 nightwatch 词汇进入 registry：端口只出现 `EvaluationSubjectRef` 与通用实体值，不认识 Project/Application。

## 影响

更容易：平台化语义闭环——INTEL 一次 run 只处理一个资产的实体集；负缓存按资产隔离，不再跨资产复用"不相关"结论；`scopeKey` 单点定义，两处拼键漂移消除。

更难：SPI 破坏性变更（签名与返回类型），所有宿主实现必须同步改造；宿主需要处理 subjectKey 的多种历史形态。

后续工作：① 在 nightwatch-backend 先改模块并完整验证（`npm test` / `npm run build` / `npm run lint` / `npm run format:check` + 手动触发一次 threat-intel run 取证），再机械 back-port registry，`diff -rq` 为空；② 宿主新增 provider 单测；③ 核对并清理负缓存中 `scopeKey = 'platform:deployment'` 的残留行；④ nightwatch-backend ADR-039 追加 errata（主体坐标不变，实体供给改为按 subject）；⑤ 关闭 devbie 评审台账 R3-01。
