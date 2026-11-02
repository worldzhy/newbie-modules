# ADR-045: intel 负缓存的持久化边界与数据模型

状态：已采纳（2026-10-31）
日期：2026-10-31
归属：框架层（newbie-modules registry，`packages/modules/security-evaluation`）
关联：registry ADR-037 D9.4（judge 只吃 evidence）、ADR-039（threat-intel 并入）、ADR-018（负缓存语义）

## 背景

INTEL 判定把 LLM "不相关"结论记为负缓存，键为 `scopeType:scopeId`，值是该 scope 下的不相关理由；"unavailable" 结论永不缓存。当前实现有两处依赖：

- 读取：`evidence/security-evaluation-evidence.provider.ts` 查询 `SecurityEvaluationThreatKnowledgeItem.negativeCache`，把命中该 scope 的候选项排除并计入 `skipped`。
- 写入：`judgment/intel/security-evaluation-intel-match.service.ts` 注入 `PrismaService`，读该行 `negativeCache`、合并后回写。

这带来三个问题：

1. **依赖方向**：判定层（领域策略）直接依赖 Prisma，违反 registry ADR-037 D9.4 的"judge 只吃 `input.evidence`"，且该约束目前只能靠人工复核，无法自动拦截。
2. **数据模型**：`negativeCache` 是一个按 scope 增长的无界映射，被塞进知识行的 JSON 列。它与知识本身生命周期不同——缓存可过期、可清理，知识行不该因此变形。
3. **写入正确性**：读-改-写非原子，并发 scope 判定可能互相覆盖。

## 候选方案

### A. 什么都不做，只在 ADR 里声明例外

零改动。但"判定层不得依赖持久化"退化为文字约定：新机制、新判定器仍可继续注入 Prisma，评审或 CI 无法识别。不可验证即不可追溯。

### B. 仅端口化，保留 JSON 列

判定器改为依赖写回端口 `recordNegativeVerdict(itemId, scopeKey, reason)`，适配器在模块内做读-改-写；evidence provider 继续读知识行的 JSON 列。

依赖方向修正了，但数据模型仍是错的：无界映射、无唯一键、无级联语义、读-改-写仍非原子。

### C. 端口化 + 独立缓存表（建议）

把负缓存从知识行剥离为独立模型：

```prisma
model SecurityEvaluationThreatNegativeCache {
  id              String   @id @default(uuid()) @db.Uuid
  knowledgeItemId String   @db.Uuid
  scopeKey        String   @db.VarChar(512)
  reason          String   @db.Text
  updatedAt       DateTime @updatedAt
  knowledgeItem   SecurityEvaluationThreatKnowledgeItem @relation(fields: [knowledgeItemId], references: [id], onDelete: Cascade)

  @@unique([knowledgeItemId, scopeKey])
}
```

判定层依赖一个端口（读侧给采集层、写侧给判定层），适配器独占 Prisma；同时删除 `ThreatKnowledgeItem.negativeCache` 字段。

## 决策

建议 **C**。决定性理由：**缓存不是知识**。它与知识行的生命周期、增长方式、清理策略全部不同，把两个生命周期绑在一张表的 JSON 列上，任何一侧的演进都会污染另一侧；唯一键 `(knowledgeItemId, scopeKey)` 还顺带把并发覆盖问题变成数据库层面的 upsert 语义。nightwatch 未上线（记忆「系统上线状态」），schema 直接改模型 + `prisma db push` 对齐，不写 migration，"迁移成本"不构成论据。

B 只是把依赖藏起来，数据模型的问题原样保留；A 否认了约束的可验证性。

## 跨宿主 / 演进检验

负缓存是 LLM 判定的副产品，语义与宿主无关；`scopeKey` 由 `subject.scopeType/scopeId` 组成，不含 nightwatch 业务词汇。端口与模型都随 registry 模块走，换宿主后行为一致，无需宿主实现任何适配器。

## 影响

- 采集层（evidence provider）由"读知识行 JSON"改为"查缓存表的 scopeKey 集合"，逻辑变简单。
- 判定层移除 `PrismaService`，测试改用内存 fake 端口，不再需要数据库夹具。
- 新增一条静态契约测试：`judgment/` 目录下任何文件不得 import `PrismaService`（与 login-audit-coverage 的静态扫描同一手法），把约束从文字升级为门禁。
- 负缓存从此可以独立清理（按 `updatedAt` TTL），不影响知识保留策略。

## 实现切面（按顺序）

1. `prisma/schema.prisma`：新增 `SecurityEvaluationThreatNegativeCache`，`SecurityEvaluationThreatKnowledgeItem` 增加反向关系并删除 `negativeCache` 字段；`prisma db push` 对齐（未上线，直接改模型）。
2. `judgment/intel/security-evaluation-intel-negative-cache.port.ts`：定义 `SecurityEvaluationIntelNegativeCachePort`——`filterUncached(scopeKey, knowledgeItemIds)`（读侧，供采集层）与 `record(itemId, scopeKey, reason)`（写侧，供判定层），token 常量同现有 ports 风格。
3. `persistence/security-evaluation-intel-negative-cache.repository.ts`：Prisma 适配器，`record` 用 upsert（依赖唯一键）。适配器放在 `judgment/` 之外，否则与第 6 条的静态门禁自相矛盾——判定层目录必须能被无条件扫描为“零 Prisma 依赖”。
4. `evidence/security-evaluation-evidence.provider.ts`：改为注入端口，用 `filterUncached` 得到候选集与 `cachedIds`。
5. `judgment/intel/security-evaluation-intel-match.service.ts`：删除 `PrismaService`，改为注入端口写回。
6. 测试：`security-evaluation-intel.test.ts` 用内存 fake 端口；新增静态契约测试覆盖第 3 条影响。
7. 宿主：无改动（端口与模型均由 registry 模块拥有）。
