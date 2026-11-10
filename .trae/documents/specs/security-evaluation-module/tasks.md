# Tasks: security-evaluation 模块落地

依据同目录 `spec.md`。执行顺序即下列顺序；决策 1–3 确认前不进入 Phase 1。

## Phase 0 — 决策与 ADR 收口

- [x] 0.1 确认决策 1（subject 粒度）、决策 2（规则目录落点）、决策 3（第一切片）
- [x] 0.2 决策确认后：ADR-022 状态 `提议中` → `已采纳`；若决策 2 选 A，追加 Errata 说明 D7 的 `Rule` 表由 `EvaluationCriterion.metadata` 承载

## Phase 1 — registry 模块实现（切片 1：资产 + DEPENDENCY）

- [x] 1.1 `newbie.module.json` + `prisma/schema.prisma`（Asset / AssetFact）
- [x] 1.2 纯函数：`security-evaluation-lockfile.ts`、`security-evaluation-severity.ts`、`security-evaluation-urgency.ts`
- [x] 1.3 资产层：`assets/security-evaluation-asset.service.ts`、`assets/security-evaluation-asset-sync.service.ts`、`ports/repository-access.port.ts`
- [x] 1.4 准则层：`criteria/security-evaluation-criteria.seed.ts`、`criteria/security-evaluation-criteria.provider.ts`
- [x] 1.5 证据层：`evidence/security-evaluation-evidence.provider.ts`
- [x] 1.6 判定层：`judgment/dependency/security-evaluation-osv.client.ts`、`judgment/dependency/security-evaluation-dependency.judgment.ts`、`judgment/security-evaluation-judgment.service.ts`
- [x] 1.7 报告与传输层：`reporting/security-evaluation-report.service.ts`、`security-evaluation.dto.ts`、`security-evaluation.controller.ts`、`security-evaluation.module.ts`、`security-evaluation.constants.ts`
- [x] 1.8 `README.md`（词汇、subject 约定、factType 清单、端口绑定、调度声明、覆盖率桶口径）+ 三个纯函数测试

## Phase 2 — registry 验证与提交

- [x] 2.1 一次性容器内 `npm run format:check` + 三个新测试 + `evaluation-invariants` 回归
- [x] 2.2 显式路径提交（本模块全部文件 + ADR-022 状态/Errata + 本 spec 目录）→ HTTP/1.1 直推 dev → fetch 核对远端落地（`ba1f9e4`）

## Phase 3 — nightwatch-backend 装配（另排期，不在本里程碑收口）

- [x] 3.1 宿主实现 `SubjectProvider` + `RepositoryAccessPort`（复用 github 模块）— `src/application/security-evaluation/`（ProjectRepositorySubjectProvider / GitHubRepositoryAccess / wiring module）
- [x] 3.2 刷新容器 registry 缓存 → `modules add security-evaluation -y` → `NEWBIE_MODULES_REF=origin/dev modules update -y --force`（装配后与 registry diff 为空，pin 37c8a18）
- [x] 3.3 `prisma db push` + `generate`（不生成 migration 文件）→ `tsc --noEmit` → `nest build` → 重启（BUILD_EXIT=0，`/security-evaluation/assets` 401 即路由已注册）
- [x] 3.4 行为级测试：finding 生命周期（`evaluation-finding-lifecycle.test.ts`）、覆盖率口径（OSV 失败降级 `security-evaluation-dependency-judgment.test.ts` + lockfile 缺失/旧版/零包 `security-evaluation-evidence.provider.test.ts`）、run 并发 409（`evaluation-run-concurrency.test.ts` 服务级 + HTTP 实测 202→409）。同里程碑把 `EvaluationRunnerService` 拆为 `open`/`execute`/`run`，让 admission 在请求路径内答复 400/404/409
- [x] 3.5 `npm run apits` 重生成前端 API（0 处 any，前端 tsc 0）；三仓显式路径提交 + 推送 + fetch 核对：registry `dc53541`、backend `60caec2`、frontend `0ed2f29`

## Phase 4 — 后续切片（各自里程碑再确认）

- [x] 4.1 切片 2：CLOUD_CONFIG 判定器 + CIS 规则目录收敛 + 宿主 compliance 读模型。按 ADR-027 与 slice-2-cloud-config.md 交付：registry `0a265a2`、backend `d3caf8c`；E2E 真实 AWS 账号 run SUCCEEDED，134 facts、skipped=0、145 findings（`aws:cis-<control>:<resource>`），报告接口六轴齐；过程中发现 bucket 串行采集超时缺陷并以有界并发修复（宿主层）
- [ ] 4.2 切片 3：knowledge/ 采集 + INTEL 判定器（ADR-018 护栏原样保留）
- [ ] 4.3 切片 4：多轴报告（合规 / 情报 / 趋势 / MTTR）+ 整改绑定 + 通知模板
- [ ] 4.4 切换与旧模块处置：由用户单独决策，不在本 spec 范围。当前决策见 ADR-036（D1-B 并轨、等价闸门三项）；旧模块删除单独立项
- [x] 4.5 骨架 run 生命周期事件：按 ADR-032 在骨架声明 `evaluation.run-succeeded` / `evaluation.run-failed`，runner 终态落库后唯一发射，宿主按 ADR-028 决定激活（registry `be919c1` / backend `d68bc96`；`evaluation-runner-events.test.ts` 6 项行为测试绿，宿主未激活事件目录属预期）
- [x] 4.6 切片 2.6：非 CIS 自定义规则族 `aws-custom`（10 条）+ 采集契约扩展（3 个新 factType + 4 个 payload 扩展）+ 骨架 `family → evaluationKey` 改名 + per-draft severity + policy-as-finding-unit + coverage 按 requiredFactTypes + 共享采集 freshness。按 ADR-033 + ADR-037 交付；合规轴按 evaluationKey 过滤。registry `75454ff`+`ad17969`+`2c4db2a`+`8492c8f`、backend `e100da4`+`b4b31a7`+`21d1755`；E2E 真实 AWS 账号双 run 均 SUCCEEDED（cis-aws-1.5 90s 全量采集，aws-custom 5s 命中 1h freshness 缓存），findings 按 evaluationKey 独立分布（cis 159 OPEN / custom 57 OPEN），旧指纹 72 条自动 RESOLVED，finding 生命周期正常
