# ADR-048: 显式 scope 优先于系统级 grant（授权求值顺序）

状态：已采纳
日期：2026-11-01
归属：框架层（newbie-modules registry：`packages/modules/account/security-ports`、`packages/modules/security/ports`）
关联：newbie-modules ADR-017（scope 名由宿主声明）、newbie-modules ADR-012（项目级 RBAC 契约）、nightwatch-backend ADR-019（宿主实施）、nightwatch-backend ADR-039（security-evaluation 按平台级模块建模，已退出项目 scope，不在本决策范围内）

## 背景

`AccountPermissionAuthorizer.authorize` 当前的求值顺序是：

1. `rbacEnabled=false` → 放行；
2. 系统级 grant（`Permission` 直授，或 `PermissionGroupPermission` 经角色继承）命中 → `return true`；
3. 都没有 → 若 Guard 传入了 scope 且宿主绑定了 `ScopePermissionChecker`，交给 scope 检查；
4. 否则拒绝。

`AuthorizationGuard` 只会对 `HOST_SCOPED_RESOURCES` 中的资源解析 scope（ADR-017）。于是出现了组合失效：

- 资源**不在**清单 → 无 scope 传入 → 系统级 grant 决定一切；
- 资源**在**清单 → 传入了 scope，但持有系统级 grant 的调用方在步骤 2 就已放行，**scope 检查根本不会执行**。

结论：清单对「持有系统级 grant 的角色」等于不存在。security-evaluation round4 的 R4-02 就是这个组合的直接后果——OPERATOR 角色被 seed 绑定了 Security Evaluation 权限组（系统级 grant），因此可以凭客户端自报的 `scopeId` 读任意项目的资产、findings、报告，也能对任意项目触发 run。

这不是某个模块的实现缺陷，而是框架层求值顺序的问题：**系统级 grant 表达「这个用户能使用这项功能」，scope 表达「这个用户对这份数据有权」**。两件事被一个 OR 折叠后，功能可见性就变成了数据豁免。

> 范围注记（2026-11-02）：security-evaluation 已按平台级模块建模（nightwatch-backend ADR-039），R4-02 由该 ADR 消解，不在本决策范围内。本决策只处理确有项目隔离诉求的资源——nightwatch 现有 12 个作用域资源。
>
> 术语：本文把 `HOST_SCOPED_RESOURCES` 称作「作用域资源清单」（scoped-resource registry）。登记的含义是「该资源的授权必须按数据 scope 求值」，不是「允许访问的资源名单」——登记是义务声明，不是放行。下文一律用「登记 / 清单成员」，不用「白名单」。

## 候选方案

### A. 维持现状：系统级 grant 覆盖一切

改动为零。代价是项目边界对任何持系统级 grant 的角色失效；只要宿主把某个资源登记进清单（ADR-017 的预期用法），就会得到一个「看起来接入了，实际上没生效」的假防护。R4-02 之后任何模块都会重复踩同一个坑。

### B. 并集：grant 或 scope

`grant || scopeChecker.check(...)`。语义上等于 A（grant 命中仍然放行），只是多跑一次查询，不能解决问题。

### C. 显式 scope 优先（建议）

scope 一旦解析成功就只信 scope；系统级 grant 只在「没有 scope 语义」的路由上生效。

## 决策

采纳 **C**。`authorize` 的求值顺序改为：

1. `rbacEnabled=false` → 放行（宿主 kill switch 语义不变）；
2. scope 存在且 `type !== "none"` → 宿主绑定的 `ScopePermissionChecker` 是唯一判据；未绑定该端口时 fail-closed 拒绝（不静默降级为系统级 grant）；
3. scope 为 `{ type: "none" }`（资源在清单内但当前请求解析不出 scope）→ fail-closed 拒绝。清单语义即「本项目作用域的授权路由一定带可解析的 scope」的承诺，解析失败说明路由或 resolver 有缺口，不能退回系统级授权；
4. 无 scope（资源不在清单）→ 走原有系统级 grant 两条 UNION 路径；
5. 无 scope 且无 grant → 拒绝。

