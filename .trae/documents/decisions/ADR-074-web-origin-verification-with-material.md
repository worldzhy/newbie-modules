# ADR-074: web-origin 验证信息随 material 读返回，验证方法降为结果

状态：已采纳（2026-11-16 用户批准）
日期：2026-11-16
更新：2026-11-16 — 用户批准采纳；补记 D2 的两条实现约束——`generateToken()` 保持私有取值原语，`rotateVerificationToken()` 是对 controller 暴露的用例入口；端点用 POST 而非 GET，因为它非幂等地改写状态，读侧由 D1 的 `GET .../material` 承担。
归属：框架层（registry `packages/modules/security-evaluation`）；宿主前端与适配器的落地形态另记于 nightwatch-backend ADR-044 更新行
关联：ADR-071（material 读契约，本 ADR 部分取代其 token 条款）、ADR-072（subject 写契约，不受影响）、ADR-073（严格 RESTful）、ADR-070（素材目录）；nightwatch-backend ADR-044（web-origin 宿主实施，本 ADR 部分取代其 §2 第 1、3 步）
决策记录：2026-11-16 专家评审提出五点问题（安全论证不成立、读写自相矛盾、方法持久化、复用语义分叉、材质写面缺注记），用户逐条认可，并认可目标方向——token 随 material 读返回、`verificationMethod` 成为结果而非输入、校验顺序探测两种放置、方法切换改为纯视图。同日用户复核命名，否决 ACME 的 `challenge` 术语，改为 `verification` 词干与 `tokens` / `checks` 资源集合。

## 背景

ADR-071 把 token 从读面移出，只允许 `POST .../material/verification` 签发或复用；随之而来的实现形态是：**打开验证面板就等于发一次写请求**。这条设计在评审中暴露了四个具体缺陷。

1. **安全论证不成立**。ADR-071 称"任何持有 `EvaluationSubject:List` 的调用方都能取到一份可写入对方 DNS TXT / `.well-known` 的凭据"。token 本身就是必须公开的：它要贴在对方域名的 DNS TXT 里，或放在公网可读的 `.well-known` 文件里。持有 token 不能写任何人的 DNS；真正的门禁是端点权限（`EvaluationSubject:Update`）与服务端探测。把 token 当秘密，等于为一个公开物付审计成本。
2. **读写自相矛盾**。ADR-071 的立论是"凭据属于『我此刻要验证』这个动作"，结论却是"进入面板即 POST"。现状（`security-evaluation-web-origin.service.ts:230-253`）中，一次面板打开就会：把 `verificationMethod` 持久化、把非 `VERIFIED` 的 origin 置 `PENDING`、在 `FAILED` 时轮换 token 并清零 `verificationFailureCount`。读触发写，且一次读取改变了状态机的三处状态。
3. **验证方法被当成输入**。`requestVerification(subjectId, method)` 把"操作员选了哪个标签页"落库，`verify` 只按这个持久化值探测一处（`security-evaluation-web-origin.service.ts:272-277`）。方法成了创建态数据，而它本应是"哪一处放置被证实"的结论；用户在界面上切换标签页，实际是在改数据库。
4. **复用语义与宿主口径分叉**。ADR-044 §2 第 1 步写"生成/复用 `verificationToken`"，ADR-071 写"进入面板即调一次幂等复用"，而实现里 `FAILED` 会轮换——同一份契约在三处描述里给了三种 token 生命周期。

另有一处需要明示但不必改动的边界：`UpdateSecurityEvaluationSubjectMaterialRequestDto` 只含 `targetPaths / url / defaultRegion / regions`，验证状态族字段本来就不在写面；本 ADR 把这条边界写成契约（见 D6），避免后续被"顺手支持"。

## 候选方案

- **A 保持 ADR-071**：token 只在 POST 出现，GET 干净。排除：读者必须用写请求换取读状态，方法持久化与读触发写的问题原样保留。
- **B token 随 material 读返回，POST 收窄为显式轮换**：GET 返回当前验证信息（token + 两套放置说明），`verificationMethod` 由校验写入，方法切换不产生任何写。选中。
- **C token 常驻在 List 端点**：`GET subjects` 一并返回 token。排除：列表是批量读，没有"我正在验证这个 origin"的语境；单资源读已经足够，列表返回凭据只是扩大暴露面而无收益。

## 决策

### D1. `GET .../material` 返回验证信息

web-origin 分支在 `verificationStatus ∈ {PENDING, FAILED}` 时返回 `verification`，`VERIFIED` / `REVOKED` 返回 `verification: null`：

