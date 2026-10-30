# ADR-030: people-evaluation 废弃与 worklog 证据链迁移

状态：已采纳
日期：2026-10-26

> 归属：registry 模块存废决策 + devbie worklog CLI 契约迁移 → 本仓。承接 ADR-029 决策点 D3（people-evaluation 摘除暂缓）的解冻：其前置条件——worklog CLI 迁移到 `/work-evaluation/evidence/*`——在本 ADR 中一并定稿。people-evaluation 的模块定义在本仓 `packages/modules/people-evaluation/`（registry 包），装配产物在宿主 nightwatch-backend；废弃涉及 registry 定义与宿主装配产物两层，故在本仓留档。

## 背景

people-evaluation 是骨架系 features（work-evaluation ADR-024、security-evaluation ADR-022）落地之前的 evaluation 实现：自带 rubric versions / periods / home-ground / PIP plans 词汇、deterministic evidence builder、agent runner 与 fact sources，evidence ingest 走 `/people/evidence/*`（devbie `packages/worklog` CLI 是唯一上报端）。

work-evaluation 落地后，骨架已提供同等且更通用的事实底座：installation token ingest（ADR-016 认证）、session 索引（PG）+ transcript（CH）、workspace/document 声明层、run/criteria/finding/remediation 全生命周期。两套 evaluation 并行装配于 nightwatch-backend，worklog CLI 仍向旧通道推证据——ADR-029 评审确认了这是结构性重复。

2026-10-26 专家评审结论：**evaluation 骨架（ADR-020 系）的必要性与优雅性足够**，people-evaluation 的存在理由已被接管；系统未上线（无真实用户/业务数据），历史证据数据可丢弃。

## 候选方案

- **A 直接废弃**：worklog CLI 切到 `/work-evaluation/evidence/*` 并发版；backend 整体摘除 people-evaluation（模块 + application 层 + prisma 模型 + CH 表 + 权限 seed），历史数据随删，不重写、不迁移。
- **B 保留实现摘除路由**：people-evaluation 作为"runner/agent/fact sources 的实现参考"留在代码库，只摘 HTTP 面。问题：无调用方的代码是负资产，"参考"价值由 git 历史承载即可，不值得支付双套 evaluation 并存的认知成本。
- **C 在骨架上重写 people 词汇**：把 rubric/period/PIP 搬进骨架或新 feature。问题：产品方向已由骨架系 features 承载，people 词汇当前无消费方；未上线系统禁止为"未来可能的需求"预建结构。

## 决策

选 **A**：

1. **worklog CLI（devbie `packages/worklog`）1.5.0 → 1.6.0**：三个 POST 路径 `/people/evidence/workspaces|sessions|documents` 切到 `/work-evaluation/evidence/*`。payload 与 work-evaluation 契约逐字段兼容（message role 小写匹配 `WorkEvaluationMessageRole`；documents 的 description 为可选），仅端点变更；credentials 文件格式 `{endpoint, token}` 与模块解耦，config/profile 代码零改动；现有测试断言调用行为而非 URL，无需改动。发版走 `npm publish --tag latest`（1.x 线 minor 递增）。
2. **people-evaluation 整体摘除（registry + 宿主两层）**：registry 侧删除 `packages/modules/people-evaluation/` 模块定义；宿主侧移除 `src/modules/people-evaluation/`（装配产物）、`src/application/people-evaluation/`（runner/agent/fact sources）、`application.module.ts` 装配、`modules.json` 装配记录、`models/people-evaluation.prisma` 与 schema.prisma 的 `module/people-evaluation` schema 声明、`people_evaluation_*` ClickHouse 表；prisma 按「未上线禁 migration」规则用 `db push` 对齐，CH 表直接 DROP，PG 历史数据随删。权限记账由 Prisma 模型名动态派生，删模型即随之消失。
3. **安装面切换**：本机 worklog installation 通过 `/work-evaluation/installations` enroll 新 token 并 `worklog --profile` 应用；旧 `/people/evidence/*` 通道随模块摘除消失。

## 跨宿主检验

- registry 定义删除后，任何宿主都无法再装配 people-evaluation；work-evaluation / security-evaluation 等骨架 features 不受影响（它们是独立的 registry 包）。
- worklog CLI 是通用证据上报端，端点选择由其自身契约决定；任何宿主装配 work-evaluation 即可获得同一 ingest 面，CLI 对宿主零耦合。
- 旧版 worklog（≤1.5.0）向 `/people/evidence/*` 上报将 404：在役安装仅本机一处，随 enroll 切换闭环，无兼容层。

## 影响

- registry 移除 `packages/modules/people-evaluation/`（约 15 个源文件 + prisma/ + clickhouse-migrations/ + README），模块从 manifest 消失；git 历史承载全部实现参考价值。
- backend 移除 1 个模块面（`/people/*` 全部路由 404）、1 组 prisma 模型、1 组 CH 表；`GET /people/rubrics/active` 等管理员面随之消失，frontend apits 重生成清理生成产物与残留文案。
- 权限模型删除 `PeopleEvaluation*` 对象记账，不影响骨架共享权限口径（ADR-029 决策 3）。
- 已知缺口（不预建）：骨架无 supervisor 对 result 的终审端点；确有需求时补进 decision surface，属增量 ADR。
