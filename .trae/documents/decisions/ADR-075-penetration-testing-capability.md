# ADR-075: penetration-testing —— 在 evaluation 骨架上承载 L1–L4 主动安全测试

状态：已采纳（2026-11-21；编号取 registry 历史最大号 074 + 1）
日期：2026-11-21
更新：2026-11-21 — 四项待拍板已定：L1/L2 周扫、所有成员可发起申请（审批归 ADMIN）、`environment` 放 target material、扫描隔离用 Docker socket-proxy + 每次容器（宿主侧见 ADR-049）。同日按「env 不得有默认值」原则把目标 CIDR 从部署 env 收进授权记录（`allowedCidrs`）；L3 明确为受控利用层（宿主侧加入 sqlmap 只读模式），并补「严重性口径」。L4 定为 **B′：平台执行固定 playbook**（团队没有 L4 人工操作能力，专家流程必须固化进平台），新增 `PenetrationTestingTestObject` 与独立破坏性动作端口。评审后收敛契约：全部 criterion 为 `ASSERTION`；`standardKey` 走 `judgmentConfig`；L4 增加跨 level 互斥；`PenetrationTestingExecution` 在 `collect` 内立即写；`KILLED` / `CLEANUP_FAILED` 只落 feature；删除 `manual-finding`（骨架没有人工创建 finding 的入口）。

> 归属：本仓只定 registry 契约（subject kind、evaluation key、material 表、端口形状、criteria/finding 语义）。宿主如何归属资产、如何启动临时容器与出网代理、引擎集与许可，见 nightwatch-backend ADR-049。跨仓引用写双编号。
>
> 关系：复用 ADR-020 的 evaluation skeleton、ADR-068/ADR-069 的 subject 身份 `(subjectType, kind, subjectKey)`、ADR-046 的 judgment mechanism 注册、ADR-053 的「策略值是代码常量」；沿用 ADR-066 的「模块不发起网络请求」与「kind 说评估什么、key 说用什么规则集」。不取代任何既有 ADR。

## 背景

nightwatch 已能对自己管理的客户项目做安全检查（`security-evaluation`：依赖、源码、AWS 配置、情报、Web 外部姿态），但这些能力全部是**被动或只读**的。客户要求的是「以攻击者视角证明风险」：端口与服务暴露、可被利用的漏洞、以及漏洞是否真的能被利用。

现状取证（均为本仓代码）：

- evaluation 骨架的 subject 身份是 `(subjectType, kind, subjectKey)`（`packages/modules/evaluation/prisma/schema.prisma:147-171`），`kind` 是普通 `VarChar(64)` 而非数据库枚举，新增 kind 不需要迁移 evaluation 表。
- 四个端口按 kind 绑定：`criteriaProviderToken(kind)`（`evaluation/ports/criteria.provider.ts:12`）、`evidenceProviderToken(kind)`（`ports/evidence.provider.ts:16`）、`judgmentPortToken(kind)`（`ports/judgment.port.ts:19`）。token 是**全局字符串**，与 `subjectType` 无关。
- `SecurityEvaluationModule` 是 `@Global()`，已绑定 `criteriaProviderToken("web-origin")`（`security-evaluation/security-evaluation.module.ts:85-86`，kind-scoped 绑定在文件尾部）。
- 主动请求的执行边界已有先例：`WebProbeAccess` 只声明观测形状与预算，出网、SSRF、超时、并发全部由宿主实现（`security-evaluation/ports/web-probe.access.ts:1-56`）；未绑定端口时 run 以 wiring error 失败（`security-evaluation.module.ts:68-83`）。
- 归属验证（DNS TXT / `.well-known`、30 天重验、连续 3 次失败置 `FAILED`）已有可复用模式：`security-evaluation/assets/security-evaluation-web-origin.service.ts` 与 `ports/web-origin-verification-access.port.ts:1-17`。

因此不需要新建一套 run/finding/报表生命周期，也不需要自研扫描器。要决定的是：这套主动能力放在哪个模块、用什么主体身份、授权模型如何表达、宿主如何安全地执行。

## 候选方案

| 方案 | 做法 | 影响面 |
| --- | --- | --- |
| A | 在 `security-evaluation` 内加 kind 与 key | 最小改动，但 `criteriaProviderToken("web-origin")` 已被占用；若强行复用 kind 会与既有全局绑定冲突。两类能力的授权语义（被动观测 vs 主动攻击）、失败语义、证据留存也完全不同 |
| B | 新建独立 feature 模块 `penetration-testing`，复用 evaluation 骨架 | 多一个模块与一组 material 表；run/result/finding/报表全部复用，授权与执行边界独立演进 |
| C | 自研扫描引擎（自己写端口扫描、爬虫、漏洞检测） | 等价于重写 ZAP/nuclei/naabu，且要长期维护规则库；能力与误报率都不如成熟引擎 |
| D | 只做外购 SaaS 扫描，平台不落地 | 无代码；但客户项目的授权、结果、修复闭环留不在平台内，无法与既有 finding 生命周期对齐 |

