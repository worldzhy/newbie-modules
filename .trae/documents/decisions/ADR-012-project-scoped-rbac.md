# ADR-012: 统一授权契约（系统级 RBAC + 作用域级 RBAC + 所有权分离）

状态：superseded（契约仍生效，注册仓已合入 devbie monorepo）
Superseded by: devbie monorepo ADR-018（newbie-modules 合入 devbie）+ nightwatch-backend ADR-019（宿主 RBAC 实施）+ nightwatch-backend ADR-020（RBAC gap closure）
日期：2026-10-20
归属注记：本决策治理原 newbie-modules 模块代码（security / account），模块源码现已合入 devbie monorepo。框架 SPI 契约（PermissionAuthorizer / ScopeResolver / @RequirePermission / @RequireOwner）仍由本文件描述，宿主侧实施见 nightwatch-backend ADR-019。

## 背景

现有授权契约存在三个问题：

1. **全局 RBAC 与作用域授权混淆**：`Permission.where`、`trustedMembershipId` 字段预留但从未被 authorizer 求值，无法表达"用户 X 能否操作项目 Y"。
2. **所有权检查与 RBAC 并行**：`SelfOnlyGuard` 独立于 `AuthorizationGuard` 存在，硬编码 `isAdmin` 绕过，与 RBAC 的超级用户判定分叉。
3. **ADMIN 硬编码超管**：`AccountPermissionAuthorizer` 中 `if user.roles.includes(ADMIN) return true`，使 ADMIN 角色不可被降权、不可审计。

需求：提供统一授权契约，覆盖系统级 RBAC、作用域级 RBAC、所有权三种场景，且框架通用（不绑定宿主特定资源）。

## 设计原则

- **权限作为数据**：Role、Permission 均为表数据，无硬编码特殊角色。
- **框架不绑宿主**：security 只提供机制与 SPI，account 提供系统级数据与 authorizer 实现；作用域数据由宿主自建。
- **正交组合**：RBAC（角色→权限）与所有权（数据归属）是两种不同访问控制模型，各自独立、可组合。
- **默认安全**：路由必须声明 `@RequirePermission` 或 `@NoGuard`；RBAC 默认开启。

## 决策

### 1. 两层授权模型

| 层级 | 数据 | 判定 |
|------|------|------|
| 系统级（全局） | `User → UserRole → Role → Permission(action, resource)` | 角色被授予的权限集合 |
| 作用域级 | 宿主自建（如 `ProjectMember`） | 宿主角色矩阵 |

统一 `PermissionAuthorizer.authorize(userId, requirement, scope?)` 计算有效权限集，不再分叉。

### 2. Role 表化（account 模块）

- 删 `UserRole` enum → 建 `Role { id, name, isBuiltin, description }` 表
- `User.roles: UserRole[]` → `UserRole { userId, roleId }` 关联表（`@@unique([userId, roleId])`）
- `Permission.trustedUserRole` → `Permission.roleId` FK
- 保留 `Permission.trustedUserId`（直接授用户）
- 删死列：`Permission.where`、`inverted`、`reason`、`trustedMembershipId`

超级用户 = ADMIN 角色被授予 `{ resource: "*", action: "Manage" }`，authorizer 不再硬编码 `if ADMIN return true`。

### 3. 授权装饰器

`@RequirePermission(action, resource, options?: { scope?: string })`（security 模块）

- 无 `scope` → 系统级 RBAC（查 Role→Permission 表）
- `scope` → 作用域级 RBAC（宿主解析作用域 + 角色矩阵）

作用域键为字符串，映射到宿主注册的 `ScopeResolver`。框架内置默认作用域键 `"project"`（从 `request.params.projectId` 提取）。

### 4. 所有权分离（@RequireOwner）

所有权**不是** RBAC，是独立的访问控制模型。新增 `@RequireOwner()` 装饰器（security 模块），替代 `SelfOnlyGuard`：