```ts
type WebOriginVerification = {
  token: string;
  dnsTxt: { name: string; value: string };   // _nightwatch-verify.<host> / nightwatch-verify=<token>
  wellKnown: { url: string };                // https://<host>/.well-known/nightwatch-verification.txt
};
```

两套放置说明总是同时给出——`checks` 会顺序探测两处（D3），前端因此不再需要按方法渲染一份。字段名用 `verification` 而非 ACME 的 `challenge`：本模块的读者是控制台使用者，术语收益无法兑现；且同一状态机里 `verificationStatus / verificationMethod / verificationFailureCount` 已确立唯一词干，英文界面的 "Generate challenge" 与中文「生成验证信息」并存即为反例。

`VERIFIED` 返回 `null`，因为此时没有待执行动作；`REVOKED` 返回 `null`，因为它已不能被验证（两个 POST 对 `REVOKED` 仍返回 400）。token 不再出现在任何 **List** 端点，只出现在单 subject 的 material 读与显式轮换的响应里。

### D2. `POST .../material/verification/tokens` 收窄为"重新生成校验值"

- 请求体为空（删除 `RequestWebOriginVerificationDto`）；路径取集合语义——每次 POST 产出一个新令牌、旧令牌随之失效，与 ADR-073 D2 的"POST 创建资源"一致。
- 每次调用生成新 token（32 字节 base64url，`webOriginTokenBytes` 可配，上限 48 字节以适配 `VarChar(64)`），把 `verificationFailureCount` 清零，并把 `PENDING` / `FAILED` 置为 `PENDING`。
- `VERIFIED` 与 `REVOKED` 返回 400：前者重新生成会让一个已生效的证明失效，需要让操作员先明确走"撤销后重建"而不是在一次点击里静默降级；后者已不可验证。
- 响应是 D1 的 `WebOriginVerification` 对象（token + 两套放置说明）。

创建（`POST subjects`）时签发首个 token 的行为不变：token 在 material 落地时生成，`GET` 读回的就是它。

两条路径（注册签发、显式轮换）只共用一个私有的取值原语 `generateToken()`，不互相复用入口：注册不得调用 `rotateVerificationToken`（后者要求行已存在，且带 `VERIFIED` / `REVOKED` 守卫），轮换也不得并入创建事务。轮换路径因此没有"复用旧 token"的分支——每次 POST 都是新值。

### D3. `checks` 顺序探测两种放置，成功才写方法

`POST .../material/verification/checks` 不再读 `verificationMethod`，而是按固定顺序探测：

1. `DNS_TXT`：`_nightwatch-verify.<host>` 的 TXT 中是否存在 `nightwatch-verify=<token>`。
2. `WELL_KNOWN`：`https://<host>/.well-known/nightwatch-verification.txt` 的内容是否等于 token。

首个命中即成功：置 `VERIFIED`、写 `verificationMethod = 命中的方法`、更新 `verifiedAt / lastVerifiedAt`、`verificationFailureCount = 0`。两处都未命中：`verificationFailureCount + 1`，达到阈值置 `FAILED`，**不写 `verificationMethod`**（保留上一次成功的方法，作为历史结果）。

顺序理由：DNS TXT 不经过 HTTP 栈，没有 WAF、重定向、CDN 缓存与站点改版等变量，判定最稳定；`.well-known` 作为回退，服务不可达或站点侧拦住了也还有另一条路。一次校验无论探测几处，失败只计一次，不按方法数累计。

`checkVerification` 的探测超时、逐跳 SSRF 校验与 4 KB 响应上限沿用 ADR-044 §2 的适配器约束，不变。

### D4. 方法切换是纯视图

两种放置的说明总是同时返回，界面上切换标签页只改变**展示**，不产生任何请求；"更新验证信息"按钮删除。唯一保留的写入口是带确认的次要按钮"重新生成校验值"（D2），用于已公开的值需要作废重来的场景。

### D5. 安全论证更正

- token 是公开物：它必须被贴在对方域名下，任何读者都能看到。持有它不构成对 DNS 或站点内容的写能力。
- 门禁有两层且都不依赖 token 保密：端点权限（读 `EvaluationSubject:List`，轮换与 `check` 为 `EvaluationSubject:Update`），以及服务端对公网地址的探测（`assertPublicHttpUrl` / `assertPubliclyResolvable`）。
- 因此 ADR-071"GET 携带 token 可被批量抓取可写 DNS 的凭据"的威胁模型作废；token 的读暴露面收缩为"按 `subjectId` 的单资源读"，审计点仍是轮换与 `check` 两次写。

### D6. 材质写面只含可变业务字段