取 **B**，扫描执行交给成熟开源引擎（宿主 ADR-049）。

决定性理由不是「模块化更漂亮」，而是 **DI token 的命名空间**：骨架按 `kind` 绑定三个全局 token，`SecurityEvaluationModule` 已经占用了 `web-origin`。第二个功能若复用同一 kind，要么 duplicate provider、要么后注册者静默覆盖前者的 criteria/evidence/judgment。这是运行时正确性问题，不是分层偏好。

## 决策

### 1. 独立 feature 模块与 subject kind

```ts
export const PENETRATION_TESTING_SUBJECT_TYPE = "penetration-testing";
export const PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET = "web-target";
```

- subject 身份仍是 `(subjectType, kind, subjectKey)`，所以即使 kind 字符串与别的功能相同也不会串行；但为了让三个全局 token 不撞，kind 必须独立取 `web-target`。
- `subjectKey` = 规范化 origin（`scheme://host[:port]`），规则与 ADR-066 §1 逐条一致：scheme/host 小写、IDN → punycode 去尾点、省略默认端口、拒绝路径/查询/片段、不加末尾斜杠。本模块自己实现该归一化（不依赖 `security-evaluation`），因为两个模块之间没有 `requires` 关系；同一 origin 在两个模块得到同一个 key 是期望行为，不构成共享身份。
- 平台级作用域：固定 `scopeType = "platform"`、`scopeId = "deployment"`，与 repository / aws-account / web-origin 的写入路径一致。项目归属是宿主归属表，不进模块（ADR-068 D8）。
- 一个 origin 一个 subject：L1–L4 是同一对象的四种测试强度，不拆 kind、不拆 subject。

**为什么不是 `web-origin`**：除了 token 冲突，语义也不同。`web-origin` 的判定对象是「外部可观测姿态」，输入是固定、无凭据、有界的读请求；`web-target` 的判定对象是「能否被攻破」，输入是主动扫描、漏洞验证与人工渗透。两者的 evidence 预算、授权前置、失败语义（被 WAF 拦截 vs 网络不可达）、证据留存要求都不同，混在一个 key 里会让 criteria 版本与授权审计失真。

### 2. 四级能力模型与 evaluation key

| Level | evaluation key | 自动化执行 | 审批要求 | 环境限制 | 副作用边界 |
| --- | --- | --- | --- | --- | --- |
| L1 侦察 | `attack-surface` | 端口/服务/TLS 观测 | RoE 覆盖 L1 | 任意 | TCP connect 到声明端口、GET/HEAD、TLS 握手；无参数注入 |
| L2 非破坏扫描 | `vulnerability-scan` | 非破坏性主动扫描 | RoE 覆盖 L2 | 任意 | 不改变服务状态的探测；不写入、不删除、不触发外发通知 |
| L3 漏洞验证 | `exploit-verification` | 受控利用验证（只读利用） | 每次审批，绑定 findingId + attackClass | 任意 | 证明可利用即止；不留后门、不持久化、不横向移动、不批量导出数据 |
| L4 破坏性测试 | `destructive-testing` | 平台执行固定 playbook（受控破坏性验证） | 每次动作审批，绑定 playbook + 测试对象 | 仅 `NON_PRODUCTION` + 维护窗口 | 只作用于登记的测试对象；playbook 自带清理与验证；不外发通知、不可逆副作用 |

具体引擎由宿主选择（ADR-049 §4），模块只约束副作用边界与证据形状。

- L4 走**独立的破坏性动作端口**（单动作、带清理步骤），不复用批量扫描端口：L1–L3 的调用路径在类型上就够不到破坏性动作。`destructive-testing` 的 evidence provider 调该端口，并把动作前后状态、清理结果作为证据。
- L3 是「自动化 + 逐条审批」：一条 L2 finding 被选中做验证时，审批行绑定 `{ findingId, attackClass }`，扫描器只允许执行该 class 的验证模板（注入类用只读 technique，不允许写操作）。
- 新增 key = 新 criteria 版本 + 新模块版本，不改已发布版本（ADR-037）。

### 3. material 表