- 判定：资源归属当前用户（`params.userId === currentUser.userId`）→ 放行
- 非归属 → 403，除非用户拥有系统级 `{ resource: "*", action: "Manage" }` 权限覆盖
- 与 `@RequirePermission` 正交，路由可同时挂载

`SelfOnlyGuard` 删除，其 `organizationId` TODO 分支由作用域级 RBAC 承接。

### 5. Scope 类型

```ts
type Scope =
  | { type: "none" }                              // 全局
  | { type: "project"; id: string };               // 项目作用域
```

`ScopeResolver` 接口（security 模块）：

```ts
interface ScopeResolver {
  resolve(context: ExecutionContext): Promise<Scope>;
}
```

宿主通过 `SCOPE_RESOLVERS: Record<string, ScopeResolver>` 注册自定义解析器（如子资源 `applicationId → projectId`）。

### 6. PermissionAuthorizer SPI（security 模块）

```ts
interface PermissionAuthorizer {
  authorize(userId: string, requirement: PermissionRequirement, scope?: Scope): Promise<boolean>;
}
```

判定流程：
1. 系统权限 = Role→Permission 表匹配（resource 等于或 `"*"`，action 等于或 `"Manage"`）
2. `scope.type === "project"` → 查宿主成员表取角色 + 宿主矩阵过滤
3. `scope.type === "none"` → 仅系统权限

框架**不**提供成员表、角色表、矩阵——由宿主实现。

### 7. RBAC 开关（account 模块）

env 驱动：`ACCOUNT_RBAC_ENABLED`（默认 `true`）。`AccountPermissionAuthorizer` 顶部短路：

```ts
if (this.config.get<boolean>("modules.account.rbacEnabled", true) === false) {
  return true;
}
```

宿主不需要 RBAC 时设 `ACCOUNT_RBAC_ENABLED=false`，所有 `@RequirePermission` 直通。`@RequireOwner` 不受此开关影响（所有权始终校验）。

### 8. 模块归属

| 模块 | 职责 |
|------|------|
| **security** | 机制：`AuthorizationGuard`、`@RequirePermission`、`@RequireOwner`、`ScopeResolver` SPI、`PermissionAuthorizer` SPI、`PASSTHROUGH_AUTHORIZER` |
| **account** | 数据 + 实现：`Role`、`UserRole`、`Permission` 模型；`AccountPermissionAuthorizer`；权限管理 API；env 开关 |

不新建 rbac 模块——RBAC 横跨 security（机制）和 account（数据），两者职责已清晰。

### 9. 三道门禁

1. **registry CI（契约测试）**：每个 route 必须有 `@RequirePermission` 或 `@RequireOwner` 或 `@NoGuard`，仿 `login-audit-coverage.test.ts`。
2. **宿主 boot（矩阵完备性）**：每个 scoped 路由的 `(resource, action)` 必须在宿主矩阵中存在。
3. **UI**：资源候选项由 `@RequirePermission` 装饰器反向生成。

## 非目标

- 框架不提供 ProjectMember / ProjectRole / 矩阵——宿主自建。
- 框架不做逐资源行级授权（同作用域内同类型资源权限相同）。
- 框架不假设 scope=Project（Project 只是资源之一）。

## 影响

**更容易**：
- 宿主可结构化修复 IDOR，所有端点默认受授权约束
- 所有权与 RBAC 正交，概念清晰
- ADMIN 不再硬编码，可降权、可审计

**更难 / 后续工作**：
- account schema migration：Role 表、UserRole 关联表、Permission.roleId FK、删 4 死列、`User.roles` enum → Role 表行
- security 模块：`@RequirePermission` 加 scope 选项、`@RequireOwner` 装饰器、`ScopeResolver` 接口、guard 调 resolver、删 SelfOnlyGuard
- account 模块：`AccountPermissionAuthorizer` 实现 scope 判定、去 ADMIN 硬编码、env 开关
- 数据迁移：现有 `User.roles` enum 数组 → Role 表行（ADMIN→ADMIN 角色授 `*:Manage`，USER→USER 角色）
