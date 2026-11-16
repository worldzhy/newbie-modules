# ADR-072: security-evaluation subject 写契约——创建严格走 POST，material 走 PUT/PATCH

状态：已采纳
日期：2026-11-16
归属：框架层（registry `packages/modules/security-evaluation`）；宿主侧装配另起 nightwatch-backend ADR
关联：newbie-modules ADR-066（web-origin subject kind）、ADR-068（无 scope 的 subject 身份）、ADR-069（subject ownership type）、ADR-070（素材目录，本 ADR 部分取代其 D3）、ADR-071（material 读契约）；nightwatch-backend ADR-044（web-origin 宿主实施）
决策记录：2026-11-16 用户「新增资产必须调 `POST /security-evaluation/subjects`，不应该用 sync」；同一轮「POST 做的事情要严格符合 RESTful 规范，如果需要额外操作，就增加方法」；material 随创建提交的方式用户选定 **A**（POST body 内联 material，服务端单事务建 subject + material，返回 201；后续 material 变更走 PUT/PATCH）。

## 背景

ADR-070 D3 把 `POST /security-evaluation/subjects/sync` 定为素材唯一写入口，语义是"宿主上报，模块 upsert"。这个语义对宿主枚举任务是合适的，但对"操作员在控制台新增一个资产"是有害的：

1. **200 + upsert 掩盖冲突**：`POST` 本应是"创建"；重复提交被静默合并成更新，调用方无法区分"新建成功"和"已存在、我把别人的资产改了"。
2. **一次 POST 承担两种动作**：新增资产和宿主对齐共用同一端点，权限、审计、幂等语义被糅在一起。
3. **material 没有更新通道**：创建之后改 `targetPaths`（例如 web-origin 的路径角色映射）、改仓库 URL，只能再次 POST sync 全量覆盖。
4. **subject 自身没有更新通道**：改 `displayName` 同样只能靠 sync。

ADR-071 已经把读侧收敛到 `subject → material → verification` 三层；写侧仍是"一个 sync 打天下"，读写不对称。

## 候选方案

- **A 创建内联 material**：`POST /subjects` 的 body 携带 material，服务端单事务创建 subject + material，201 + `Location`；material 后续修改用 `PUT`/`PATCH .../material`。
- **B 两步创建**：`POST /subjects` 只建身份，再 `POST .../material` 建 material。两个事务，失败留下无 material 的半成品 subject。
- **C 保留 sync 单入口**：不改，新增资产继续复用兼容 upsert 的端点。

C 被排除（即本 ADR 的动因）。B 被排除：subject 无 material 在本模块里不是合法中间态——`kind` 决定 material 表，创建时就该一并落库；两步创建还要为"半成品"设计清理语义。

## 决策

选 **A**。写面按下表收敛，每个端点只承担一个 REST 动作：

| 端点 | 动作 | 语义 | 响应 |
|---|---|---|---|
| `POST /security-evaluation/subjects` | Create | 创建 subject + 内联 material，单事务 | 201 + `Location: /security-evaluation/subjects/{subjectId}`，body `{ subjectId }`；同 `(kind, subjectKey)` 已存在 → 409，body 带已有 `subjectId` |
| `GET /security-evaluation/subjects` | List | 已有（ADR-068） | 200 |
| `PATCH /security-evaluation/subjects/:subjectId` | Update | 改 `displayName`（部分更新） | 200 / 404 |
| `PUT /security-evaluation/subjects/:subjectId/material` | Update | 整体替换 material | 200 / 404 |
| `PATCH /security-evaluation/subjects/:subjectId/material` | Update | 局部更新 material（只改出现的字段） | 200 / 404 |
| `GET /security-evaluation/subjects/:subjectId/material` | List | 已有（ADR-071） | 200 / 404 |
| `POST .../material/verification` | Update | 已有（ADR-071） | 200 / 400 |
| `POST .../material/verification/check` | Update | 已有（ADR-071） | 200 / 400 |
| `POST /security-evaluation/subjects/sync` | —（保留） | **宿主对齐入口**，不属于普通调用方写面；前端不再调用 | 200 |

### D1. POST 只创建

`POST /subjects` 命中已存在的 `(kind, subjectKey)` 时返回 **409 Conflict**，响应 body 携带已存在 subject 的 `subjectId`，让调用方可以就地转为读或 PATCH，而不是被静默合并。创建成功后返回 201 与 `Location` 头。

幂等是 `sync` 的职责，不是 `POST` 的职责：`sync` 仍按 ADR-070 D3 做宿主枚举的 upsert（200），但它不再是前端新增资产的入口。

