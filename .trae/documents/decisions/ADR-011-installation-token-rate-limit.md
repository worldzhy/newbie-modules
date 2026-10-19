# ADR-011: installation 认证端点的逐 token 限流（内置于 InstallationAuthGuard）

状态：已采纳
日期：2026-10-20
归属注记：本决策治理 newbie-modules 模块代码，单一源存放于本仓（nightwatch-backend 侧编号 ADR-018，该处为同编号重定向存根）。

## 背景

ADR-009 把五个上报端点统一为 `@InstallationAuth(kind)` 认证策略，但 2026-10-19 全量审核标记：五个端点**没有任何限流**——单个持有合法 token 的 installation（失控的 SDK、循环 bug、被泄露的 token）可以无上限打满 ingest 链路，挤占其他 installation 与宿主的资源。

写代码前必须决定三件事：限流维度（按什么分桶）、执行点（在 guard 链哪一级）、覆盖面（装饰器 opt-in 还是策略内置）。

约束取证：

1. **guard 顺序**：`RateLimiterGuard` 是全局第 1 位 guard，先于认证运行，`req.installation` 尚不存在；且 `InstallationResolver.resolve()` 的返回形状是 collector 自定义的 `unknown`，security 层无法类型安全地取 `installation.id`。
2. **token 与 installation 一一对应**：每个 installation 持有唯一 token（ADR-009），按 token 分桶 ≡ 按 installation 分桶；token 轮转时旧桶自然过期，影响可忽略。
3. **凭证卫生**：不得把原始 token 作为 Redis key 落第三方存储（审核同批标记过"原始凭证写入日志/存储"类风险）；SHA-256(token) 作为桶 key 既保分桶语义又不存可用凭证——collector 侧 token 落库本就采用同一哈希先例（如 `hashHeartbeatToken`）。
4. **NAT 风险**：服务端 agent 常成群部署在同一出口 IP 后，按 IP 限流会误伤合法集群，故不复用 `@LimitAccessByIp`。

## 候选方案

- **A. 内置于 InstallationAuthGuard，按 SHA-256(token) 分桶（选定）**：guard 提取 token 后、调用 resolver 前先查限流，超限抛 429；不新增装饰器，所有 `@InstallationAuth` 端点（含未来 collector）天然被覆盖。
- **B. RateLimiterGuard 新增 `@LimitInstallationByToken` 装饰器**：第 1 位 guard 里自行解析 Bearer/body token。被否：为覆盖 web-monitor 的 bodyTokenField 例外需要复制 InstallationAuthGuard 的多源提取逻辑（含 resolver 的 legacyHeader/bodyTokenField 字段），同一提取规则存在两份必漂移；且装饰器 opt-in 意味着新 collector 可能漏配。
- **C. 按 installation.id 分桶**：要求 resolver 先 resolve（DB 命中）再限流，或把 port 契约改为强制返回 `{ id }`。被否：超限请求仍打 DB，限流的资源保护目的减半；改 port 契约为一个展示层字段扩张稳定性面，收益仅为桶 key 的可读性。
- **D. 什么都不做**：继续暴露无限流的公共 ingest 端点。

## 决策

选 A，具体形态：

1. `security/rate-limiter/rate-limiter.service.ts` 新增 `LimiterType.INSTALLATION` 与 `LimitInstallationByTokenService`，复用既有 Redis 兜底基类（Redis 已配置走 `RateLimiterRedis`，否则 `RateLimiterMemory`），配置块 `modules.security.ratelimiter.installationLimiter`（默认 `points: 120, durationSeconds: 60`——heartbeat 正常频率 2 次/分的 60 倍余量，web-monitor 突发批量上报亦够用）。
2. `InstallationAuthGuard` 注入该 service：提取 token 失败（缺失）仍 401；提取成功则先 `isAllowed(sha256(token))`，拒绝时抛 `NewbieException(Access_HighFrequency)`（HTTP 429，与 `@LimitAccessByIp` 同异常族），放行则 `increment` 后继续 resolve。
3. 不设装饰器、不改 `InstallationResolver` port 契约、五个 collector controller 零改动。

决定性理由：**限流是 installation 认证策略的内生职责而非端点的可选修饰**——公共无用户态的 ingest 端点默认就需要滥用遏制；内置于策略使覆盖面随策略自动扩展，且复用同一 token 提取路径，规则只有一份。

## 跨宿主 / 演进检验

- 不绑定 nightwatch 概念：分桶维度是 token 哈希，配置走 security 模块标准 config 块，任意宿主装配 security + collector 即获得同一行为；阈值可经 config 覆盖。
- 与 `RateLimiterGuard`（第 1 位，IP/登录维度）正交，互不感知，未来按 IP 的未认证洪泛治理可独立另案叠加。

## 影响

**更容易**：

- 单个 installation 的失控/泄露 token 被 120 次/分封顶，不再能拖垮 ingest 链路；超限响应是标准 429，SDK 侧可做退避。
- 第六个及以后的 collector 自动获得同等保护，无需记得加装饰器。

**更难 / 后续工作**：

- 未认证垃圾 token 洪泛（每个请求一个新伪造 token）不被本方案覆盖——每桶独立且 resolver 查库仍发生；该类洪泛的治理属于 IP 维度限流，需结合部署形态（NAT 集群）单独拍板，另案处理。
- 桶 key 是 token 哈希，运维排障时无法直接从 Redis key 反查 installation；需要时以 installation 的 tokenHash 列对照（与 collector 落库哈希同值）。
