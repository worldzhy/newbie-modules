# ADR-010: 删除 route-authorization 机制（死代码，与装饰器授权路径重复）

状态：已采纳
日期：2026-10-20
归属注记：本决策治理 newbie-modules 模块代码，单一源存放于本仓（nightwatch-backend 侧编号 ADR-017，该处为同编号重定向存根）。

## 背景

security 模块的 authorization 子域有两条并行的授权路径：

1. **装饰器路径（活）**：`@RequirePermission(action, resource)` + `AuthorizationGuard`（全局第 4 位 guard）+ `PERMISSION_AUTHORIZER` port。audit、organization、llm、account 等模块 20+ 处在用。
2. **配置路径（死）**：`RouteAuthorizationService.configureRouteAuthorization()` + `RouteAuthorizationGuard`（全局第 5 位 guard）。全仓（registry 与唯一消费宿主 nightwatch-backend）**零调用方**——没有任何模块调用过 `configureRouteAuthorization`，`routeConfigs` 恒为空数组，guard 对每个请求两次 `find` 后恒 `return true`。

配置路径是历史遗留（nightwatch-backend ADR-016 spec 已标注"不处理 configureRouteAuthorization（历史遗留，另案）"，本 ADR 即另案）。它不死还只是冗余，更糟的是它的匹配语义本身有缺陷：`url.includes(config.path)` 子串匹配与 2026-10-19 审核标记的"开放路由白名单子串匹配过宽"同类，一旦真被启用就是授权绕过面。

写代码前必须决定：删除，还是作为"框架能力"保留（对照：ADR-009 明确保留了同构的 route-authentication 机制）。

## 候选方案

- **A. 删除整套 route-authorization（选定）**：删 `route-authorization.guard.ts`、`route-authorization.service.ts` 及 `SecurityModule` 中的注册/导出。保留装饰器路径全部件（`AuthorizationGuard`、`@RequirePermission`、`PERMISSION_AUTHORIZER` port）。
- **B. 作为框架能力保留（对照 route-authentication 先例）**：ADR-009 保留了 `RouteAuthenticationService/Guard`。但两者处境不同：route-authentication 的 `isPublic`/`getGuardForRoute` 被 `AuthenticationGuard`（第 2 位）真实消费，保留的是活机制；route-authorization 从 service 到 guard 无任何消费方，保留的是纯死代码。
- **C. 什么都不做**：继续让第 5 位 guard 恒真空转，注释"5th priority guard"持续误导读者以为存在路由级授权。

## 决策

选 A。决定性理由：**配置路径与装饰器路径解决同一问题且语义更差**（子串匹配 vs 精确元数据），保留两套授权机制意味着未来某次启用配置路径时会与装饰器路径产生优先级与覆盖范围的歧义；授权机制必须单一，而唯一在用的装饰器路径已经覆盖了配置路径的全部表达能力（permission 与 policy 都可用 `@RequirePermission` + 自定义 guard 等价实现）。

`PERMISSION_AUTHORIZER` port 不删：`AuthorizationGuard`（装饰器路径）依赖它，account 模块的绑定继续有效。

## 跨宿主 / 演进检验

- 删除不触碰任何活行为：guard 恒真，service 无状态、无外部依赖，删除前后每个请求的处理结果逐字节相同。
- `RouteAuthorizationService` 虽被 `SecurityModule` export（模块公共面），但 registry 内与唯一消费宿主内均无注入方；未来宿主若需要路由级授权，正确路径是装饰器 + 自定义 guard，而非复活子串匹配机制。
- 不泄漏宿主概念，方向相反（移除的是 registry 自己的历史遗留）。

## 影响

**更容易**：

- 授权机制单一化：回答"这个端点谁有权访问"只需看装饰器一处；安全审计不再需要评估一条从未启用且匹配语义有缺陷的旁路。
- 全局 guard 链从 5 级收敛为 4 级，每请求少两次空 `find`。

**更难 / 后续工作**：

- 无功能损失；若未来出现"按 URL 前缀批量授权"的真实需求，应以新 ADR 设计精确匹配机制，不得复活子串匹配。
