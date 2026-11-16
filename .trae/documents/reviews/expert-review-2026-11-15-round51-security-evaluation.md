# Expert Review — round51：`security-evaluation`（module scope）

- scope：`modules: [security-evaluation]`
- 评审主仓：`newbie-modules`（模块真源）
- 报告类型：时点快照，写完不改写；后续状态变化由 findings 台账承载

## 1. 锚点

评审窗口：2026-11-15（Asia/Shanghai）。结束时刻 `2026-11-15T18:58:50+0800`（锚点复核命令 `date "+%Y-%m-%dT%H:%M:%S%z"`）。开始时刻未单独落盘（流程瑕疵，如实记录）。

| 仓 | branch | HEAD（结束复核） | 工作树 | 说明 |
| --- | --- | --- | --- | --- |
| newbie-modules | dev | `392bdff` | 0 dirty | 评审期间从 `64f2c3f` 前进到 `392bdff`（并行会话提交 alert-center round50：`71b6106`、`392bdff`）；`git diff --stat 64f2c3f..392bdff -- packages/modules/security-evaluation` 为空，被审域无变化 |
| nightwatch-backend | dev | `2e6910a` | 1 dirty：`?? solidcore-admin-report-2026-11-13.pdf` | 评审期间从 `8a7325f` 前进到 `2e6910a`（并行会话 alert-center：`2e6910a`）；`git diff --stat 8a7325f..2e6910a -- src/modules/security-evaluation src/application/evaluation src/application/security-evaluation prisma/models/security-evaluation.prisma prisma/migrations` 为空；PDF 未跟踪、不属被审域 |
| nightwatch-frontend | dev | `f4c6482` | 0 dirty | — |

并行会话：两处 HEAD 前进均为 alert-center（round50）域，不落在 `security-evaluation` 域；被审域结论不标 provisional。**评审偏差披露**：本 reviewer 在同一会话更早时段实现过 ADR-070（协议 §8 反模式"评审与修复同会话"）。补偿：关键结论全部执行取证（含独立执行探针），static 结论不定 P0/P1。

## 2. 范围与方法

- 解析范围：`newbie-modules/packages/modules/security-evaluation`（77 个文件，`find packages/modules/security-evaluation -type f | wc -l`）；装配面 `nightwatch-backend/src/modules/security-evaluation` + `prisma/models/security-evaluation.prisma` + 新迁移 + 宿主消费代码（`src/application/evaluation/project-subject.provider.ts`、`src/application/security-evaluation/**`、scan job、read-model、web-origin controller）；前端 `nightwatch-frontend` 中 8 个 SE 文件（`grep -rl "security-evaluation\|SecurityEvaluation" src --include=*.tsx --include=*.ts | grep -v _gen | wc -l`）。
- 排除：`newbie-starter`、`fewbie-starter`、`nightwatch-world` 的 `newbie-modules.json` 均无 `security-evaluation`（逐仓 grep，输出 `(not declared)`），明确排除。
- 方法：风险域分区（认证/租户·归属/数据·契约/前端/治理）+ 模式扫描（controller 权限装饰器、Unchecked*、raw SQL、`default-secret`/日志、HTTP 出网、前端 `startsWith("/")`/`decodeURIComponent`/`dangerouslySetInnerHTML`/`target="_blank"`/`router.push`/`useIsAdmin`）。执行路：容器 `66b958b39256`（宿主无 node），仓库挂载 `/home/worldzhy/src/<repo>`；活库 `nightwatch-backend-postgres` / `nightwatch_next`。
- ADR-070 专项：自然键解析与大小写、ingest upsert 幂等、素材 kind 与 `subjectKey` 回显、无跨 schema FK、controller 权限、宿主反查歧义、迁移与 schema 一致、前端 i18n 完整性。
- 失败/重跑：首次用 `npx jest` 跑 `*.test.ts` 出现 `security-evaluation-cloud-config-rulebook.test.ts` 失败（`node:test` 未被 jest 识别）；改用仓库运行器 `node --import tsx --test` 后全绿（见 §7 误报剔除）。

## 3. 结论摘要 + 维度评分