`PenetrationTestingTarget`（`@@schema("module/penetration-testing")`，`subjectId String @unique @db.Uuid`，无跨 schema 外键）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `subjectId` | `Uuid @unique` | 指向 `module/evaluation`.`EvaluationSubject`，标量，无 FK |
| `environment` | `VarChar(16)` | `PRODUCTION` / `NON_PRODUCTION`；L4 门禁的输入 |
| `declaredPorts` | `Int[]` | 允许扫描的端口；为空时按 scheme 取 80/443 |
| `targetPaths` | `Json @default("{}")` | 路径角色 → 相对路径，角色白名单见 §6 |
| `verificationStatus` | `VarChar(16)` | `PENDING` / `VERIFIED` / `FAILED` / `REVOKED` |
| `verificationToken` | `VarChar(64)` | 归属验证 token |
| `verificationMethod` | `VarChar(16)?` | `DNS_TXT` / `WELL_KNOWN` |
| `verificationFailureCount` | `Int @default(0)` | 连续失败计数 |
| `verifiedAt` / `lastVerifiedAt` | `DateTime?` | 验证时间 |
| `isActive` | `Boolean @default(true)` | 停用即退出评估 |
| 时间戳 | | `createdAt` / `updatedAt` |

`PenetrationTestingAuthorization`（授权/RoE 记录）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `subjectId` | `Uuid` | 标量，无 FK |
| `level` | `VarChar(32)` | `L1` / `L2` / `L3` / `L4` |
| `status` | `VarChar(16)` | `PENDING` / `APPROVED` / `REVOKED` / `EXPIRED` |
| `roeDocumentRef` | `VarChar(512)` | 已签署授权书的**不透明引用**，正文留在宿主文档系统 |
| `scopeNote` | `Text?` | 授权范围说明 |
| `requestedBy` / `approvedBy` | `VarChar(128)` | 不透明操作者 id；审批与申请必须是两个不同的人 |
| `approvedAt` / `revokedAt` / `revokeReason` | | 审批与撤销轨迹 |
| `validFrom` / `validUntil` | `DateTime` | 授权有效期；过期即 `EXPIRED`，门禁拒绝 |
| `allowedCidrs` | `String[]` | 本次授权允许的目标地址范围；为空表示「仅要求公网」，非空时执行快照必须 ⊆ 该集合 |
| `findingId` | `Uuid?` | L3 必填：被验证的 finding |
| `attackClass` | `VarChar(64)?` | L3 必填：允许的攻击类 |
| `maintenanceWindow` | `Json?` | L4 必填：`{ start, end, timezone }` |

`PenetrationTestingTestObject`（L4 可破坏测试对象）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `subjectId` | `Uuid` | 标量，无 FK |
| `kind` | `VarChar(16)` | `RECORD` / `ACCOUNT` / `FILE` / `PATH` |
| `locator` | `Json` | 对象定位：`{ table?, id? }`、`{ account? }`、`{ path? }`；playbook 用它限定作用域 |
| `cleanupLocator` | `Json?` | 清理动作需要的定位信息；为空表示 playbook 用 marker 自清理 |
| `disposable` | `Boolean` | 必须为 `true` 才允许 L4；登记人声明该对象可被破坏，由另一名 ADMIN 审批确认 |
| `approvedBy` / `approvedAt` | | 测试对象必须经过审批，且 `approvedBy ≠ createdBy`；审批只授予 ADMIN |
| `createdBy` / `createdAt` | | 登记人；与审批人分离 |
| `expiresAt` | `DateTime` | 过期即失效，避免一次性对象被长期复用 |
| `updatedAt` | `DateTime` | |

- L4 门禁要求：`environment = NON_PRODUCTION`、维护窗口内、授权 `level = L4`、**存在匹配的 `disposable + 未过期 + 已审批` 测试对象**；任一缺失即拒绝。
- playbook 只能在测试对象声明的 locator 内动作；locator 之外的写操作一律拒绝。

`PenetrationTestingExecution`（每次自动化扫描或 L4 动作的审计快照）：

