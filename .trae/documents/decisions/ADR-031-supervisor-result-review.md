# ADR-031: result 终审（supervisor review）纳入骨架决策面

状态：已采纳
日期：2026-10-26

> 归属：evaluation 骨架决策面增量 → 本仓。关闭 ADR-030 的遗留观察（"骨架无 supervisor 对 result 的终审端点；确有需求时补进 decision surface，属增量 ADR"）。决策面边界由 ADR-029 划定，本次在同一控制器内补 result 终审动作；涉及骨架 schema 增列与宿主装配，故在本仓留档。

## 背景

EvaluationResult 是不可变结论快照（ADR-020 D5.1）：manifest / contentHash / verdicts 无 update 路径。但"结论不可变"与"人对结论的裁决"是两层语义——AI 判了什么（快照）与 supervisor 认不认（终审）。快照不可改不等于终审状态不存在。

work-evaluation（ADR-021）读面已把 result 暴露给前端，supervisor 看完 AI 结论后需要一个显式的认可/否决动作；当前这一裁决只能离线表达，无归因、无落库、不可追溯。骨架三类聚合中，finding 有 suppress/reopen、remediation plan 有 decision，唯独 result 没有人的决策动作——决策面不对称。

## 候选方案

- **A review 列放 result 行 + 骨架决策面端点**：result 行增 reviewStatus / reviewedByRef / reviewedAt / reviewNote 四列（均可空），骨架新增 `POST /evaluation/results/:id/review`。结论快照字段仍零 update 路径，review 是叠加的生命周期层，允许改判（覆盖归因随写覆盖）。
- **B 独立 review 历史表（result 1:N review）**：留全量改判历史。问题：终审语义是"当前裁决"，当前裁决看 result 行即可；历史价值低，还引入"最新一条才生效"的读放大；未上线系统禁止预建。
- **C 宿主 feature 层实现**：work-evaluation 自己加 review 表/端点。问题：result 是骨架聚合，各 feature 重复实现同一终审语义，违反决策面单一归属（ADR-029）；security-evaluation（ADR-022）接入时还得再来一遍。

## 决策

选 **A**：

1. **schema**：新 enum `EvaluationResultReviewStatus`（APPROVED = 认可 / REJECTED = 否决）；`EvaluationResult` 增可空列 `reviewStatus` / `reviewedByRef`（opaque scalar，无 FK）/ `reviewedAt` / `reviewNote`。manifest / contentHash / coverageStats / verdicts / summary 依旧无 update 路径——service 唯一新增的写路径只碰 review 四列。
2. **端点**：`POST /evaluation/results/:id/review`，body `{ reviewStatus, note? }`，权限 `Update:EvaluationResult`，`reviewedByRef` 自动取 `request.user.userId`（与 suppress / plan decision 同归因模式：执行者自动记录，无需请求方声明）。允许 re-review 覆盖（跟随 reopen 的双向转换先例，终审不是单向锁）；每次 review 是全量状态写——note 省略时连同旧 note 一起清空，行内永远只反映最新一次裁决。
3. **service**：`EvaluationResultService.reviewResult` —— result 是它自己的聚合，方法归 result service；`RESULT_SELECT` 增列，全部既有读面免费带回 review 状态。

未上线不产 migration：schema 改完 `prisma db push` 对齐，历史数据可弃。

## 跨宿主检验

- 骨架零宿主词汇：`reviewedByRef` 是 opaque scalar 无外键；权限按 Prisma 模型名动态派生，宿主权限体系自动覆盖新动作，无需 seed。
- 双向可逆（可改判）意味着 feature 读模型无需状态机锁；security-evaluation 未来接入零改动。
- work-evaluation 前端在 result 展示处直连骨架端点即可，无需 feature 后端中转。
- review 不约束 run 状态：FAILED run 带有效 result 是合法自洽状态（README 已声明），supervisor 对它同样可裁决。

## 影响

- registry：schema 增列增 enum、result service 增 `reviewResult`、decision controller/dto 增端点、module 与 README 的决策面描述同步、新增行为测试 `evaluation-result-review.test.ts`。
- 宿主（nightwatch-backend）：apply 装配 + `prisma db push`（PG 增列）+ apits 重生成（swagger 新端点）。
- ADR-030 遗留观察关闭；ADR-029 的决策面清单由两项扩为三项。