| 维度 | 分（1–5） | 依据 |
| --- | --- | --- |
| 安全 | 3 | 1 条 P1：web-origin 注册缺归属校验（项目 EDITOR 可认领他项目已验证 origin 并覆盖平台级配置） |
| 架构 | 4 | ADR-070 落地与决策一致；素材表无宿主词汇、无跨 schema FK；宿主三个 Access 已退化为纯 provider 调用 |
| 契约 | 4 | 自然键/幂等/回显校验有测试；ingest 未限定 `kind` 白名单（R51-02） |
| 测试 | 4 | 模块 9 suites / 120 用例绿（宿主 provider 单测另 8 条，合计 128）；ingest 幂等与大小写归一被覆盖；web-origin 重复注册覆盖语义无测试 |
| 门禁 | 5 | backend build+format、registry format、frontend lint+format 全绿（§8 附命令） |
| 治理 | 4 | ADR-070 与实现一致、ADR-037 已标注取代、README 素材表已更新；活库残留 E2E 夹具（R51-06） |

无 P0。P1 × 1，P2 × 5。

## 4. P0

无。

## 5. P1

### R51-01（nightwatch-backend）web-origin 注册不校验归属：项目 EDITOR 可认领他项目已验证 origin，并覆盖平台级 origin 配置

- 仓：nightwatch-backend（宿主消费 SE 模块导出符号）
- 可达性：项目级 `EDITOR`（`scope-role-permission.matrix.ts:163-172` 中 `SecurityEvaluationWebOrigin.Create/Update = PROJECT_ROLE_RANK.EDITOR`），ADMIN/OWNER 同样可达；不需要对 origin 归属项目有任何角色
- 暴露面：live（`diff -rq` 零差异；`_prisma_migrations` 中 `20261115102141_security_evaluation_material_catalogue` 已应用）
- 影响：跨项目写（把他人项目已验证 origin 挂到自己项目 scope、改变其 `environment`/`targetPaths` 共享配置），正确性/归属破坏
- 可利用性：直接（一次 `POST /projects/{ownProjectId}/web-origins`，origin 填他项目已注册的同一 origin）

证据链：

1. `register` 只做权限校验，随后直接 `webOrigins.create()` + `projectWebOrigin.upsert`，全程不读该 origin 现有归属：`src/application/security-evaluation/web-origin.controller.ts:44-60`；同文件 `assertOwnedByProject` 只被 `detail`/`verify` 使用（`:80` 起），`register` 未用。
2. 模块 `create()` 对同一 subjectId 走 `upsert`，`update` 分支覆盖 `environment` 与 `targetPaths`：`packages/modules/security-evaluation/assets/security-evaluation-web-origin.service.ts:156-168`。
3. 宿主唯一约束只禁止同项目重复：`prisma/schema.prisma` `model ProjectWebOrigin` 主键 `(projectId, subjectId)`，不禁止同一 subjectId 被多个 projectId 引用（活库 `ProjectWebOrigin` 计数 0，约束由 schema 定义）。
4. 权限矩阵注释本身写明预期不变量："A project registers the origins it **owns**"（`src/application/authorization/scope-role-permission.matrix.ts:161-162`）——注释宣称的归属守卫在代码中不存在。

执行证据（环境断言：容器 `66b958b39256`，`/home/worldzhy/src/nightwatch-backend` @ `2e6910a`，工作树仅未跟踪 PDF；探针位于 `/tmp`，不写入仓库）：

```
$ node --import tsx /tmp/probe-claim.ts
upsert called: {"where":{"projectId_subjectId":{"projectId":"project-B","subjectId":"subject-owned-by-project-A"}},"create":{"projectId":"project-B","subjectId":"subject-owned-by-project-A"},"update":{}}
register result: {"subjectId":"subject-owned-by-project-A","webOriginId":"wo-1","origin":"https://app.example.com","verificationStatus":"VERIFIED","verificationToken":"token"}
ownershipRead before attach: false
```

（探针用真实 controller 类 + mock Prisma/模块服务：以 `project-B` 调用 `register`，返回的是归属 `project-A` 的 VERIFIED subject；`projectWebOrigin` 从未被查询归属。）

可达角色的执行证据：