- `auditId Uuid @unique`、`runId Uuid? @unique`、`subjectId`、`level`、`authorizationId`、`snapshot Json`（解析到的 IP、端口、hostname、引擎/playbook 版本、代理策略 id）、`startedAt`、`finishedAt?`、`outcome`（`SUCCEEDED` / `FAILED` / `KILLED` / `CLEANUP_FAILED`）、`requestCount`、`killedAt?`、`killReason?`。
- **`auditId` 与 `runId` 的分工**：骨架的 `EvidenceProvider.collect(subject, ruleSetVersion, runConfig)` 不接收 `runId`，因此 feature 在 `judgmentConfig` 中预生成 `auditId`（同时用作幂等键），evidence provider 在 collect 内按 `subjectId + ruleSetVersionId` 查询同版本的 `RUNNING` 骨架 run 回填 `runId`。进程若在 open 与 collect 之间死亡，`runId` 为空，`auditId` 仍把快照与骨架 run 对上。
- **写入时机**：在 evidence provider 内、扫描/动作结束的同一流程里立即写（含 `auditId`、`runId`、`snapshot`、`outcome`、`requestCount`）；终态（`finishedAt`、`KILLED`/`CLEANUP_FAILED`）在 `finally` 补齐。不能等 run 结束再写——动作已完成但 judgment 抛错或进程被杀时，骨架不会留下任何执行记录。
- **与骨架状态的关系**：`EvaluationRunStatus` 只有 `QUEUED` / `RUNNING` / `SUCCEEDED` / `FAILED`，没有 `KILLED`。`KILLED` 与 `CLEANUP_FAILED` 只写本表 `outcome`；骨架 run 记 `FAILED` 并写 `failureReason`，两者靠 `auditId`（`runId` 回填后亦然）关联。
- `snapshot` 是「执行时实际扫了谁」的唯一权威记录，不能由事后补写。

### 4. 授权模型（fail-closed）

三层，缺一即拒绝启动，**没有关闭开关**（与 `security-evaluation` 的 `requireVerification` 不同）：

1. **归属验证**：DNS TXT `_nightwatch-verify.<host>` 或 `https://<host>/.well-known/nightwatch-verification.txt`。参数与 ADR-044 §2 相同：30 天惰性重验、连续 3 次失败置 `FAILED`、token 32 字节 base64url。只有 `VERIFIED + isActive` 的目标进入评估。
2. **书面授权**：`PenetrationTestingAuthorization` 行必须 `APPROVED`、在 `validFrom`–`validUntil` 内、未撤销，且覆盖本次 `level`；L3 还必须精确匹配 `findingId` 与 `attackClass`；L4 还要求 `environment = NON_PRODUCTION`、当前时间落在 `maintenanceWindow` 内，且存在匹配的 `disposable + 未过期 + 已审批` 测试对象与已登记 playbook。
3. **执行时快照**：宿主适配器在启动任何容器前重新解析目标域名、要求所有地址为公网（复用 `url-check/public-url.ts` 的 `assertPubliclyResolvable` 语义），并要求快照 ⊆ 授权行的 `allowedCidrs`（该列为空时只要求公网）。快照写入 `PenetrationTestingExecution.snapshot`。解析结果不在授权范围、或出现 RFC1918 / loopback / link-local / `169.254.169.254` → 直接失败，不发起任何请求。

门禁落在 `PenetrationTestingRunService.startRun` 一处（对齐 `security-evaluation-run.service.ts:51-60,77-96` 的「唯一入口」写法），所有调用方（手工 `POST /runs`、周扫 job、未来调度器）都必须经过它。

- **跨 level 互斥**：骨架的唯一索引只锁 `(subjectId, ruleSetVersionId)`，四个 key 是四个 version，天然可以并发。本模块必须自己补一条：L4 启动要求该 subject 不存在任何其他 key 的 `QUEUED` / `RUNNING` run；L4 活跃期间拒绝同 subject 的其他 key。否则破坏性写入会与主动扫描同时发生，「单动作 + 清理」的安全论证不成立。
- **`runConfig` 不可信**：`judgmentConfig` 是调用方可传的 opaque JSON，骨架原样存储并传给 criteria / evidence / judgment。它只表达「请求意图」；`playbookId`、`testObjectId`、`authorizationId` 必须由门禁按 `subjectId` 重新读授权行与测试对象行校验，evidence provider 再按 `runId` 回读已审批行执行。不得从 `runConfig` 直接取授权结论。
- **subject 创建**：`POST /targets` 用骨架的 `EvaluationSubjectService.getOrCreateSubject(descriptor, tx)`（接受事务客户端），与 material 行同事务写入；不直接 insert `EvaluationSubject`。

### 5. 扫描端口

```ts
export const PENETRATION_TESTING_SCANNER_ACCESS = "PENETRATION_TESTING_SCANNER_ACCESS";

export interface PenetrationScannerAccess {
  scan(request: PenetrationScanRequest): Promise<PenetrationScanResult>;
}
```

