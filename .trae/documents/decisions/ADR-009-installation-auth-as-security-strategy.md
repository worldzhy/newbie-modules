# ADR-009: installation 认证作为 security 第八种认证策略（复刻 api-key 模式）

状态：已采纳
日期：2026-10-19
归属注记：本决策治理 newbie-modules 模块代码，单一源存放于本仓（nightwatch-backend 侧编号 ADR-016，该处现为同编号重定向存根）。2026-10-19 起按单一源规则执行。

## 背景

nightwatch 有五个 body-token 上报端点（heartbeat/ping、health/snapshot、backend-monitor/ingest、module-hub/report、web-monitor/report/web），认证语义相同（每部署实例一个 installation token，SHA-256 哈希落库，吊销即拒），但实现各自为政：

1. **四种私有 header + 一种 body token**：heartbeat 用 `X-Heartbeat-Token`、health 用 `X-Health-Token`、backend-monitor 用 `X-Backend-Monitor-Token`、module-hub 用 `X-Module-Hub-Token`、web-monitor 用 body 内 `token` 字段。五份 controller 内联 token 解析代码（各自调用本模块 installation.service 的 `resolveByToken`）。
2. **openApiRoutes 三处机制**：`security.config.ts` 数组 + `main.ts` 的 `beforeCors` 子串匹配钩子 + `application.module.ts` 的 routeAuthentication 注册。历史上它因 web-monitor 漏打 `@NoGuard` 而成为必需品（2026-10-19 已修复对齐），残留为 CORS-only 钩子。
3. **认证决策分散**：一个端点"用什么认证"需要同时看 controller 装饰器、openApiRoutes 数组、routeAuthentication 注册三处才能回答。

写代码前必须决定：installation 认证在 security 模块中的归处，以及五个端点认证格式的统一目标。

## 候选方案

- **A. 双通道标准化，解析仍留各 controller**：五端点都接受 `Authorization: Bearer` 与 body token，各 controller 保留自己的 `resolveByToken` 调用。只统一格式不统一机制。
- **B. 复刻 api-key 模式（选定）**：`security/authentication/installation/`（decorator + guard）+ `security/ports/installation.resolver.ts`（策略接口），installation 成为 security 第八种认证策略；各 collector 实现 resolver port 查自己的表。
- **C. 新建 reporting-foundation 基础模块**：承载共享 guard 与 credential 基类，五个 collector 依赖它。被否：security 模块本就是"机制层"（不认识 User 模型，JWT 策略由 account 注入），installation 认证与 JWT 同构；新建模块等于承认 security 没完成使命，且认证链路审计要看两个模块。
- **D. 五张 installation 表物理合并**：公共列 + kind 列。被否：取证显示差异字段是真实业务（health 的 lastSnapshot*、module-hub 的 modulesSnapshot/targetSpec、web-monitor 的 appKey），合并只能选宽表全列 / JSONB 扩展 / 主表+扩展表 1:1，三者均伤类型安全或增加写放大。
- **E. 什么都不做**：保留五种私有格式与五份内联解析，加第六个上报端点继续复制一套。

## 决策

选 B，配套三项收敛：

1. **认证格式**：`Authorization: Bearer <installation-token>` 为唯一标准；web-monitor 保留 body token 作为**文档化例外**（硬约束：`navigator.sendBeacon` 不能加自定义 header，main.ts 已因 sendBeacon 的 text/plain body 开启 textBodyParser）。
2. **机制复刻 api-key 先例**（security/authentication/ 下已有 api-key/、jwt/、password/、public/ 等七个策略子目录，ports/ 下已有 api-key.verifier.ts 等策略接口）：
   - `security/authentication/installation/installation.decorator.ts`：`@InstallationAuth("heartbeat")`，隐含"跳过 JWT"语义（替代现状的 `@NoGuard()` + 手写解析）
   - `security/authentication/installation/installation.guard.ts`：解析 Bearer（web 端点读 body）→ 按 kind 路由到 collector 注册的 resolver → 校验 revokedAt → 注入 `req.installation`
   - `security/ports/installation.resolver.ts`：接口 `resolve(token, kind)`，各 collector 实现
3. **删除 openApiRoutes**：CORS `*` 改由 `@PublicCors()` 装饰器驱动（与 `@NoGuard` 同级、读 reflector 元数据设响应头），删 `main.ts` 的 beforeCors 子串匹配、security.config 数组、application.module 的 routeAuthentication 注册三处机制。

决定性理由：**不发明任何新模式**。installation 认证与 api-key 认证的同构性（都是"非人类凭证 + 策略接口由业务方实现"）意味着复刻既有模式拿到的不仅是代码复用，还有组织惯例的一致性——安全审计看 `authentication/` 一处即可看全八种准入策略。

## 跨宿主 / 演进检验

- installation 认证不绑定 nightwatch 概念：token 哈希、吊销、kind 路由均与"项目/应用"无关，宿主分组仍走各 collector 表里的 opaque `externalRef`，换任意宿主消费五个 collector 模块，本决定成立。
- web-monitor 的 body token 例外不泄漏宿主概念，是浏览器 API 硬约束，任何宿主的前端 SDK 都受同一约束。
- kind 参数（"heartbeat" 等）引用的是 collector 模块自身的 key，不是宿主层概念。
- 五表不动意味着各 collector 仍可独立装配（moduleDependencies 只加 security，与现状一致），不引入模块间新耦合。

## 影响

**更容易**：
- 加第六个上报端点 = 一张自己的表 + 实现 `installation.resolver` port + controller 上一个 `@InstallationAuth(kind)` 装饰器；不再需要发明 header 名、写解析代码、登记 openApiRoutes。
- 认证决策收口：端点用什么认证，看 controller 装饰器一处即可。
- SDK 侧格式统一：后端 SDK 一律 `Authorization: Bearer`，web SDK 继续 body token；legacy 私有 header 进入过渡期后删除。

**更难 / 后续工作**：
- 改动面跨 registry（security + heartbeat/health/backend-monitor/module-hub/web-monitor 六模块）+ 消费仓 nightwatch-backend + 五个 SDK 仓库（@devbie/heartbeat-sdk 等），需按 registry-first 流程分里程碑交付。
- legacy header（X-Heartbeat-Token 等）需保留一个过渡期，SDK 全量升级后删除；过渡期长度单独拍板。
- 实施顺序：先 security 模块的 installation 策略与 `@PublicCors()`，再逐 collector 切换；每步保持旧路径可用。