### D2. material 随创建内联

请求体沿用现有 `IngestSecurityEvaluationSubjectRequestDto` 的形状并补一个 `webOrigin?: { targetPaths?: Record<string, string> }` 分支，与 `repository` / `aws-account` 并列。三者在服务端都是"subject + material 单事务"：

| kind | subjectKey（自然键） | material 来源 |
|---|---|---|
| `repository` | `${provider}:${namespace}/${name}`（全小写） | body `repository` |
| `aws-account` | `accountId` | body `awsAccount` |
| `web-origin` | 规范化 origin（body `subjectKey`） | body `webOrigin` |

`web-origin` 的 `subjectKey` 仍是必填的规范化 origin（ADR-066）；`webOrigin.targetPaths` 缺省时记为 `{}`，与 ADR-071 读契约的空路径语义一致。

`kind` 与 material 分支必须匹配：`kind: "repository"` 缺 `repository` 视为 400，反向提供不匹配的分支同样 400（不静默忽略）。

### D3. subject 与 material 的更新分道

- `PATCH /subjects/:subjectId`：只允许 `displayName`。`kind`、`subjectKey`、`credentialRef`、`metadata` 不可通过此端点修改——前两者是身份，改身份等于换一个 subject；后两者是宿主上报的载荷，属于 `sync` 的写面。
- `PUT .../material`：整体替换，缺省字段按该 kind 的默认值落库（web-origin 的 `targetPaths` 缺省 `{}`）。
- `PATCH .../material`：局部更新，**只改请求里出现的字段**，未出现的字段保持原值。这是"改一条路径映射不该清空其余路径"的直接推论。

### D4. 验证状态不因 material 编辑重置

`VERIFIED` 的 web-origin 允许继续改 `targetPaths`（它在验证凭据落地之前就存在，且不参与证明），不重置 `verificationStatus`。只有 origin 本身变更（等价于另一个 subject）或显式 `POST .../verification` 才进入再验证流程。理由：`targetPaths` 只影响后续运行采集哪些路径，不改变"这个域归你所有"的证明。

### D5. sync 降级为宿主专用

`POST /subjects/sync` 保留，权限与载荷不变，但定位改为"宿主枚举对齐"：宿主 `ProjectSubjectProvider` 之类的批量上报走它。普通调用方（控制台新增、详情编辑）一律走 D1–D3。前端不再引用该端点。

## 跨宿主 / 演进检验

| 维度 | 框架层（模块） | 宿主层（nightwatch 等） | 其他宿主接入 |
|---|---|---|---|
| 创建 | `POST /subjects`，201/409，body 只含自然键 + material | 控制台新增资产调它 | 同样可用，无需宿主实体 |
| 身份更新 | `PATCH /subjects/:id` 只改 `displayName` | 无宿主特有行为 | 一致 |
| material 更新 | `PUT` 全量 / `PATCH` 局部 | 无宿主特有行为 | 一致 |
| 批量对齐 | `POST /subjects/sync` 保留 | 枚举上报的唯一调用方 | 可选，不实现也能用 |
| 冲突语义 | 409 + 已有 `subjectId` | 调用方自行决定转 PATCH 或提示 | 一致 |

新增 kind 只扩展 body 的 union 分支与 subjectKey 派生规则，端点与状态码不变。

## 影响

- **部分取代** ADR-070 D3 中"ingest 是素材唯一写入口"的表述：写入口拆为 `POST /subjects`（创建）、`PATCH /subjects/:id`、`PUT|PATCH .../material`（更新），`sync` 保留为宿主对齐。
- **模块**：DTO 增 `webOrigin` 分支；controller 增 `POST /subjects`、`PATCH /subjects/:subjectId`、`PUT`/`PATCH .../material`；asset service 增 `create()` / `updateSubject()` / `replaceMaterial()` / `patchMaterial()`；web-origin service 修复 update 分支在 `targetPaths` 未提供时清空既有路径的行为；`normalizeTargetPaths` 补长度上限。
- **宿主**：`npx newbie modules apply` 同步装配产物；`npm run apits` 重新生成前端类型；无需 schema 变更。
- **前端**：新增资产弹窗从 `subjects/sync` 改调 `POST /subjects`（web-origin 分支携带 `targetPaths`）；详情抽屉增加编辑 `targetPaths` 的入口走 `PATCH .../material`。
- **非目标**：不新增素材删除 / 停用入口；不改 ADR-071 的读契约与 verification 状态机。

Supersedes: ADR-070 的 D3（"ingest 是素材唯一写入口"）。