- 请求只含**目标语义**：归一化 origin、声明端口、路径角色、level、`standardKey`、审批引用、预算。不含引擎名、镜像、代理地址——这些是宿主实现细节。
- **run 入参契约**：骨架的 `StartEvaluationRunInput` 只有 `subjectId`、`ruleSetVersionId?`、`requestedBy?`、`judgmentConfig?`。四个 key 共享 `web-target` kind，所以 `standardKey` 必须落进 `judgmentConfig.standardKey`（`selectVersion` 据此分派），或调用方显式传 `ruleSetVersionId`；两者都缺时 `selectVersion` 返回 `null` → 400。L4 另在 `judgmentConfig` 带 `playbookId` 与 `testObjectId`。
- 预算超出时 evidence provider 必须让 run `FAILED`（写 `failureReason`），不得返回「部分成功」的结果。
- 结果只含**引擎中立的观测**与**原始引擎发现**：`{ execution: { snapshot, engineVersions, requestCount, outcome }, observations, findings }`。`findings[]` 至少含 `engine`、`engineVersion`、`ruleId`、`ruleName?`、`severityRaw`、`title`、`detail?`、`location`、`evidenceRefs`。
- 端口只声明形状与预算，不做网络 I/O、不持有 URL 白名单、不解析 DNS（与 `web-probe.access.ts:1-15` 同一纪律）。
- 未绑定端口而跑 L1–L3 的 run → wiring error（沿用 `security-evaluation.module.ts:68-83` 的失败语义），不得产出「干净」结果。
- **L4 不调用该端口**，走独立的破坏性动作端口：

```ts
export const PENETRATION_TESTING_DESTRUCTIVE_ACTION_ACCESS =
  "PENETRATION_TESTING_DESTRUCTIVE_ACTION_ACCESS";

export interface PenetrationDestructiveActionAccess {
  execute(request: DestructiveActionRequest): Promise<DestructiveActionResult>;
}

export interface DestructiveActionRequest {
  target: PenetrationTargetDescriptor;
  playbookId: string;
  playbookVersion: string;
  testObject: PenetrationTestObjectDescriptor;
  authorizationRef: string;
  marker: string;            // 本次动作的唯一标记，用于定位与清理
  budget: PenetrationActionBudget;
}

export interface DestructiveActionResult {
  execution: PenetrationExecutionSnapshot;
  before: string;            // 动作前状态摘要
  after: string;             // 动作后状态摘要
  cleanup: { attempted: boolean; succeeded: boolean; detail?: string };
  evidenceRefs: string[];
  outcome: "SUCCEEDED" | "FAILED" | "KILLED" | "CLEANUP_FAILED";
}
```

- 端口要求宿主只执行**已登记 playbook**：请求里没有任意命令、脚本或 payload 字段；`marker` 只能是随机字符串，用于在测试对象内定位。
- `CLEANUP_FAILED` 是独立终态：run FAILED、告警、并暂停该目标的后续 L4，直到人工确认。
- playbook 目录是**代码常量**（版本化、评审过），不是数据库可编辑内容；新增 playbook = 新模块版本。

playbook 目录（初始四个，均为「在测试对象内留下 marker、验证、再清理」的单动作）：

| playbookId | 验证的问题 | 测试对象 kind | 动作 | 清理 |
| --- | --- | --- | --- | --- |
| `sqli-write-proof` | 注入能否写入数据（不只读） | `RECORD` | 在授权表/字段写入带 marker 的行，读回比对 | 删除 marker 行；失败即 `CLEANUP_FAILED` |
| `upload-proof` | 任意文件上传能否落地执行 | `PATH` | 上传带 marker 的无害文件到指定目录 | 删除该文件并校验目录清单 |
| `stored-xss-proof` | 存储型 XSS 能否持久化并回显 | `RECORD` | 在授权字段写入 marker payload，请求回显页验证 | 恢复字段原值 |
| `cmd-injection-proof` | 命令注入能否执行 | `PATH` | 在授权目录创建 marker 文件（不执行任意命令，只写文件） | 删除 marker 文件 |

- 每个 playbook 只有参数化的 locator 与 marker，不含可替换的命令行；执行内容在 runner 镜像内固定，模块只传 `playbookId` + `playbookVersion`。
- 每个 playbook 必须声明 `disposableTestObjectKinds`，门禁据此校验测试对象 `kind` 是否匹配。

预算常量（ADR-053：策略值进代码，不进 manifest env）：

| Level | maxRequests | maxDuration | maxConcurrency | maxRps |
| --- | --- | --- | --- | --- |
| L1 | 2,000 | 600s | 2 | 10 |
| L2 | 20,000 | 3,600s | 1 | 5 |
| L3 | 5,000 | 1,800s | 1 | 2 |
| L4 | 50（单动作 + 清理验证） | 300s | 1 | 1 |

数值是初始取值，调整即新模块版本；宿主的出网代理是实际执行者，模块常量只是上限声明。

### 6. criteria 与 finding 映射

criteria 是**能力面**，不是单条引擎规则。nuclei 有数千条模板，若一条模板一个 criterion，规则集无法维护。