`PUT|PATCH .../material` 的请求体只接受该 kind 的可变业务字段（web-origin 为 `targetPaths`）。`verificationStatus`、`verificationToken`、`verificationMethod`、`verificationFailureCount`、`verifiedAt`、`lastVerifiedAt` 由验证状态机独占，任何 material 写请求都不得设置或清除它们。实现上 `UpdateSecurityEvaluationSubjectMaterialRequestDto` 已如此收窄，本 ADR 把它固定为契约，新增 kind 时同样不得把状态字段放进写面。

## 跨宿主 / 演进检验

| 维度 | 框架层（模块） | 宿主层（nightwatch 等） | 其他宿主接入 |
|---|---|---|---|
| 读验证信息 | `GET .../material` 的 web-origin 分支带 `verification` | 前端直接渲染两套放置说明 | 一致，无需宿主概念 |
| 轮换 | `POST .../verification/tokens` 空 body，生成新 token | 次要按钮 + 确认框 | 一致 |
| 判定 | `POST .../verification/checks` 顺序探测两处，写命中方法 | 宿主只提供 `lookupTxt` / `fetchText` 适配器 | 一致；适配器未绑定时 `checkVerification` 报 wiring error |
| 方法语义 | 只由 `checks` 写入 | 无写入通道 | 一致 |
| 新增 kind | union 多一支；`verification` 仅 web-origin 有 | 无宿主改动 | 一致 |

## 影响

- **模块**：
  - `SecurityEvaluationWebOriginMaterialDto`（`security-evaluation-material.dto.ts`）增加 `verification: WebOriginVerification | null`。
  - `RequestWebOriginVerificationDto` 删除（body 为空）；`WebOriginChallengeDto` → `WebOriginVerificationResponseDto`（去掉 `method`，保留 token 与两套放置）；`WebOriginVerificationResultDto` → `WebOriginVerificationCheckResponseDto`。
  - `SecurityEvaluationWebOriginService`：`requestVerification(subjectId, method)` → `rotateVerificationToken(subjectId)`；`verify` → `checkVerification(subjectId)`（双方法顺序探测）；`matchesPublishedToken` 拆成单方法探测供顺序调用；废弃内部接口 `SecurityEvaluationWebOriginChallenge` / `SecurityEvaluationWebOriginVerificationResult`，直接返回上述两个 DTO（与 `detail()` 一致）。
  - 门面 `SecurityEvaluationAssetService.requestMaterialVerification` → `rotateMaterialVerificationToken`；`checkMaterialVerification` 不变。
  - `buildChallenge` → `buildVerification`，不再接受 method，固定返回两套放置说明。
  - 测试：`security-evaluation-web-origin.test.ts` 中断言"requestVerification stores the requested method"的用例改为"轮换生成新 token 且不改方法"；新增"校验命中第二处（well-known）时方法写为 WELL_KNOWN"。
- **宿主**：`npm run apits` 重新生成前端类型（生成函数名随路径变为 `postSecurityEvaluationSubjectsSubjectIdMaterialVerificationTokens` / `...VerificationChecks`）；`page.tsx` 的验证面板删除 `methodOverride`、删除"更新验证信息"按钮与进入面板自动 POST 的 `useEffect`，改为读取 `detail.verification` 渲染、Tabs 纯切换、次要按钮调轮换 mutation；`verification` 为 `null` 且状态为 `VERIFIED` 时只显示"已验证"事实。i18n 删除 `webOriginGenerateChallenge` / `webOriginRefreshChallenge`（中文「生成/更新验证信息」与英文 "Generate challenge" 并存即为术语不一致证据），英文改为 verification details / regenerate verification value。
- **无 schema 变更**：`verificationMethod` 列保留（`String? @db.VarChar(16)`），语义从"请求的方法"变为"最近一次成功的方法"。
- **不涉及** ADR-072 的写面；ADR-073 的动作端点豁免也不适用——`tokens` 与 `checks` 都是资源集合，走标准 POST 语义。

Supersedes:
- ADR-071「## 决策」中"`GET` 响应永不包含 `verificationToken`，token 只出现在 `POST .../material/verification`"的表述与端点表中该行的"签发/复用"语义（该端点在本 ADR 中改为 `POST .../material/verification/tokens`）；「## 影响」中"前端刷新验证面板时…改为进入面板即调一次 `POST .../verification`"一条。ADR-071 的资源层级（subject → material → verification）、union 判别与其余权限口径继续有效。
- nightwatch-backend ADR-044 §2 第 1 步（以 `method` 为输入签发/复用 token）与第 3 步（按持久化 `method` 探测一处）；周期重验、适配器守卫、`VERIFIED + isActive` 门禁继续有效。