```
$ psql -d nightwatch_next -tAc "select g.name||'|'||gp.action||'|'||gp.resource from \"module/account\".\"PermissionGroupPermission\" gp join \"module/account\".\"PermissionGroup\" g on g.id=gp.\"permissionGroupId\" where gp.resource ilike '%EvaluationSubject%' order by 1;"
All|Create|EvaluationSubject
All|Delete|EvaluationSubject
All|Get|EvaluationSubject
All|List|EvaluationSubject
All|Update|EvaluationSubject
Security Evaluation|Create|EvaluationSubject
Security Evaluation|Delete|EvaluationSubject
Security Evaluation|Get|EvaluationSubject
$ psql -d nightwatch_next -tAc "select g.name||'|'||r.name from \"module/account\".\"RolePermissionGroup\" rg join \"module/account\".\"PermissionGroup\" g on g.id=rg.\"permissionGroupId\" join \"module/account\".\"Role\" r on r.id=rg.\"roleId\" where g.name in ('All','Security Evaluation') order by 1;"
All|ADMIN
Security Evaluation|ADMIN
Security Evaluation|MEMBER
$ psql -d nightwatch_next -tAc "select role, count(*) from application.\"ProjectMember\" group by 1;"
OWNER|1
```

（MEMBER 经系统组持有 SE 全动作；但 web-origin 路由是 host-scoped，实际拦截按项目级 rank 判定，故可达角色记"项目 EDITOR"。当前活库只有 1 个项目、1 个 OWNER，跨项目场景尚无存量数据受害。）

复现路径：项目 A 注册并验证 `https://app.example.com` → 项目 B 的 EDITOR 对同一 origin 调 `POST /projects/B/web-origins` → 模块 `create` 把该 origin 的 `environment/targetPaths` 改写为 B 提交值 → 宿主新增 `(B, subjectA)` 行 → 之后 `listWebOriginSubjects(B)`（`project-subject.provider.ts`）把 A 的已验证 origin 纳入 B 的扫描，`projectIdsOfSubject` 同时返回 A、B。
修复方向：`register` 前先查 `projectWebOrigin` 是否已存在 `subjectId` 且 `projectId` 不同，存在即拒绝（或要求显式转移）；模块侧 `create()` 应把"已有 origin 的配置更新"与"新注册"拆开，避免非归属方覆盖。

## 6. P2

**ingest 契约**

- R51-02（newbie-modules）`ingest` 不校验 `kind` 白名单。`prepareSubmission` 对未知 kind 走 else 分支，直接用客户端字符串建 subject（`security-evaluation-asset.service.ts:267-320`），而常量白名单已存在（`security-evaluation.constants.ts:9-13`）。后果：任意持 `Create EvaluationSubject` 的用户（MEMBER/ADMIN）可造出目录里的"幽灵资产"（报告 `assetTotal` 计入、无任何 project 归属）；前端 add-asset 对话框直接暴露 `web-origin` 选项（`add-asset-dialog.tsx`），该 kind 经 ingest 创建时不写 `SecurityEvaluationWebOrigin` 行、不经过验证，`listActiveVerified` 永不返回它。
- R51-03（newbie-modules）`aws-account` 重放 ingest 会清空 `defaultRegion`。`prepareSubmission` 恒把 `defaultRegion` 归一为 `string | null`（`:302`），update 分支的守卫 `defaultRegion !== undefined`（`:136`）因此恒真，未携带区域的提交会把已有值写成 `null`；同分支 `regions` 却是"未提供则保留"（`:137`）。语义不一致，且守卫是死代码。
- R51-04（newbie-modules）http origin 的 `WELL_KNOWN` 验证恒失败。`normalizeWebOrigin` 显式接受 `http:`（`security-evaluation-web-origin.service.ts:363-364`），但挑战描述与验证抓取都硬编码 `https://${host}`（`:337`、`:428`），`http` origin 只能走 DNS_TXT。

**宿主健壮性**

- R51-05（nightwatch-backend）`project-subject.provider.ts` 对 `Repository.fullName` 非"两段"时经 `repositoryCoordinateOf` 抛 `BadRequestException`（`:120`），并使 `listSubjects`（`:242`）、`subjectIdsOfProject`（`:292`）、read-model 归属回读整体中断。当前唯一写入路径 `repository-link.ts:96-110` 保证两段，属防御性缺口；库内手工/历史脏行即触发该项目 SE 面 400。

**数据卫生（非代码）**

