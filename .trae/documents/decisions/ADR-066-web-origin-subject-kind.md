# ADR-066: security-evaluation 以 web-origin subject kind 承载 Web 基线评估

状态：提议中
日期：2026-11-14
关系：扩展 ADR-022（security-evaluation 重建）的 kind 集合、ADR-037（evaluation key 与 criteria 版本化）、ADR-046（judgment mechanism 组合）、ADR-039（platform-level subject）；不取代任何既有 ADR。

## 背景

`security-evaluation` 现在只认两种 subject kind（`security-evaluation.constants.ts:2-8`）：`repository` 与 `aws-account`。五个 evaluation key（`constants.ts:22-26`）全部落在 SCA（`npm-osv`）、SAST（`code-scan`）、CSPM（`aws-cis-1.5` / `aws-custom`）与情报（`threat-intel`）三个能力面。

2026-11-13 的第三方检测报告（TELUS Digital，目标 `https://qa-schedule.solidcore.co`）给出 15 条 finding：NW 只命中 1 条（Next.js AVIF RCE，经 `npm-osv` 的两条依赖 finding 表达），其余 14 条全部落在 Web 运行时面——11 条响应头/TLS，3 条运行时可观测行为（用户枚举、OTP 刷量、客户端鉴权）。两仓对响应头与 TLS 工具关键字 grep 零命中，缺口是能力面的，不是配置面的。

本 ADR 只定**模块契约**：多一种 subject kind、多两个 evaluation key、多一个端口、多两条 criteria 版本。宿主如何提供资产、如何出网探测，见 nightwatch-backend ADR-044。

## 设计原则

1. **kind 说"评估什么"，key 说"用什么规则集判它"**：一个 origin 的响应头与 TLS 是同一对象的两种观测，不拆 kind。
2. **模块不发起网络请求**：探测能力与 repository 源码、AWS 配置一样，由宿主通过端口注入（ADR-022 的既有模式）。
3. **确定性优先**：能写成断言的不用模型。响应头存在性、CSP 指令、TLS 协议/套件、差分响应都是可判定谓词，不需要 LLM；LLM 分界仍按 ADR-054。
4. **同一观测必须得到同一 fingerprint**：finding 身份 `(subjectId, evaluationKey, fingerprint)` 要求判定可复现，否则 MTTR 与趋势会被噪声污染。
5. **主动探测是显式能力**：受端口预算、宿主白名单与归属验证三重约束；未绑定端口时 run 硬失败，不产出"干净"结果。

## 决策

### 1. 新增 subject kind `web-origin`

```ts
export const SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN = "web-origin";

export const SECURITY_EVALUATION_SUBJECT_KINDS = [
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
] as const;
```

- `subjectKey` = 规范化 origin（`scheme://host[:port]`），不含路径、查询串与末尾斜杠。
- 名字取 RFC 6454 的 origin（scheme + host + port），与 `subjectKey` 一一对应；不取 `endpoint`（HTTP 语义指带路径的端点，会让读者以为 subject 是 path 级）、不取 `site`（eTLD+1 语义，装不下子域）。此处的 "origin" 与 git remote 无关。
- 理由：响应头、TLS、证书都是 origin 级属性；path 级目标（`/login`、`/api/session`）是**规则的目标清单**，不是 subject 身份。
- subject 身份沿用 skeleton 的 `(kind, scopeType, scopeId, subjectKey)`（`evaluation-subject.service.ts:24,39-44`）。本 kind 是**平台级资产**：提交时固定传 `scopeType/scopeId = "platform"`，与 repository / aws-account 的写入路径一致（`security-evaluation-asset.service.ts:99-100`）。因此同一 origin 全部署只有**一个 subject、一套 run 历史、一套 finding**；多个项目注册同一 origin 时，provenance（`EvaluationSubjectSource`）留多行，只记"谁提交过"。
- 推论：suppress / resolve 是**资产级**风险接受，不是项目级偏好——任一项目 suppress 后其余项目同样看不到该 finding。隔离不靠 subject 身份，靠宿主提交门禁（未通过归属验证的 origin 不进入 ingest）；见 §非目标。

### 2. 新增两个 evaluation key

| key | 手段 | 频率 | 判定对象 |
| --- | --- | --- | --- |
| `web-baseline` | 被动：单次 HEAD/GET + TLS 握手记录，跟随重定向并逐跳留证 | daily | 安全响应头存在性与取值、HSTS 参数、CSP 指令覆盖面、cookie 标志、TLS 协议与套件、证书链、`Server` / `X-Powered-By` 暴露 |
| `web-behavior` | 受控主动：有界请求序列，单资产单 run ≤ 20 请求 | daily | 用户枚举差分、OTP/登录限速阈值、未认证访问特权接口 |

