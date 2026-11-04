# Expert Review Round 11 — ADR-033 env 显式化变更集

日期：2026-11-05（Asia/Shanghai）
scope：`modules: [event-emitter, security-evaluation]`，并显式纳入变更集触及的契约面：devbie `newbie-cli`（manifest 校验 + 装配渲染）、nightwatch-backend 宿主消费面（装配产物、deploy/env.template 删除、runbook）、newbie-starter 依赖 bump。排除：web-monitor、xlsx/jdy 等他域在途改动（标 provisional，见 §1）；migrations、dist 生成物未逐行审。

## 1. 锚点

| 仓 | branch | HEAD | dirty | 说明 |
|---|---|---|---|---|
| devbie | dev | af396d6a | 1 | `.trae/documents/backlog.md`（他会话，不重叠本域） |
| newbie-modules | dev | 0701b4a | 8 | web-monitor 与 round8-10 报告为他会话在途，不重叠本域 |
| newbie-starter | dev | ad0c863 | 0 | — |
| nightwatch-backend | dev | f60bbdd | 7（已暂存） | **xlsx/jdy 在途改动触及 `package.json`/`package-lock.json`/`modules.json`** → 「lockfile 携带 CLI 1.16.0」结论标 **provisional**，待其落地后复核 |

评审方法：只读静态评审 + 机械取证（registry↔host `diff -rq`、全仓 grep、锚点矩阵）。并行会话域不重叠，除上表标注外结论非 provisional。

## 2. 结论摘要

变更集（ADR-033：manifest `default`→`example`、运行时删兜底、删 env.template、守卫不变）实施与决策一致，**无 P0/P1**。维度评分：安全 5/5（密钥面未动、守卫语义未弱化）、架构 5/5（单一真源原则贯穿）、契约 4/5（见 R11-01 文档面滞后）、测试 4/5、门禁 5/5、治理 4/5。

## 3. Findings

### R11-01（P2，open）— 运维 skill 仍教授已删除的 env.template 流程

- 仓：worldzhy-knowledge
- 证据：`skills/nightwatch-production-runbook/SKILL.md` L76 —「仓库内 `deploy/env.template` 只存 key 清单，新 key 需同步加入模板」。同仓 `memory/.../nightwatch-backend/project_memory.md` L55 亦将 env.template 描述为文档清单。
- 暴露面：docs/ops（agent 加载该 skill 执行生产操作时）；可达性：任何触发 runbook skill 的会话；可利用性：直接——下次新增 env 键时 agent 可能被引导重建该文件，复活 ADR-033 D4 已消除的漂移源。
- 修复方向：memory-tidy / skills-tidy 把该 skill 与记忆条目对齐 ADR-033（键清单真源 = `.env.example` + `secrets check` 输出），并同步各仓 skill 副本。

## 4. 误报剔除

- **security-evaluation 测试 env 变量未还原**（`security-evaluation-intel.test.ts` 第二个用例设 `NEGATIVE_CACHE_TTL_DAYS=7` 不还原）：`node --test` 默认逐文件独立进程，且后续用例本就依赖该值；不构成缺陷，剔除。
- **CLI 改名破坏公共 API**：`envDefaults` 未从 `newbie-cli/src/index.ts` 导出，dist 与全仓 grep 均无残留引用；剔除。
- **脚手架矛盾**：newbie-starter `deploy/` 无 env.template（ADR-006 产物本就只落宿主），剔除。

## 5. 已核验通过的不变量

1. registry↔宿主两模块逐文件一致（`diff -rq` 空输出）。
2. 全 registry 无 manifest 残留 `"default"`；CLI 对旧字段 fail-fast 且报错文案含改名指引（测试覆盖）。
3. 全仓无代码引用 `deploy/env.template`；README/runbook 引用已清除。
4. `aws-secrets-cli check.ts` 与 `deploy.yml` 零改动——守卫语义与部署流程未弱化，符合 D5。
5. 生产 secret 含两新键；Deploy run 41870707633 全绿；dist 冒烟：缺键构造抛错、设 45 解析为 45。
6. `newbie modules apply` 后 `.env.example` 渲染值 = example（30/7），非生产真值来源，符合 D2 语义。

## 6. 覆盖率清单

审了：两模块 registry 与宿主副本全量、CLI manifest 校验与 env 装配、README/runbook/skill 文档引用、四仓锚点与依赖 pin、生产 Deploy 证据。
没审：web-monitor/xlsx/jdy 在途域、dist 生成物逐行、AWS IAM policy 本体、其它消费仓（无）。

## 7. 修复优先级与台账指针

仅 R11-01（P2）：随下次 memory-tidy 关闭。台账未写 `findings.md`——该文件当前被他会话修改中，避免写入冲突；本条以本报告为凭，关闭时补登。