- R51-06（nightwatch-backend，活库）ADR-070 的 E2E 夹具未清理：`module/evaluation."EvaluationSubject"` 仍有 `aws-account|123456789012|aws-binding:fixture` 与 `repository|github:worldzhy/devbie`，素材表有 `github|worldzhy|devbie`、`123456789012|us-east-1|2 regions`，而宿主 `application."Repository"`=0、`Project`=1、`ProjectWebOrigin`=0。目录里因此有 2 个无项目归属的孤儿资产，`aws-binding:fixture` 还会出现在"不可评估"清单。

## 7. 误报剔除

1. **"rulebook 单测红"**：首跑 `npx jest src/modules/security-evaluation/...` 报 `security-evaluation-cloud-config-rulebook.test.ts` `deepStrictEqual` 失败。根因是用错运行器（该仓测试是 `node:test`，jest 只做了转译），`node --import tsx --test` 下 9 suites/120 用例全绿。剔除：线束错误，非仓库缺陷。
2. **"多个项目共享同一 origin 是设计意图，故不构成缺陷"**（反驳代理提出）：ADR-044 §1 / `host-scoped-resources.ts:30-32` 确称 origin 资产平台级；裁决：平台级资产不等于任意项目 EDITOR 可改写其共享配置或单方面扩张消费者集合——权限矩阵注释"registers the origins it owns"表明归属校验是既有意图。P1 保留。
3. **"ingest 不强制 aws-account 的 credentialRef"**：报告已把无 `credentialRef` 的 aws 主体显式标为不可评估（`reporting/security-evaluation-report.service.ts:149`），属显式契约而非静默错误。剔除。

## 8. 已核验通过的不变量

1. 装配一致：`diff -rq packages/modules/security-evaluation nightwatch-backend/src/modules/security-evaluation` → `exit=0`（无输出）。
2. 渲染产物与真源 schema 一致：`diff prisma/models/security-evaluation.prisma .../prisma/schema.prisma` 仅 3 行托管头差异。
3. 迁移与 schema 一致：`20261115102141_security_evaluation_material_catalogue/migration.sql` 的列/唯一约束/数组字段与模型逐项对应；两张素材表均无 FK（跨 schema 禁止）。
4. 迁移已落地：`_prisma_migrations` 含该文件名且 `finished_at` 非空；`module/security-evaluation` schema 下两张表存在。
5. 自然键端到端：活库 subject `repository|github:worldzhy/devbie` 全小写，素材行 `github|worldzhy|devbie`；`aws-account|123456789012` 与素材 `123456789012` 同键。
6. ingest 幂等与大小写归一被测试覆盖（`security-evaluation-asset-ingest.test.ts`：重复提交同键只产生一行、大小写归一、同仓库多项目上报）。
7. `subjectKey` 回显严格：kind 与素材不匹配或回显不一致即 400（`prepareSubmission` 的 `assertSubjectKeyMatches` 路径）。
8. 宿主三个 Access（repository / repository-snapshot / aws-config）不再读宿主 `Repository` 表；`aws-config-access.ts` 额外校验 `credentialRef` 解析出的 accountId 与 `subjectKey` 相等。
9. 模块全部端点均带 `@RequirePermission`（`security-evaluation.controller.ts`：subjects/ingest/knowledge/report 各端点；web-origin controller 由宿主提供且同样带装饰器）。
10. web-origin 侧不变量：`normalizeWebOrigin` 拒绝凭据/path/query/fragment、去尾点、host 小写；`normalizeTargetPaths` 拒绝未知角色与 `//` 开头路径；`detail`/`verify` 有 `assertOwnedByProject`。
11. 前端 i18n：add-asset 使用的 22 个 key 在 `src/i18n/messages/{en,zh}.json` 全部存在（逐 key `grep -c`，22/22 双语非零）。
12. 前端模式扫描：SE 的 8 个文件中 `startsWith("/")`、`decodeURIComponent`、`router.push`、`window.open`、`location.*`、`dangerouslySetInnerHTML`、`target="_blank"`、`useIsAdmin` 零命中；unguarded 权限门不存在（SE 仅 ADMIN/MEMBER 可达，二者均持全组权限，前端无需分档）。
13. 报告对空 `subjectIds` 有短路（`security-evaluation-report.service.ts` 各方法 `length === 0` 早返回），raw SQL 全部用 `Prisma.join` 参数化。
14. 治理：ADR-070 的 D1/D2/D3 与 schema、ingest、宿主实现一致；ADR-037 状态行已标注"由 ADR-070 取代 Layer 1 的 repository subjectKey"；模块 README 素材表已写自然键（`README.md:17-18`）。
15. 装配 pin：`nightwatch-backend/newbie-modules.json` 根 `sourceCommit = 64f2c3f89eb7…`，与 SE 真源内容一致（`64f2c3f..392bdff` 未触及 `packages/modules/security-evaluation`）。注：registry HEAD 已被并行会话推进到 `392bdff`，pin 落后两个 alert-center 提交，会导致 `newbie modules apply --check` 报漂移——属 alert-center 域遗留，不记入本轮 SE findings。
16. 门禁（均在 2026-11-15 于容器执行）：
    - `npm run build`（nightwatch-backend @ `2e6910a`）→ `nest build` 通过
    - `npm run format:check`（backend / registry / frontend）→ `All matched files use Prettier code style!` ×3
    - `npm run lint`（frontend @ `f4c6482`）→ 通过（仅 2 条与 SE 无关的既有 warning）
    - `node --import tsx --test src/modules/security-evaluation/*.test.ts` → suites 9 / pass 120 / fail 0；加 `src/application/evaluation/project-subject.provider.test.ts` → pass 128 / fail 0

