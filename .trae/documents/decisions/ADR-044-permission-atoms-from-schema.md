# ADR-044: 权限模型原子化——资源由 schema 派生，动作只保留动词，通配符归零

状态：已采纳（2026-10-28 用户确认方案 C：彻底版）
日期：2026-10-28
归属注记：本决策治理 newbie-modules `account` 模块的权限词汇（`PermissionAction`）、`PermissionAuthorizer` 的匹配语义，以及 `me()` 的导航解析方式；分组归属这类信息架构策略留在宿主 seed，不进 registry。
Supersedes：本决策不取代整份 ADR，但对 ADR-012（project-scoped RBAC）的授权匹配语义作出补充收紧；并将 ADR-040（registry account 不硬编码角色）推进到"代码中不再出现任何角色名判断"。

## 触发问题

现行权限模型把三种不同性质的东西塞进了同一个枚举：

| `Manage` 扮演的角色 | 位置 | 问题 |
| --- | --- | --- |
| 某个 handler 的**必需动作** | 20 处 `@RequirePermission` 调用点 | 一个只做 Create 的 endpoint 要求"全部权限"，语义过度授权 |
| 授权的**量词**（一条 grant 覆盖所有动作） | `PermissionAuthorizer.matches()` | 与"资源通配 `*`"并列，形成第二个通配轴，匹配函数需要两处特判 |
| **超管表达式** | `roles.ts` 里 ADMIN 的 `{ action: "Manage", resource: "*" }` | 超管能力藏在动作枚举里，无法表达"资源全集的多个动词组合" |

更深一层：`Manage` 不是动作，是"覆盖所有动作"的量化标记。把它放进动词枚举，等于让"有哪些动作"和"这条授权覆盖多少动作"共用一个维度，于是全量授权有两种等价表示（一行 `Manage` 或五行动词），只读授权反而无法表达。

同时，资源清单本身是手写的（`permission-groups.ts` 的 `resources: string[]`）。新增 Prisma model 后若忘记补清单，该资源的接口只有 ADMIN 可达，其余角色静默 403，且没有任何机制能发现。

## 决策

### 1. 资源词汇 = schema 派生集合 ∪ 概念补充

`resource` 的唯一结构真源是 Prisma schema 的 `@@schema(...)` 命名空间：

```
model 名 ← 扫描 prisma/models/*.prisma + prisma/schema.prisma 中
           @@schema("module/<x>") / @@schema("application") 的 model
```

约 45 个模型资源可全自动派生。另有约 15 个概念资源没有 Prisma 模型对应物（ClickHouse 表、聚合视图、外部系统动作，如 `ThreatIntelligenceItem`、`DependencyScan`、`BackupRun`、`LarkMessage`、`SecurityOverview`），由分组的 `extraResources` 显式声明。

### 2. 动作词汇收敛为纯动词

```
PermissionAction = { List, Get, Create, Update, Delete }
```

删除 `Manage`。全量授权不再有专用表示，就是五个原子行的并集——而原子行由 schema 派生，零手写成本。

### 3. 匹配语义退化为严格相等

```ts
function matches(required: { action: string; resource: string }, grant: { action: string; resource: string }) {
  return grant.resource === required.resource && grant.action === required.action;
}
```

资源通配 `*` 与动作通配 `Manage` 同时退役，匹配函数不再有任何特判分支。授权 = 原子集合的成员关系，没有"这一行覆盖所有事"的逃逸口。

### 4. 分组只声明组合规则，不声明原子

`PermissionGroup` 的定义从"资源清单"降级为"组合规则"，seed 在运行时派生原子行：

```ts
{
  name: "Work Evaluation",
  routePath: "/work-evaluation",
  /* nav 元数据不变 */,
  namespaces: ["module/work-evaluation", "module/evaluation"], // 该命名空间全部 model
  extraResources: [],        // 无 model 对应的概念资源
  excludeResources: [],      // 必要的减法（见决策 6）
  actions?: PermissionAction[], // 组级天花板，缺省 = 全部 5 个动词
}
```

派生式：

```
原子集合 = (⋃ namespaces 下的 model ∪ extraResources − excludeResources) × (actions ?? 全部动词)
```

`namespaces` 天然支持多组共享同一命名空间（`module/evaluation` 同时被 Security Evaluation 与 Work Evaluation 引用），与 authorizer 的 UNION 语义一致。新增 model 自动落入所属分组，资源清单漂移问题消失。

### 5. 超管 = 绑定派生的 `All` 组，不再是角色名判断

新增一个内建分组 `All`：`navPlacement = NONE`，原子集合 = 全部派生资源 × 全部动词。

- `roles.ts` 中 ADMIN 的 `permissions: [{ action: "Manage", resource: "*" }]` 删除；
- seed 将 ADMIN 绑定到 `All` 组 + 全部内建分组（后者保证导航可见性）；
- `account.service.ts` 中 `if (roles.includes("ADMIN")) { ... 返回全部分组 }` 的特殊分支**删除**，导航统一走"已绑定分组并集"。

代码中不再出现任何角色名判断，超管能力完全由数据表达（推进 ADR-040）。副作用：将来新建的自定义分组不会自动出现在 ADMIN 导航里，需要显式绑定 ADMIN——这是可接受的显式性代价，且不影响授权（`All` 组已覆盖全部 schema 资源）。