不引入第三个 key：`Client-Side Only Authorization` 的完整判定需要认证后爬取与响应形状对比，超出"外部黑盒"边界；`web-behavior` 只覆盖"未认证即可读到特权数据"这一子集（见 §6）。

### 3. 新增探测访问端口

```ts
export const SECURITY_EVALUATION_WEB_PROBE_ACCESS = Symbol("SECURITY_EVALUATION_WEB_PROBE_ACCESS");

export interface WebProbeAccess {
  observeHttp(request: WebObserveRequest): Promise<HttpObservation>;
  observeTls(origin: string): Promise<TlsObservation>;
  probe(request: WebProbeRequest): Promise<WebProbeObservation>;
}
```

- 模块只定义**观测数据形状**与**预算上限**，不实现传输、不持有 URL 白名单、不做 DNS 校验。
- 宿主负责 SSRF 校验、超时、并发、User-Agent、重定向策略与出网控制（ADR-044 §3）。
- 三个方法合一个端口而不是拆三个：它们共享同一套出网策略与预算，拆开会给"绑一半"留下静默降级的空间。
- 未绑定该端口而跑 `web-origin` 的 run，以 wiring error 失败（沿用 ADR-022 的失败语义与 `module.ts:66-69` 注释）。

### 4. criteria 版本

新增两个 code-defined 规则集，版本串沿用现有 `"v1"` 惯例（`constants.ts:33-64`）：

```ts
export const SECURITY_EVALUATION_WEB_BASELINE_RULE_SET_VERSION = "v1";
export const SECURITY_EVALUATION_WEB_BEHAVIOR_RULE_SET_VERSION = "v1";
```

- 每条 criterion 只声明：`criteriaId`、`severity`、判定谓词标识、目标粒度（origin / path）、证据字段名。
- 规则变更 = 新版本，不改已发布版本（ADR-037）。
- severity **不照抄报告**：按「外部可观测事实单独能造成的后果」定级，报告级别只作对照列，不一致处写明理由。可用级别为 `INFO / LOW / MEDIUM / HIGH / CRITICAL`（`evaluation.prisma:56-64`）。

  | 规则 | 我们的 severity | 报告 | 依据 / 升级条件 |
  | --- | --- | --- | --- |
  | 缺失 `X-Content-Type-Options`（HTML） | LOW | LOW | 仅在已有 XSS 或可上传内容时才被利用，自身只是缓解层缺失 |
  | 缺失 `X-Content-Type-Options`（API） | INFO | LOW | 响应是 `application/json`，浏览器不渲染；无可利用面，降级 |
  | 缺失 HSTS | LOW | LOW | 只有首次访问与子资源可被降级；若 HTTP 明文可达（无跳转），由独立规则判 CRITICAL，不叠在 HSTS 上 |
  | `X-Powered-By` 暴露（Express / Next.js） | INFO | LOW | 纯技术指纹，自身不构成可利用面；降级 |
  | 缺失 `X-Frame-Options` 且无 `frame-ancestors` | MEDIUM | LOW | 未认证观测到的缺失是 host-wide 的，受保护页面同样可被嵌入，点击劫持可直接发起；报告给 CVSS 6.5 却评 Low，自相矛盾。若受保护页面的状态变更无 CSRF 保护，升 HIGH（组合判定，不单条升） |
  | 缺失 CSP | LOW | LOW | 纵深防御；没有 XSS 就不可利用 |
  | 缺失 `Permissions-Policy` | INFO | LOW | 报告自称 "no direct exploitation path"；降级 |
  | 缺失 `Referrer-Policy` | LOW | LOW | 仅当 URL 携带 token 时泄漏面扩大；观测不到就维持 LOW |
  | 弱套件：仅 CBC（TLS1.2+、ECDHE） | LOW | LOW | Lucky13 类攻击成本高，维持 LOW |
  | 弱套件：TLS1.0/1.1 仍可用 | MEDIUM | LOW | 协议早已弃用，降级路径现实存在；同一规则按证据升级 |
  | 弱套件：出现 NULL / anon / export / RC4 / 3DES / DES / MD5 | HIGH | LOW | 可直接破解或中间人；这才是"弱套件"应有的级别 |
  | User Enumeration | MEDIUM | CRITICAL | 单独只泄漏账号存在性，是凭据填充与定向钓鱼的前置，不导致接管；报告按业务欺诈风险评 Critical，我们不跟 |
  | Email Flooding via OTP | HIGH | HIGH | 未认证即可触发发信成本与邮箱轰炸，且可自动化滥用；若 OTP 校验端点同样无尝试上限，另立规则判 CRITICAL |
  | Client-Side Only Authorization | MEDIUM | MEDIUM | 只是页面壳被渲染，数据仍受服务端鉴权约束；若观测到 API 未认证返回数据，属于 broken access control，另立规则判 CRITICAL，不并入本条 |

