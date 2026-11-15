# ADR-069 评估主体按功能归属：`subjectType` 与三元组身份

状态：已采纳（2026-11-15 用户批准）
日期：2026-11-15

> 归属：registry 契约变更（`packages/modules/evaluation` 的表结构与端口形状）→ 本仓。宿主实施（注册点、资产目录过滤、PG 迁移、前端生成类型）归 nightwatch-backend，随本决策同步改造。

修订：ADR-068 D1「身份 = `(kind, subjectKey)`」扩展为 `(subjectType, kind, subjectKey)`；ADR-068 其余结论（删除 scope 坐标、资产/归属表下线、运行只按 `subjectId` 挂载）保持生效。

## 背景

`evaluation` 骨架被 `security-evaluation` 与 `work-evaluation` 共用同一张 `EvaluationSubject`。资产的 `kind` 描述「对象是什么」（`repository` / `aws-account` / `web-origin` / `developer`），并不描述「哪个功能拥有它」。

后果已经可见：security-evaluation 的资产页直接读 `GET /security-evaluation/subjects`，把 work-evaluation 注册的 `developer` 主体一并列出，资产目录、分页总数都混入了不属于该功能的主体。

靠「按 kind 白名单过滤」能暂时绕开，但归属只存在于各功能的常量集合里：一旦两个功能共享一个 kind（例如将来 work-evaluation 也评估 `repository`），同一 `(kind, subjectKey)` 会被合并成一行，归属被最后一次写入覆盖，两个功能互相污染。归属需要成为显式数据，而不是写入方的约定。

## 决策

1. `EvaluationSubject` 增加 `subjectType String @db.VarChar(64)`，表示提交该主体的功能键。模块不枚举、不校验取值，由功能自己声明；本仓两个功能分别使用 `security-evaluation` 与 `work-evaluation`。
2. 身份改为 `@@unique([subjectType, kind, subjectKey])`。同一 kind 在不同功能下是彼此独立的主体，各自的 run / result / finding / 知识项互不共享。
3. `EvaluationSubjectDescriptor` 与 `EvaluationSubjectRef` 携带 `subjectType`；`getOrCreateSubject` 按三元组 upsert。
4. 读路径 `listSubjects` 支持 `subjectType` 过滤；security-evaluation 的资产目录固定传入自己的功能键，其余查询同样按功能键收口。
5. 存量迁移按 kind 回填：`developer` → `work-evaluation`，其余 → `security-evaluation`（本次上线前只有这两个写入者）。

## 候选方案

- **A 仅按 kind 白名单过滤**：零 schema 变更，但归属只存在于约定中，kind 重叠即失效，且每个读模型都要重复一份白名单。
- **B 给 kind 加命名空间前缀**（`security:repository`）：归属显式，但破坏现有 wire 值、规则集的 `subjectKind` 与已发布规则版本，迁移面远大于新增一列。
- **C（采纳）新增 `subjectType` 并纳入唯一键**：归属显式、身份自洽，新增列与唯一键替换都是一次性迁移。

## 影响

- registry：`EvaluationSubject` 表结构、两个契约形状、`EvaluationSubjectService` 的 upsert 与列表过滤、相关测试字面量。
- 宿主：两个功能的注册点带上功能键，security-evaluation 资产目录按功能键过滤，`ProjectSubjectProvider` 枚举出的描述符补上功能键，生成一条 PG 迁移并回填存量，`npm run apits` 重新生成前端类型。
- 模块仍然不认识宿主实体：`subjectType` 是功能键（registry 模块名），不是宿主业务词汇，符合模块准入标准。
- 代价：唯一键从二元组变三元组，所有按 `(kind, subjectKey)` 直接 upsert 的代码与测试要同步；数据本身只需一次 `CASE` 回填。
