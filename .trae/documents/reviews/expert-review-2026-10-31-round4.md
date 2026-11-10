# 专家代码评审报告（第四轮 · 模块 scope）— 2026-10-31

**scope**：`modules: [security-evaluation]`
**评审主仓**：newbie-modules（模块真源）；装配面：nightwatch-backend。

---

## 1. 锚点

评审区间：2026-10-31 15:12–15:40 CST（时区 Asia/Shanghai）。起始时刻未在首个命令前单独打点，15:12 为按命令链起点的估计值；锚点表在首个命令采集。

| 仓 | 分支 | HEAD | 工作树 | 说明 |
|---|---|---|---|---|
| newbie-modules | dev | `ec40ce1` | 0 dirty | 已在 `origin/dev`（`e44dcb9` 包含本提交） |
| nightwatch-backend | dev | `f51bf8e` | 0 dirty | `origin/dev` = `f51bf8e` |

两仓工作树干净，无并行在途改动，本轮结论**不标 provisional**。

---

## 2. 范围与方法

### 2.1 解析结果

| 项 | 值 |
|---|---|
| 模块真源 | `newbie-modules/packages/modules/security-evaluation` |
| 装配副本 | `nightwatch-backend/src/modules/security-evaluation`（`diff -rq` 全等，退出码 0） |
| 渲染 schema | `nightwatch-backend/prisma/models/security-evaluation.prisma` |
| 装配记录 | `modules.json`：`security-evaluation.sourceCommit=ec40ce1`，`localPatches=[]` |
| 明确排除 | nightwatch-frontend、devbie CLI 本体、evaluation 骨架、security（RBAC）模块——仅在 findings 触及时引用 |

### 2.2 方法

- 机械取证：registry↔consumer 全量 diff、`modules.json` 入口、渲染 schema、PostgreSQL 实表、`npm run build`、全量 `npm test`、`npx newbie doctor`、`node … newbie-cli/dist/index.js modules lint`。
- 逻辑评审：ADR-045（负缓存持久化）与 ADR-046（机制组合）新增面逐文件读码；对合并契约用真实函数 + 骨架 `composeCoverageStats` 做可执行反例。
- 反驳轮：对每条 P1 候选从"是否真的可达 / 是否已有替代防线 / 是否只是既有行为"三面反证，未通过的降级或剔除（见 §7）。

### 2.3 实跑结果

| 命令 | 结果 |
|---|---|
| `diff -rq` registry vs consumer | 无差异 |
| `npm run build`（nightwatch-backend） | 通过 |
| `node --import tsx --test 'src/modules/security-evaluation/**/*.test.ts'` | 65/65 |
| `npm test`（全量） | 546/546 |
| `npx newbie doctor` | 0 error / 35 notice |
| `modules lint`（registry 57 模块） | **3 error**（含 security-evaluation 1 条）、26 warning |
| PostgreSQL `\dt` / `\d` | `SecurityEvaluationThreatNegativeCache` 存在；旧 JSON 列已删除；缓存表 100 行 |
| HTTP e2e（尝试） | 返回 500（无活服务），**不作为结论依据**，列入覆盖率缺口 |

---

## 3. 结论摘要

| 维度 | 评级 | 依据 |
|---|---|---|
| 安全边界 | 待修 | 读面 scope 仍由客户端决定（R4-02，round3 未修） |
| 架构整洁度 | 良好 | 判定层零 Prisma 依赖、端口边界清晰、机制注册表把隐式复用显式化 |
| 契约一致性 | 待修 | 模块清单漏 `llm`（R4-01）；合并 skipped 与骨架 coverage 不变量冲突（R4-03） |
| 测试姿态 | 中上 | 新增组合/契约/负缓存用例真实；但 registry CI 不跑测试（R4-08） |
| 门禁 | 部分失效 | 已有 `modules lint` 门禁未接入任何 CI，R4-01 因此漏网 |
| 治理/文档 | 中上 | ADR-045/046 与实现基本一致；ADR-045 的"门禁"表述偏乐观 |

**一句话判断**：ADR-045/046 的代码实现质量高于其治理闭环——判定层去持久化、负缓存独立建表、机制注册表都落得干净；但**模块清单漏声明 `llm`** 且**静态门禁未进 CI**，说明"约束升级为门禁"只完成了一半。

本轮 **P0 0 条、P1 2 条、P2 7 条**。

---

## 4. P0

无。

---

## 5. P1

### R4-01 · 模块清单漏声明 `llm`，已有 lint 门禁报错却未接入 CI