| criterionKey | kind | 覆盖 | 级别来源 |
| --- | --- | --- | --- |
| `exposed-service` | ASSERTION | 声明端口上非预期服务/版本横幅 | 引擎 |
| `certificate-issue` | ASSERTION | 过期、自签、主机名不匹配、弱密钥 | 确定性判定 |
| `technology-disclosure` | ASSERTION | Server / X-Powered-By / 错误页版本泄露 | 确定性判定 |
| `tls-weakness` | ASSERTION | 协议/套件弱点（复用既有 TLS 观测口径） | 确定性判定 |
| `security-misconfiguration` | ASSERTION | ZAP 被动/安全主动规则 | 引擎 |
| `vulnerable-component` | ASSERTION | 版本比对与 CVE 模板 | 引擎 + CVSS |
| `injection` | ASSERTION | 注入类规则 | 引擎 + CVSS |
| `broken-access-control` | ASSERTION | 访问控制类规则 | 引擎 + CVSS |
| `exposed-sensitive-file` | ASSERTION | 敏感文件/备份/调试端点 | 引擎 |
| `confirmed-exploit` | ASSERTION | L3 验证成功 | 引擎 + PoC 证据 |
| `destructive-impact` | ASSERTION | L4 playbook 成功造成并清理了受控破坏 | 引擎 + 前后状态 |
| `unclassified` | ASSERTION | 未映射到上述任一类的引擎发现（catch-all，ADR-020 D5.2 不允许静默丢弃） | 引擎 |

- 全部 criterion 都是 `ASSERTION`：每个事实一条 finding，便于去重、抑制与趋势。L1 的覆盖度由骨架 `coverageStats` 表达，不设 `SCORED` 总分；未来若要总分，新增 `SCORED` criterion 并同时定义权重与 verdict 形状，属于新 criteria 版本。
- 引擎规则 → criterion 的映射是模块内的**确定性数据表**（按 `engine + ruleId` 与 `engine + tag` 两级匹配），不是 LLM 判定。
- fingerprint：`sha256(criterionKey + "\u0000" + engine + "\u0000" + ruleId + "\u0000" + locationKey)`，与仓内既有 identity helper 的 `sha256(parts.join("\u0000"))` 惯例一致。`locationKey` 取归一化后的 `url|ip:port|path+parameter`。subjectKey 不进哈希（finding 唯一键已含 subjectId）。
- severity：优先使用引擎提供的 CVSS（≥9.0 CRITICAL、7.0–8.9 HIGH、4.0–6.9 MEDIUM、0.1–3.9 LOW、0 INFO）；无 CVSS 时按引擎标签映射（Critical/High/Medium/Low/Info）。不允许 LLM 重新定级。
- **严重性口径**：CVSS 是基线，证据级别决定是否上调，但破坏性不参与计算。
  - E1（L1/L2：版本、配置、模板命中）只能支撑「suspected」，severity 按 CVSS/标签给。
  - E2（L3 受控利用：证明可读数据、可执行命令、可触达内网）支撑「confirmed」，可据影响范围在基线之上上调一级（例如 SQLi 可读任意表）。
  - E3（L4：实际删除/写入/耗尽）只用于业务影响说明，不作为严重性更高的依据。`DROP TABLE` 不会让 SQLi 从 HIGH 变成 CRITICAL，只会增加恢复成本。
- 引擎替换会改变 fingerprint 的 `engine` 分量，因此同一问题在新引擎下是新的 finding lineage，旧 finding 自然 resolve。这是刻意取舍：不同引擎的规则语义不可假定等价。

### 7. schedules

```ts
export const PENETRATION_TESTING_SCHEDULES = [
  { standardKey: "attack-surface", subjectKind: "web-target", recommendedInterval: "weekly" },
  { standardKey: "vulnerability-scan", subjectKind: "web-target", recommendedInterval: "weekly" },
] as const;
```

- L1/L2 周扫（2026-11-21 拍板）；L3/L4 不进 schedules，只接受带审批的手工 run。
- `weekly` 是本模块自己的声明值。宿主现有 `security-evaluation.scan.job.ts:21-26` 只筛 `daily`，与这里互不影响；本模块的宿主 job 直接读本常量，不需要扩展骨架枚举。
- 主动扫描的频率由授权与预算共同约束，不由调度器「更勤快」驱动。

### 8. HTTP 面与权限

写面与读面都在模块（对齐 ADR-071/ADR-072 的「模块拥有写面」口径）：