- 定级原则：单条规则只对自己能证明的事实负责。跨规则的放大效应（枚举 × 无限制 OTP、客户端鉴权 × 无鉴权 API）不作为单条升级理由，否则同一条 finding 会随组合漂移，趋势与 MTTR 失去意义。
- 报告未涉及的规则（如明文 HTTP 仍可达、证书过期/链不完整）同样按此原则自定级别，用 `origin: "nightwatch"` 标注来源，不计入覆盖条目数。

### 5. judgment mechanism

在 `SECURITY_EVALUATION_JUDGMENT_MECHANISMS`（`module.ts:97-111`）注册两个确定性 mechanism：`web-baseline`、`web-behavior`。二者是纯函数——输入 observation，输出 verdict + evidence，不调用 LLM、不读数据库。

fingerprint 构造：

```
sha256(criteriaId + "\u0000" + subjectKey + "\u0000" + discriminator)
```

`discriminator` 按维度取：响应头类 = header 名；TLS 类 = 协议或套件标识；行为类 = 探测场景 id。这样"同一个头今年和明年缺失"是同一个 finding，"换了套件"是新 finding。

### 6. 覆盖矩阵（对第三方报告 14 条未覆盖项）

| 报告条目 | 我们的 severity | key | 覆盖 |
| --- | --- | --- | --- |
| 11 条响应头/TLS（X-Content-Type-Options ×2、HSTS、X-Powered-By ×2、X-Frame-Options、CSP、Permissions-Policy、Referrer-Policy、弱套件 ×2） | INFO ×4、LOW ×4、MEDIUM ×1、按证据升级 ×2 | `web-baseline` | 完整 |
| User Enumeration | MEDIUM | `web-behavior` | 完整（同参数在存在/不存在账号下的响应差分） |
| Email Flooding via OTP | HIGH | `web-behavior` | 完整（阈值内连续请求，观察是否被限速） |
| Client-Side Only Authorization | MEDIUM | `web-behavior` | **部分**（仅未认证可达子集；认证后越权不在本 ADR 范围） |

覆盖指**条目**覆盖；级别按 §4 自定，与报告的级别不一致是刻意的，逐条理由已在表中给出。

报告第 15 条（Next.js 16.2.11 AVIF RCE，报告评 Medium 并注明 GHSA 原文为 Critical）已由 `npm-osv` 以两条依赖 finding 命中，不属于本 ADR 的新增能力面，也不计入上表的 14 条。

### 7. schedules

```ts
{ evaluationKey: SECURITY_EVALUATION_KEY_WEB_BASELINE, subjectKind: WEB_ORIGIN, recommendedInterval: "daily" },
{ evaluationKey: SECURITY_EVALUATION_KEY_WEB_BEHAVIOR, subjectKind: WEB_ORIGIN, recommendedInterval: "daily" },
```

不引入 `weekly`：宿主派发只认 `daily` / `hourly`（`security-evaluation.scan.job.ts:20-25`），新增枚举值会让未升级的宿主静默漏跑。主动探测的强度由端口预算约束，不由频率约束。

## 跨宿主 / 演进检验（registry 模块设计必填）

- **无宿主词**：`web-origin`、`path`、`observation` 均为领域通用；模块不出现 `project`、`environment`、`domain` 等宿主概念，资产归属留在宿主。
- **对所有消费方一致**：不装配 `web-origin` 的宿主，其余 kind 的行为零变化；端口未绑定只在跑该 kind 时报错。
- **演进路径**：新增检查项 = 新 criteria 版本 + 可能的新 discriminator；替换扫描工具 = 只改宿主适配器，finding 语义与 fingerprint 不变；新增 kind 仍走同一套 criterion/key/mechanism 机制。

## 影响

