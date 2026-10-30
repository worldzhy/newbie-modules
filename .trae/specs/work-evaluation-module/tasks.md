# Tasks: work-evaluation 模块落地

依据 `spec.md`（同目录）。执行顺序即下列顺序。

## Phase 1 — registry 模块实现（21 文件）

- [x] 1.1 `newbie.module.json` + `prisma/schema.prisma` + `clickhouse-migrations/V20261026120000__init_work_evaluation_tables.sql`
- [x] 1.2 移植组：`work-evaluation-installation.service.ts`、`work-evaluation-installation-token.resolver.ts`、`work-evaluation-session.store.ts`、`work-evaluation-evidence.service.ts`
- [x] 1.3 `work-evaluation-period.service.ts`（criteria 校验走骨架）
- [x] 1.4 纯函数：`work-evaluation-judgment.prompt.ts`、`work-evaluation-redaction.ts`（需重读 nightwatch-backend `src/application/people-evaluation/evaluation.agent.ts` / `redaction.ts` 取精确移植源）
- [x] 1.5 判定组：`work-evaluation-judgment.tools.ts`、`work-evaluation-judgment.service.ts`（需重读 `evaluation-tools.ts` / `evidence.builder.ts`）
- [x] 1.6 端口绑定组：`work-evaluation-criteria.provider.ts`、`work-evaluation-evidence.provider.ts`、`work-evaluation-run.service.ts`（façade）
- [x] 1.7 `work-evaluation.dto.ts` + 三 controller + `work-evaluation.module.ts`（需重读 `people-evaluation.dto.ts`）
- [x] 1.8 `README.md` + 两个纯函数测试

## Phase 2 — registry 验证与提交

- [x] 2.1 一次性容器 `npm run format:check` + 两个新测试 + invariants 回归
- [x] 2.2 people-evaluation README 冻结横幅（ADR-021 D1）
- [ ] 2.3 显式路径提交（骨架 5 文件 + ADR-023/024 + work-evaluation 全部 + 冻结横幅 + 本 spec 目录）→ HTTP/1.1 直推 dev → fetch 核对

## Phase 3 — 装配到 nightwatch-backend

- [ ] 3.1 刷新容器 registry 缓存 → `modules add work-evaluation -y` → `NEWBIE_MODULES_REF=origin/dev modules update -y --force`
- [ ] 3.2 手写 PG migration（6 表）+ CH migration → `migrate deploy` + `generate`
- [ ] 3.3 `tsc --noEmit` + `nest build` + 重启 + 冒烟 + apits 重生成
- [ ] 3.4 backend 显式路径提交（不碰 module-hub 在途文件）→ 推送 → fetch 核对