| 端点 | 动词 | 说明 |
| --- | --- | --- |
| `POST penetration-testing/targets` | Create | 注册目标（subject + material 同事务） |
| `PATCH penetration-testing/targets/:subjectId` | Update | 更新 label / environment / 端口 / 路径角色 |
| `GET penetration-testing/targets` / `:subjectId` | List / Get | 读目标与验证状态（不返回 token） |
| `POST penetration-testing/targets/:subjectId/verification` | Update | 取 challenge/token |
| `POST penetration-testing/targets/:subjectId/verification/check` | Update | 执行归属验证 |
| `POST penetration-testing/authorizations` | Create | 发起授权申请 |
| `POST penetration-testing/authorizations/:id/approve` | Update | 审批（申请人与审批人必须不同） |
| `POST penetration-testing/authorizations/:id/revoke` | Update | 撤销（同时作为 kill switch 的授权侧） |
| `POST penetration-testing/test-objects` / `:id/approve` | Create / Update | 登记并审批 L4 可破坏测试对象 |
| `GET penetration-testing/playbooks` | List | 只读的 playbook 目录（代码常量的投影） |
| `POST penetration-testing/runs` | Create | 发起 L1–L4 run（门禁在 service；`judgmentConfig.standardKey` 指定 key；L4 必须带 playbookId + testObjectId） |
| `GET penetration-testing/runs` / `findings` / `reports` | List / Get | 复用 security-evaluation 的读模型形状 |

- 模型全部落在 `@@schema("module/penetration-testing")`，宿主权限种子按 namespace 自动派生 atom；动词仍只有 List / Get / Create / Update / Delete，不新增 `Manage`。
- 审批是**法律行为**，因此 `approvedBy` / `requestedBy` 存在模块表里；这与 ADR-068 D6「平台动作不存操作者」不冲突——平台动作的操作者仍在审计日志，授权审批的操作者是业务数据。
- 发起与审批分离（2026-11-21 拍板）：**任意成员都可以发起授权申请与 run 请求**；`approve`、测试对象登记与审批只授予 **ADMIN**。系统当前只有 `admin` / `member` 两种角色，没有独立「安全团队」角色，安全团队以 ADMIN 身份操作。`requestedBy ≠ approvedBy`、`createdBy ≠ approvedBy` 由 module service 强制。L1/L2 也不能绕过授权行——成员发起只是把申请放进队列，没有 `APPROVED` 行依旧拒绝启动。
- 上述分离意味着 **L4 至少需要两名 ADMIN**：一名登记/发起，另一名审批。只有一个 ADMIN 时 L4 一直 fail-closed，这是刻意的安全属性，不是缺陷；部署侧应至少配置第二个 ADMIN（可以是客户方安全负责人）。

## 跨宿主 / 演进检验（registry 模块设计必填）

- **无宿主词**：`web-target`、`authorization`、`exploit-verification`、`maintenance window` 均为安全测试领域通用词；不出现 consumer 实体名、项目状态或 nightwatch 私有概念。`environment` 只表达 `PRODUCTION` / `NON_PRODUCTION` 这一通用安全约束。
- **对所有消费方一致**：不装配该模块的宿主行为零变化；端口未绑定只在跑 L1–L3 时失败；L4 只走独立的破坏性动作端口，且仅 `NON_PRODUCTION` + 测试对象门禁通过时才执行。
- **演进路径**：新增检查面 = 新 criterion + 映射表 + criteria 版本；替换引擎 = 只改宿主适配器，criterion 语义不变（finding lineage 会断，已在 §6 声明）；新增 level = 新 key + 新审批枚举值 + 新预算常量，不改 subject 身份。

## 影响

- registry 新增一个模块目录 `packages/modules/penetration-testing/`，变更点共 11 处，缺一即失效：
  1. `prisma/schema.prisma`：四张表（target / authorization / test-object / execution）+ `@@schema("module/penetration-testing")`。
  2. `newbie.module.json`：`requires.modules: ["evaluation", "security"]`；无 env（端点与开关归宿主）。
  3. `penetration-testing.constants.ts`：subject kind、四个 key、级别/状态/攻击类枚举、预算与重验策略常量、schedules、playbook 目录。
  4. `ports/scanner.access.ts`：引擎中立端口与观测形状。
  5. `ports/destructive-action.access.ts`：单动作端口，含 playbook/测试对象/marker 与清理结果。
  6. `ports/verification.access.ts`：`lookupTxt` / `fetchText`，形状与 `web-origin-verification-access.port.ts:10-17` 一致，宿主可用同一个适配器绑两个 token。
  7. `assets/`：目标注册、归属验证、惰性重验（`listActiveVerified`）。
  8. `authorization/`：授权申请、审批、撤销、测试对象审批、有效期与 L3/L4 门禁。
  9. `evidence/`：L1–L3 调用扫描端口；L4 调用破坏性动作端口；在 `collect` 内立即写 `PenetrationTestingExecution`。
  10. `judgment/`：确定性 mechanism + 规则映射表 + fingerprint/severity。
  11. `criteria/`：四个规则集版本的 seed；`selectVersion` 按 kind + key 分派；未知 key 返回 `null`。