- registry 变更点共 8 处，缺一即失效：
  1. `constants.ts`：kind 常量与 `SECURITY_EVALUATION_SUBJECT_KINDS`、两个 key、两个规则集版本、两条 schedules。
  2. `ports/web-probe.access.ts`：新增端口与观测数据结构。
  3. `criteria/security-evaluation-criteria.provider.ts`：`selectVersion` 的 `switch (subject.kind)` **必须新增 `web-origin` case**——现有 `default: return null`（`:40,74-75`）会让该 kind 的 run 取不到 criteria。
  4. `criteria/security-evaluation-criteria.seed.ts`：两个规则集版本的 seed。
  5. `evidence/`：新增 `SecurityEvaluationWebBaselineEvidenceProvider` 与 `...WebBehaviorEvidenceProvider`（或一个按 key 分派的实现），实现 `EvidenceProvider.collect()`（`evidence.provider.ts:26-36`）并调用 `WebProbeAccess`——**端口是它的下游依赖，不是 run 的直接输入**。
  6. `judgment/`：两个确定性 mechanism。
  7. `module.ts`：kind-scoped 的 criteria / evidence / judgment 绑定与 exports，加上 mechanism 注册表项。
  8. `README` 与单元测试（谓词真值表 + fingerprint 稳定性）。
- 宿主：见 nightwatch-backend ADR-044。
- 前端：`EVALUATION_KEYS`、`EVALUATION_KEY_LABEL_KEYS`、`EVALUATION_KEY_OPTIONS` 三处映射（`page.tsx:163-171`、`212-219`）与 `en.json` / `zh.json` 的 `evaluationKeyWebBaseline` / `evaluationKeyWebBehavior`。

## 迁移阶段

| 阶段 | 内容 | 行为变化 |
| --- | --- | --- |
| P0 | 本 ADR：kind / key / 端口 / criteria / mechanism 契约 + 单元测试 | 无（未装配） |
| P1 | 宿主资产、归属验证、探测适配器、sidecar（ADR-044） | 无（无资产即无 subject） |
| P2 | `web-baseline` 上线，首批资产观察一轮 | 新增响应头/TLS finding |
| P3 | `web-behavior` 上线，预算与误报调优 | 新增行为类 finding |
| P4 | 前端 key 展示与筛选；资产配置页 | 可见 |

## 非目标

- 不做认证后爬取、不做漏洞利用、不做口令暴力破解、不做端口扫描。
- 不新建 `web-security` 模块（会与 evaluation skeleton 的 run / finding 生命周期重复）。
- 不改 subject / run / finding 的 skeleton 契约。
- **不做按项目的 subject 拆分，也不做按项目的 finding 状态**：同一 origin 被多个项目引用时共用一份 run 历史、一份 finding、一个 suppress 状态。理由：域名是同一组织的同一资产，重复 triage 无收益；提交侧用归属验证门禁，而不是身份拆分来保证"谁能评估这个域名"。
- 不在模块内实现任何出网逻辑或域名白名单。
- 不评价第三方报告的检测方法论。

## 被否掉的方案

- **新建独立模块**：run 生命周期、finding 去重、MTTR、报表都已在 skeleton 里，新建等于复制一遍并把两个真源分叉。
- **把 Web 检查塞进 `code-scan`**：那是源码静态分析，输入是仓库快照；Web 检查输入是远端观测，混在一个 key 里会让 criteria 版本语义失真。
- **一个 key 混装被动与主动**：两者的出网预算与失败模式不同（被动失败通常是网络问题，主动失败可能是被 WAF 拦截），混在一起无法表达"基线成功但行为探测被拦"，也会让 severity 口径混乱。
- **用 LLM 判响应头**：确定性断言更便宜、更准、可复现；LLM 只在语义理解场景使用（ADR-054 的分界）。
- **把目标 URL 写成 criteria 常量**：目标是资产属性，写在规则里会让规则集随资产变化而版本爆炸。

## 后果

正面：Web 运行时检测进入既有评估骨架，finding 生命周期、去重、MTTR、报表、告警全部复用；检测项是数据（criteria 版本），加一条检查不需要改代码路径；探测实现可替换而不影响 finding 语义。

负面：多一个 kind 意味着 `ProjectSubjectProvider`、criteria provider、evidence provider、judgment port、mechanism 注册表、前端映射六处必须同批扩展，漏一处即静默失效；主动探测引入被 WAF 误伤与误报的可能，需要预算与白名单兜底；`web-behavior` 的判定依赖差分，目标站点的 A/B、灰度与反爬会产生假阴性，需要在 evidence 里保留原始观测以便复核。