### 6. `excludeResources` 是必要算子

命名空间全收会把内部表一并授权。`module/account` 下的 `Session`、`ApiKey`、`VerificationCode`、`Email`、`UserRole`、`ApprovedSubnet` 等不应随 IAM 分组的原子进入业务角色可达集，必须显式排除。没有减法算子就是隐性扩权。

### 7. 覆盖校验门（fail-fast）

新增静态校验：

```
∀ @RequirePermission(action, resource) 调用点
    ⇒ (action, resource) ∈ 派生供给
否则构建/seed 失败
```

供给 = 全部分组派生原子（含 `All`）的并集。校验挂两处：seed 之后、`newbie doctor`。反向检查（派生但无路由引用）只记 info，不失败——死原子无害。

## Cross-host check

| 维度 | 框架层（newbie-modules registry） | 宿主层（nightwatch-backend） |
| --- | --- | --- |
| 动作枚举 | `PermissionAction` 收敛为 5 个动词 | 同步渲染副本；无宿主私有动作 |
| 匹配语义 | `PermissionAuthorizer` 实现改为严格相等 | 不改 SPI 签名，`authorize(userId, {action, resource}, scope?)` 不变 |
| 超管表达 | 不内建超管概念（registry 不识别角色名） | seed 生成 `All` 组并绑定 ADMIN |
| 资源清单 | 不持有；由宿主 schema 派生 | `namespaces` / `extraResources` / `excludeResources` 声明 |
| 分组组合 | 不持有 | `permission-groups.ts`（信息架构属宿主策略） |
| 校验门 | 不持有 | `scripts/verify-permission-coverage.ts` + doctor |

## 影响

**更容易**：

- 新增 model 即获得完整 CRUD 原子，无需手工补清单；
- 只读分组等部分授权成为一等公民（`actions: [List, Get]`）；
- 匹配函数从两处特判退化为一行相等比较；
- 代码中不再有角色名字符串。

**需要纪律**：

- 新概念资源（无 Prisma 模型）必须写进某个分组的 `extraResources`，否则校验门会拦下其路由；
- 命名空间全收意味着敏感内部表必须靠 `excludeResources` 显式挡住；
- 新建自定义分组不会自动进入 ADMIN 导航，需显式绑定。

**执行顺序（pre-launch，无存量数据迁移）**：

1. 改 registry `account` schema：删除 `Manage` 枚举值（宿主导出副本同步）；
2. 清空权限相关表（或整库重建）后 `db push`——避免枚举值仍被行引用时 push 失败；
3. 重写 `permission-groups.ts` 为派生式 + `All` 组；删除 `roles.ts` 的 ADMIN 通配权限行；
4. 简化 `permission.authorizer.ts` 的 `matches()`；
5. 删除 `account.service.ts` 的 ADMIN 分支；
6. 收紧 20 处 `@RequirePermission` 调用点为具体动词；
7. 新增覆盖校验门并跑通；
8. registry ↔ 宿主机械同步，双仓提交。

## 不做什么

- 不保留 `Manage` 作为"历史兼容"死值——pre-launch 无存量数据，物理删除零成本；
- 不新增动作通配 `*`（Prisma enum 成员必须是合法标识符，且通配本身就是本决策要消灭的东西）；
- 不引入"超管 boolean 列"或角色名白名单；
- 不做运行时权限管理 UI（13 个分组规模下 seed 完全够用）。

## 落地记录（2026-10-28）

- 动作枚举：registry `packages/modules/account/prisma/schema.prisma` 与宿主 `prisma/models/account.prisma` 同步删除 `Manage`；`matches()` 已退化为一行严格相等。
- 超管：宿主 seed 新增内建分组 `All`（`navPlacement = NONE`、`allResources: true`），ADMIN 绑定 `All` + 全部内建分组；`roles.ts` 删除 ADMIN 通配权限行并清理 ADMIN/MEMBER 的残留直授行；`account.service.me()` 的 `roles.includes("ADMIN")` 分支已删除。导航 = 已绑定分组并集（`All` 因 `NONE` 不出现在 header）。
- `OwnershipGuard` 的超管判定改为 `{ resource: "User", action: "Update" }`（即 IAM 分组能力），不再使用 `{ "*", "Manage" }`——否则收紧通配后该旁路会静默失效。
- 内建分组由 13 增至 14（+`All`）。`module/account` 的 `ApiKey` / `ApprovedSubnet` / `Email` / `Session` / `UserRole` / `VerificationCode` 通过 `excludeResources` 挡在 IAM 之外；AWS SES 的 4 个概念资源（会话 / 统计 / 抑制列表）补入 Security Ops，否则覆盖校验门会拦下。
- 动作映射：建组/加权限 → `Create`，列表 → `List`，详情 → `Get`，改组/重排/替换绑定/轮换凭证/重试开通/项目初始化 → `Update`，删组/撤权限/回收凭证 → `Delete`；`scope-matrix` 的 `Manage` 行同步删除（项目初始化因此从 OWNER 放宽到 EDITOR+，符合"修改项目"的语义）。
- 校验门：`scripts/verify-permission-coverage.ts`（`npm run verify:permissions`），在 `prisma/seed.ts` 启动时先跑（fail-fast 早于任何写入）。`newbie doctor` 没有运行宿主脚本的钩子，故未接入 doctor。