不变量：**scope 与 grant 不做 OR**。宿主按资源 opt-in（登记即接受第 2/3 条），未登记的宿主行为完全不变。

### 为什么 `{ type: "none" }` 也要拒绝

`{ type: "none" }` 有两种可能：请求确实与任何项目无关（平台全局），或 resolver 没解析出来。前者应该由「不登记进清单」表达，而不是靠 `none` 表达；后者是真缺口。让 `none` 直接拒绝，可以把「路由漏配 resolver」从静默越权变成显式 403，符合 fail-closed 的既有取向。

## 跨宿主 / 演进检验

| 维度 | 框架层（本 ADR 改动） | 宿主层（不变） |
|---|---|---|
| 接口签名 | `PermissionAuthorizer.authorize(userId, {resource, action}, scope?)` 签名不变，只改求值顺序 | 不改绑定方式 |
| Scope 类型 | 沿用 `{type:"none"}` / `{type:"project"; id}` | 宿主自行注册 resolver 与矩阵 |
| 资源枚举 | 框架层不定义；清单由宿主声明（ADR-017） | nightwatch 侧见 ADR-039 |
| 可移植性 | 其他宿主按 ADR-017 声明作用域资源即获得同样的边界语义 | 成员表、矩阵、种子数据仍是宿主特有 |

## 影响

- **行为变化（需迁移核对）**：已登记的 12 个作用域资源（`AwsAuditScan`、`Task`、`WebMonitorSite` 等）在 scope 解析失败时由「系统级 grant 放行」变为 403。落地前必须逐个确认其所有路由都能解析出 scope，否则会打断现有前端调用。
- 持有系统级 grant 但不是项目成员的角色，在作用域资源上将首次被拒绝——这是本决策的目的，但需要在种子/运维文档里同步说明。
- `ScopePermissionChecker` 的 SPI 注释需要改写：不再是「系统级未命中时的兜底」，而是「有 scope 时的唯一判据」。

## 实现切面（按顺序）

1. `account/security-ports/permission.authorizer.ts`：按上述 5 步重写 `authorize`。
2. `security/ports/scope-permission.authorizer.ts`：更新 SPI 文档注释与 `ScopePermissionChecker` 契约描述。
3. 契约测试（`account` 侧）：fake Prisma + fake scopeChecker 覆盖四个组合——grant 命中 + scope 允许 → 允许；grant 命中 + scope 拒绝 → 拒绝；grant 命中 + `none` → 拒绝；无 scope + grant 命中 → 允许。
4. 消费仓迁移核对（nightwatch）：12 个作用域资源的路由 → scope 可解析性清单，缺的补 resolver，完成后才升本 ADR 为「已采纳」。

## 落地记录（2026-11-02）

- 切面 1–3 已在 registry 完成：`authorize` 按五步求值；SPI 注释改为「有 scope 时的唯一判据、未绑定即拒绝」；契约测试 7 例（grant/scope 四组合、无 grant 的 scope 放行、未绑定 checker、无 scope 无 grant、kill switch）。
- 切面 4 核对结论：`AuthorizationGuard` 在本次改动之前就已对清单成员在 scope 解析失败时返回 `false`（`resolveHostScope() === null`），因此本决策不会让任何**当前可用**的项目路由变为不可用；新增的拒绝对象只有「持系统级 grant 但不是项目成员」的调用方，这正是决策目的。
- 清单盘点：10 个资源有控制器路由；`WebMonitorSite` 的 `/list`、`/getSysForUserId` 显式 `{scope:"self"}`，属于「按调用者身份取数」的豁免，仍只走系统级 grant——登记刻意不覆盖 `self` 路由，这是已知边界。`AwsAuditScan`、`DependencyScan` 在 nightwatch 当前无控制器引用，属清单中的惰性条目（清理候选，不影响授权）。
- 启动校验：`MatrixCompletenessValidator` 通过，59 个 `(resource, action)` 组合在矩阵中有 rank 行；后端以新构建重启后 `/` 返回 200。
- 残余：宿主暂无「非项目成员但持系统级 grant」的账号，未做 403/200 的端到端对照；如需回归，可在 seed 里加一个仅系统级 grant 的测试角色。