- 宿主、前端、调度、部署见 nightwatch-backend ADR-049。
- 负面：多一个模块与四张表；主动扫描引入 WAF 误伤与假阴性，需要在 evidence 里保留原始请求/响应以便复核；引擎升级会改变 finding lineage，趋势图会出现断点（以 `metadata.engineVersion` 标注）；L4 playbook 需要人工评审与回归，维护成本高于普通规则集。
- 模块必须 `@Global()`（与 `EvaluationModule`、`SecurityEvaluationModule` 一致），三个 kind 端口用 `useExisting` 绑定到 `web-target`，并在 `exports` 中暴露。

## 迁移阶段

| 阶段 | 内容 | 行为变化 |
| --- | --- | --- |
| P0 | 本契约：kind / 四 key / 四表 / 三端口 / criteria / judgment / 单测 | 无（无目标） |
| P1 | 宿主装配、归属验证、授权审批、临时容器与出网代理；`attack-surface` 上线 | 新增 L1 finding |
| P2 | `vulnerability-scan` 上线（ZAP + nuclei，排除破坏性模板） | 新增 L2 finding |
| P3 | `exploit-verification`（逐 finding/class 审批；PoC 证据由 L3 run 产生） | 新增 L3 finding |
| P4 | `destructive-testing` 受控 playbook：测试对象登记/审批、playbook 目录、破坏性动作端口、清理验证与 `CLEANUP_FAILED` 告警；灰度到 staging 目标 | 新增 L4 finding |
| P5 | 前端页面、报表、趋势 | 可见 |

## 非目标

- 不做 DoS / 压测 / 容量测试（属于独立性能能力）。
- P0–P4 不做认证后扫描（需要客户账号与会话管理；后续单独立项）。
- 不做不可逆的**外部**副作用（发邮件/短信、支付、第三方 webhook、生产数据删除）；L4 playbook 只能作用于登记且审批过的测试对象。
- 不做任意命令/脚本执行：破坏性动作只能选代码常量 playbook；playbook 目录不可由数据库编辑，新增即新模块版本。
- 不捆绑、不分发 Burp Suite（商业授权）；Burp 结果作为下一次 L3 run 的 evidence 输入，不直录 finding。
- 不做社会工程、钓鱼、物理、无线、供应链投毒。
- 不做数据批量导出、持久化后门、横向移动；PoC 证据以「证明可利用」为上限。
- 不扫描声明端口/IP 以外的目标，不做目标发现扩张（子域爆破、全网段扫描）。
- 不用 LLM 判定漏洞或重新定级。

## 被否掉的方案

- **复用 `web-origin` kind**：`criteriaProviderToken` 等三个 token 是全局字符串，与 `subjectType` 无关，会与 `SecurityEvaluationModule` 的绑定冲突；且两套授权/证据语义不同。
- **新建一套独立的 run/finding 表**：等于复制 skeleton，去重、MTTR、报表、告警全部双份真源。
- **自研扫描引擎**：维护成本与检测能力都不如成熟引擎，且会把「规则库更新」变成平台发版。
- **把四层做成四个 subject kind**：同一 origin 会有四份 run 历史与四份 suppress 状态，风险接受被拆碎。
- **在模块里直连 Docker/代理**：模块必须保持无出网能力，否则授权门禁与预算绕不过去。
- **用 LLM 判定漏洞可利用性**：不可复现、不可审计，fingerprint 会漂移。

## 待拍板

无。L4 测试对象来源定为 **C2（操作者登记 + 双人审批）**，并按当前账号模型收敛为 **ADMIN 专属**：登记与审批都只授予 ADMIN，`createdBy ≠ approvedBy`。系统只有 `admin` / `member` 两种角色，因此 L4 至少需要两名 ADMIN；只有一个 ADMIN 时 L4 一直 fail-closed，这是刻意行为。

C1（客户登记）与 C3（平台自动创建）不用于 v1：C1 把责任推回不熟悉攻击面的客户，C3 需要逐目标管理凭据与 API 适配。表结构（`locator` / `cleanupLocator` / `createdBy` / `approvedBy`）已能表达两种来源，后续替换不需要迁移。

已拍板（2026-11-21）：L1/L2 周扫；所有成员可发起申请，审批与测试对象管理归 ADMIN；`environment` 放 target material；扫描隔离用 Docker socket-proxy + 每次容器（宿主侧见 ADR-049）；请求预算接受 §5 初始值；目标 CIDR 收进授权记录；L3 加入 sqlmap 只读利用；**L4 取 B′（平台执行固定 playbook）+ C2 测试对象来源（ADMIN 双人审批）**。