- [newbie.module.json](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/newbie.module.json#L9) 声明 `["evaluation","security"]`，但模块实际 import `@modules/llm`：
  - [security-evaluation-intel-re-ranker.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/intel/security-evaluation-intel-re-ranker.ts#L2-L3)
  - [security-evaluation-intel-model-scope.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/intel/security-evaluation-intel-model-scope.ts#L2)
- 实跑 `modules lint`（devbie CLI 对 57 个模块）：

  ```
  x [security-evaluation] imports '@modules/llm' but does not declare it in moduleDependencies
  ```

  同批另有 `aws-cloudformation`、`tencent-cos` 漏 `security`（模块外，见 §9 备注）。
- 门禁未生效：[registry ci.yml](file:///Users/worldzhy/src/newbie-modules/.github/workflows/ci.yml#L25-L29) 只跑 `format:check` 与 eslint；[nightwatch ci.yml](file:///Users/worldzhy/src/nightwatch-backend/.github/workflows/ci.yml#L57-L88) 跑测试但不跑 `modules lint`。R4-01 因此在两个仓的 CI 中都不会变红。
- 影响：模块闭包不会拉入 `llm`；新宿主单独装配 security-evaluation 时，`@modules/llm` 导入无解析目标，构建失败或依赖宿主恰好已启用 `llm`。nightwatch 现役不受影响（llm 已启用）。
- 暴露面：artifact（已发布模块）+ live（装配副本）。
- 可达性：新宿主装配时；非匿名。
- 修复：`moduleDependencies` 加入 `"llm"`；把 `newbie modules lint` 接入 registry CI（并建议 consumer `apply --check` 后同样执行）。

### R4-02 · 读面 scope 仍完全由客户端决定，OPERATOR 可跨项目读（round3 结转）

- 控制器所有读端点把 `scopeType/scopeId/subjectId` 原样下传：[security-evaluation.controller.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/security-evaluation.controller.ts#L69-L179)。
- 骨架按 query 直接过滤：[evaluation-finding.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/evaluation/evaluation-finding.service.ts#L189-L208)；assets/report 同构。
- 宿主未把 `Evaluation*` 纳入 host scope：[host-scoped-resources.ts](file:///Users/worldzhy/src/nightwatch-backend/src/application/authorization/host-scoped-resources.ts#L13-L26)。
- OPERATOR 持有 "Security Evaluation" 权限组：[permission-groups.ts](file:///Users/worldzhy/src/nightwatch-backend/prisma/seeds/permission-groups.ts#L146-L153)、[L384-L395](file:///Users/worldzhy/src/nightwatch-backend/prisma/seeds/permission-groups.ts#L384-L395)。
- 不变量重验："持有 `List EvaluationFinding` 的 OPERATOR，能否用任意 `scopeId` 读到不属于自己的项目 findings？" —— 能；仅需一个合法 model 权限，无主体归属校验。
- 定级：**P1**（特定权限持有者可达的跨项目读；OPERATOR 为内部角色，故未定 P0）。
- 修复：宿主为 `EvaluationFinding/Run/Result/Asset/Subject` 增加 project scope resolver，或模块在 service 层按调用者主体复核。
- 状态：round3 已列，未修复；本轮不变量重验仍成立。

---

## 6. P2

### R4-03 · `mergeJudgments` 的 skipped 去重 items 与累加 total 违反骨架 coverage 不变量

[merge.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/security-evaluation-judgment-merge.ts#L104-L124) 对 skipped 的 `total` 求和、`items` 用 `Set` 去重；骨架 [mergeBuckets](file:///Users/worldzhy/src/newbie-modules/packages/modules/evaluation/evaluation-invariants.ts#L139-L160) 明确"items 不去重，保证 items.length === total"，并在 [L206-L208](file:///Users/worldzhy/src/newbie-modules/packages/modules/evaluation/evaluation-invariants.ts#L206-L208) 校验。

可执行反例（真实函数）：

```
merged.skipped  = {"total":2,"items":["e-1"],"note":"a: a b: b"}
coverage.skipped= {"total":2,"items":["e-1"],"note":"a: a b: b"}
validateCoverageStats => ["coverageStats.skipped.items lists 1 ids but total is 2"]
```

即：两个机制同时跳过同一证据 id 时，run 会在 coverage 校验处以 400 失败。当前每个 key 只声明一个机制，不可达；但 ADR-046 的目标正是引入第二机制，属于"启用即坏"的契约缺陷。修复：skipped.total 取 `items.size`（或 items 保留多重计数，与骨架约定一致）。

### R4-04 · 负缓存无实体集/模型版本维度，且在硬召回之前过滤

- 唯一键只有 `(knowledgeItemId, scopeKey)`：[schema.prisma](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/prisma/schema.prisma#L140-L152)。
- 采集层在判定前剔除缓存项：[evidence.provider.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/evidence/security-evaluation-evidence.provider.ts#L155-L166)；硬召回因此永远看不到它们。
- 场景：项目新增应用 `nextcloud` 后，旧情报"nextcloud 漏洞"仍以旧实体集下的 `not-relevant` 命中缓存，被直接跳过，不会重新硬召回。
- ADR-045 把"可过期、可清理"列为收益，但未实现任何 TTL/失效键；ADR-018 亦未定义实体集变化的失效语义。
- 修复方向（需产品确认）：缓存键加入实体集指纹或 prompt/model 版本；或把缓存只用于"是否再调 LLM"，硬召回始终先执行。

### R4-05 · 非法 LLM 输出被当作 `not-relevant` 永久缓存

[re-ranker.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/intel/security-evaluation-intel-re-ranker.ts#L163-L185)：LLM 返回输入外实体时整体拒绝并归为 `not-relevant`；[match.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/intel/security-evaluation-intel-match.service.ts#L145-L150) 随即写负缓存。实体标签比较是**大小写敏感**的，模型规范化输出（如 `Next.js` vs `next`）也会被当成"不安全输出"并永久排除该 (item, scope)。
建议：非法/不可信输出返回 `unavailable`（不缓存）；标签比较用大小写不敏感；只有模型明确、合法地判定不相关才缓存。

### R4-06 · INTEL 在 scope 缺失/端口未绑定时静默返回空证据并 SUCCEEDED

[evidence.provider.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/evidence/security-evaluation-evidence.provider.ts#L117-L125) 对无 provider、无 scope、空实体三种情况都返回 `emptyCollection()`；骨架对全零 coverage 不报错（[evaluation-invariants.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/evaluation/evaluation-invariants.ts#L187-L212)），run 以 `SUCCEEDED` 归档"零发现"。
这与模块自身"未绑定端口应让 run 失败而非报告干净"的声明（[security-evaluation.module.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/security-evaluation.module.ts#L59-L63)）不一致。nightwatch 已绑定，故现役不受影响；但 scope 消失（项目归档/删除）会产出假干净报告。
修复：端口缺失或 scope 不存在时抛错（与 repository 锁定文件缺失同构）；实体为空可视为合法空集但需显式 note。

### R4-07 · 知识条目 `summary` 查询后丢弃

[evidence.provider.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/evidence/security-evaluation-evidence.provider.ts#L138-L180) `select.summary` 后未进入 manifest payload；[intel.judgment.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/intel/security-evaluation-intel.judgment.ts#L117-L139) 构造候选时也不填 `summary`。结果：硬召回的 haystack 与 LLM prompt 只看 title，DB 里的 summary 是死数据（既有行为，非本轮引入）。
修复：把 summary 写进 payload 或 evidence item 的独立字段，恢复召回上下文。

### R4-08 · ADR-045 声称的静态门禁在 registry CI 不执行

契约测试本身有效且通过：[contract.test.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/security-evaluation-judgment-layer.contract.test.ts#L28-L35)。但 registry CI 只跑 format/lint（[ci.yml](file:///Users/worldzhy/src/newbie-modules/.github/workflows/ci.yml#L25-L29)），测试仅在 consumer 装配后运行。ADR-045"把约束从文字升级为门禁"的表述在真源仓并不成立。
修复：registry CI 增加 `npm test`（或至少模块级测试）与 `modules lint`。

### R4-09 · 证据预算 oldest-first + 硬命中永不负缓存，候选 >200 时头部永久占位

[evidence.provider.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/evidence/security-evaluation-evidence.provider.ts#L139-L166) 按 `fetchedAt asc, id asc` 取前 200；硬召回命中不会写负缓存，因此每轮都重新进入候选并占用预算。7 日窗口内未缓存候选超过 200 时，新条目持续落在 `overBudget`，与 ADR-018 errata"消除积压饿死"的目标相悖（既有行为）。
修复：预算改为"新条目优先"或对已命中项建立独立的"已评估"游标；至少记录 per-scope 水位。

**P2 归并（轻微）**：`scopeKey` 用 `scopeType:scopeId` 字符串拼接，若宿主 scopeType 含 `:` 会碰撞；契约测试正则未覆盖 `@prisma/client`/`PrismaClient` 直连；测试夹具仍保留旧 `negativeCache` 字段名（仅命名，不影响行为）。

---

## 7. 误报剔除（反驳轮）

| 候选 | 结论 | 理由 |
|---|---|---|
| ADR-045 upsert 并发覆盖 | 撤销 | `(knowledgeItemId, scopeKey)` 唯一键 + `upsert`，并发只会后写覆盖 reason，不丢行 |
| judgment/ 仍依赖 Prisma | 撤销 | 全目录无 Prisma import；适配器在 `persistence/`，静态测试通过 |
| 新 schema 未应用/旧列残留 | 撤销 | 实表存在、旧 JSON 列已删除、既有 100 行 |
| 多机制 metadata 命名空间破坏前端 | 撤销 | 前端/宿主无任何 result.metadata 读取点；属可观测形状变化，不是 live 契约破坏 |
| registry 与装配副本漂移 | 撤销 | `diff -rq` 无差异 |
| `newbie doctor` 提示 security-evaluation 可"更新"到 `7ef7ab4` | 撤销（非模块缺陷） | 安装提交 `ec40ce1` 已被 `origin/dev`（`e44dcb9`）包含；提示来自陈旧 registry 快照。**建议在快照刷新前不要执行该提示的 update**，但这不是本模块 finding |

---

## 8. 已核验通过的不变量

1. **负缓存并发正确性**：唯一键 + upsert；同一 scope 的并发判定不会互相覆盖整行（ADR-045 目标达成）。
2. **负缓存语义**：`unavailable` 不写缓存（[intel-match.service.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/judgment/intel/security-evaluation-intel-match.service.ts#L141-L149)）；缓存命中与证据预算都进入 skipped，且带 items + note（[evidence.provider.ts](file:///Users/worldzhy/src/newbie-modules/packages/modules/security-evaluation/evidence/security-evaluation-evidence.provider.ts#L182-L210)）。
3. **判定层纯化**：`judgment/` 无 Prisma；采集层通过端口读缓存，写侧通过端口写缓存。
4. **机制注册表**：4 个 evaluationKey 全覆盖；`aws-cis-1.5`/`aws-custom` 共享 `aws-config` 已显式；未知 key → 400；缺机制/重名 → fail-fast；机制并行执行。
5. **合并契约**：fingerprint 去重、severity 取高、metadata 只填空值、refs 并集、summary 拼接均有测试覆盖且与 ADR-046 正文一致（skipped 例外见 R4-03）。
6. **装配一致性**：registry↔consumer 无差异，`sourceCommit=ec40ce1`，`localPatches=[]`；`modules.json` 与装配产物一致。
7. **数据库状态**：缓存表存在、FK `onDelete: Cascade`、复合唯一键；100 行实测数据。
8. **构建与测试**：build 通过；全量 546/546；security-evaluation 65/65；doctor 0 error。

---

## 9. 覆盖率清单

**审了**

- ADR-045/046 新增/修改的全部源文件：`judgment-merge`、`mechanism`/`mechanism.registry`、`judgment.service`、负缓存 port + Prisma adapter、intel match/judgment/re-ranker、evidence provider（INTEL 分支）、module 装配、schema。
- 模块 HTTP 面与权限装饰器、manifest、README 变更。
- 相关测试：composition、contract、intel、evidence provider。
- 骨架侧仅读取 `evaluation-runner` / `evaluation-invariants` / `evaluation-finding.service`，用于判定 merge 契约与 scope 不变量。
- 宿主侧：`host-scoped-resources`、`permission-groups` 的 Security Evaluation 绑定。
- 实跑命令见 §2.3。

**没审 / 缺口**

- knowledge adapters 7 个、assets 同步服务、report service、criteria seed、OSV client、其余测试文件未逐行。
- evaluation 骨架作为独立模块未审（超出 scope）。
- 前端未审（不消费模块导出）。
- HTTP/run 级 e2e 未复跑：本轮尝试返回 500（无活服务），不作为结论依据。
- 模块外 lint 错误仅记录：`aws-cloudformation`、`tencent-cos` 漏声明 `security`——建议另开 backlog 项，本轮只读不改。

---

## 10. 修复优先级

1. **R4-01**：补 `llm` 声明 + 把 `modules lint` 接入 CI（最小改动，直接消除"启用即坏"的装配风险）。
2. **R4-02**：读面 scope 落入宿主 host-scoped resolver（跨仓，安全边界）。
3. **R4-03**：在启用第二机制前修正 skipped 计数契约。
4. **R4-04 / R4-05**：先定义负缓存失效语义与"非法输出 = unavailable"，再动代码。
5. **R4-06 / R4-07 / R4-09**：分别对应假干净、召回上下文丢失、预算饿死，均为小范围修正。
6. **R4-08**：registry CI 加测试门禁。

---

## 11. 台账

[findings.md](file:///Users/worldzhy/src/newbie-modules/.trae/documents/findings.md)（本报告同目录），ID `R4-01`…`R4-09`。