## 9. 覆盖率清单

审了：
- 模块：`security-evaluation.controller.ts`、`security-evaluation.dto.ts`（ingest/目录 DTO）、`assets/security-evaluation-asset.service.ts`、`assets/security-evaluation-subject-coordinate.ts`、`assets/security-evaluation-web-origin.service.ts`、`reporting/security-evaluation-report.service.ts`、`prisma/schema.prisma`、`newbie.module.json`、ingest/web-origin 测试。
- 宿主：`project-subject.provider.ts`、`project/applications/repository-subject.ts`、`repository-link.ts`、`repository-access.ts`、`repository-file-access.ts`、`repository-snapshot-access.ts`、`aws-config-access.ts`、`web-origin.controller.ts`、`scheduled-jobs/tasks/security-evaluation.scan.job.ts`、read-model / project-security-profile 的归属回读路径、`prisma/migrations/20261115102141_*`、`prisma/models/security-evaluation.prisma`。
- 前端：SE 页面、add-asset 对话框、i18n 双语文件、apits 生成类型（ingest 请求）。
- 数据：活库 `_prisma_migrations`、两张素材表、`EvaluationSubject`、`ProjectWebOrigin`、`ProjectMember`、权限组/角色映射。

没审/仅浅扫（下一轮建议）：
- `judgment/` 判定规则细节与 `criteria` 内容（只做了模式扫描，未逐条语义评审）。
- `knowledge/adapters/**` 的出网实现（仅 grep `fetch/axios/http` 与 timeout 模式，未逐文件读）。
- `security-evaluation-code-scan-excerpt` 的收紧/脱敏路径（未逐文件）。
- migrations 回滚路径、ClickHouse 相关（SE 本期仅 PG）。
- `web-origin-verification-fetch-access.ts` 宿主出网策略（ADR-044 §2）只读了签名与调用点。

## 10. 修复优先级

1. R51-01（P1）：`register` 增加归属校验；模块 `create()` 拆分"更新共享配置"与"首次注册"。
2. R51-02（P2）：ingest 拒绝白名单外 kind；web-origin 经 ingest 时要求已有验证记录或直接禁止该路径。
3. R51-03（P2）：`aws-account` 的 `defaultRegion` 改为"未提供则保留"，并补一条重放测试。
4. R51-04（P2）：`WELL_KNOWN` 按 origin 自身协议生成抓取 URL（或明确只支持 https 并拒绝 http 注册）。
5. R51-05（P2）：`repositoryCoordinateOf` 失败降级为"仅该行不可归属"并记警告，不中断整个项目。
6. R51-06（P2）：清理活库 E2E 夹具（`123456789012` / `github:worldzhy/devbie` 及其素材行）。

## 11. 台账指针

- 模块侧（newbie-modules `.trae/documents/findings.md`）：R51-02、R51-03、R51-04。
- 宿主侧（nightwatch-backend `.trae/documents/findings.md`）：R51-01、R51-05、R51-06。
- 上一轮（round50，alert-center）无 P0/P1 需 carry-over；round49 的 R49-01（P1）不在本模块域，维持 open，未在本轮重验。
