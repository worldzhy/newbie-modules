# ADR-071: security-evaluation 材质读契约收敛到 subject 子资源

状态：已采纳
日期：2026-11-16
更新：2026-11-16 — 用户批准采纳；代码实施按「## 影响」逐项落地，契约不再调整。
更新：2026-11-16 — 用户裁决：宿主项目级 web-origin controller 整体退役，纳入「## 影响」。

## 背景

ADR-070 定义了 material catalogue 的存储侧：subject 的材质落在三张同构表
（`SecurityEvaluationWebOrigin` / `SecurityEvaluationRepository` /
`SecurityEvaluationAwsAccount`），公共骨架是 `id / subjectId(@unique) / isActive /
createdAt / updatedAt`，方差全在各自业务字段。写入侧也已经是"先 subject、后
material"——`POST /security-evaluation/subjects/sync` 在同一事务内 upsert 两者。

读侧没有对等设计。现状只有一个 `GET /security-evaluation/web-origins/:subjectId`：

1. 它返回的是 subject 身份 + web-origin 材质的合并视图（`origin` 取
   `subject.subjectKey`、`label` 取 `subject.displayName`）。material 的所有者实际是
   subject，路径却按 kind 分家。
2. 它把 `verificationToken` 放进 GET 响应。任何持有 `EvaluationSubject:List` 的调用方
   都能取到一份可写入对方 DNS TXT / `.well-known` 的凭据，且取用没有独立审计点。
3. 另两种 kind 的材质没有任何读端点，新增 kind 就新增一条路径。

一句话：写入侧把 material 建模成 subject 的附属物，读侧却把它当成 kind 的附属物。

ADR-044（nightwatch-backend）第 104 行把"查看验证 token 的宿主 HTTP 入口"记为宿主
所有、权限落 `Get`，第 130 行把 `WebOrigin` controller/DTO 记为宿主资产。controller
与 DTO 实际已迁入本仓模块（`security-evaluation.controller.ts` /
`security-evaluation-web-origin.dto.ts`），这两条表述需要按本 ADR 收窄。

## 候选方案

- **A 内联**：`GET /security-evaluation/subjects/:subjectId` 同时返回身份与 material。
- **B 子资源**：`GET /security-evaluation/subjects/:subjectId/material` 只返回 material。
- **C 什么都不做**：保留 `GET /web-origins/:subjectId`。
- **D 并存**：保留 C，另补一个纯身份读 `GET /subjects/:subjectId`。

C 与 D 都被排除：同一个资源由两条路径描述，读者无法判断哪条是真源。

## 决策

选 **B**，并把 web-origin 的两个验证端点一并上移，形成
`subject → material → verification` 三层：

| 用途 | 端点 | 权限 |
|---|---|---|
| 读材质 | `GET /security-evaluation/subjects/:subjectId/material` | `EvaluationSubject:List` |
| 签发/复用验证凭据 | `POST /security-evaluation/subjects/:subjectId/material/verification` | `EvaluationSubject:Update` |
| 触发校验 | `POST /security-evaluation/subjects/:subjectId/material/verification/check` | `EvaluationSubject:Update` |

`GET .../material` 的响应是 discriminated union，以 `kind` 判别：

```ts
type SubjectMaterial =
  | {
      kind: "web-origin";
      targetPaths: Record<string, string>;
      verificationStatus: "PENDING" | "VERIFIED" | "FAILED" | "REVOKED";
      verificationMethod: "DNS_TXT" | "WELL_KNOWN" | null;
      verificationFailureCount: number;
      verifiedAt: string | null;
      lastVerifiedAt: string | null;
      isActive: boolean;
    }
  | {
      kind: "repository";
      provider: string;
      namespace: string;
      name: string;
      url: string | null;
      isActive: boolean;
    }
  | {
      kind: "aws-account";
      accountId: string;
      defaultRegion: string | null;
      regions: string[];
      isActive: boolean;
    };
```

`GET` 响应永不包含 `verificationToken`。token 只出现在
`POST .../material/verification` 的响应里，由该端点签发或复用（复用语义沿用
ADR-044 §54：同 subject 重复签发返回同一 token）。

决定性理由：material 的所有者是 subject，不是 kind——三张表都以 `subjectId @unique`
指向 subject，写入侧也是先 subject 后 material，资源层级必须与所有权层级一致。按
kind 分路径会让"新增一个 kind"同时意味着"新增一条读路径"；按 subject 分路径时新增
kind 只是 union 多一支。token 移出 GET 是同一判据的副作用：凭据属于"我此刻要验证"
这个动作，不属于"我读这个 subject"这个查询。

非 web-origin kind 调用两个 verification 端点返回 400：验证是 web-origin 的专属状态机。

## 跨宿主 / 演进检验

- 三个端点只依赖 `subjectId` 与 `kind`，不引入 project、宿主控制台或任何厂商概念；
  任何消费方装配该模块后行为一致。
- 新增 kind 只需在 `SubjectMaterial` union 加一支并在 service 分派，路径与权限不变。
- token 不再出现在任何 GET：宿主无法用列表/详情接口批量抓取可写 DNS 的凭据；签发点
  唯一，审计面收窄到一次 POST。
- 前端刷新验证面板时不再"读回上次 token"，改为进入面板即调一次
  `POST .../verification`（幂等复用）取回同一 token——信息不丢失，动作变显式。

## 影响

- 删除 `GET /web-origins/:subjectId`，由 `GET /subjects/:subjectId/material` 取代。
- 两个验证端点路径上移；前端 `getSecurityEvaluationWebOriginsSubjectId` 与两个 mutation
  的调用点改指向；`npm run apits` 重新生成。
- 无 schema 变更。`SecurityEvaluationWebOriginService.detail()` 改为装配
  `SubjectMaterial` 的 web-origin 分支；repository 与 aws-account 首次获得读端点
  （它们是 union 成立的必要分支，不是额外扩张）。
- ADR-044 部分取代：第 104 行「查看验证 token 的宿主 HTTP 入口…权限落 Get」与第 130
  行「宿主：`WebOrigin` controller/DTO」由本 ADR 取代，其余章节继续有效。
- 宿主项目级 `SecurityEvaluationWebOriginController`（`projects/:projectId/web-origins`）
  整体退役：读/注册/验证入口不再保留，token 的签发点只落在模块的
  `POST /security-evaluation/subjects/:subjectId/material/verification`。宿主侧
  `ProjectWebOrigin` 归属表保留，仅由 `ProjectSubjectProvider` 扫描读取。

Supersedes: ADR-044（nightwatch-backend）第 104 行与第 130 行关于 web-origin
controller/DTO 归属与 token 读取权限的表述。

写面（创建 / subject 更新 / material 更新）见 ADR-072。
