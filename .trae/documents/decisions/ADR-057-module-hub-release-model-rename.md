# ADR-057: module-hub 发布模型重命名为 ModuleHubRelease

状态：已采纳
日期：2026-11-13
归属注记：本决策治理 registry 模块 `module-hub` 的 Prisma 模型命名与物理表名，存放于本仓。nightwatch-backend 侧为机械同步 + 数据库迁移执行，不另立 ADR。

## 背景

`module-hub` 模块的两个 Prisma 模型命名轴不一致：

| 现状 | 命名轴 |
|------|--------|
| `ModuleHubInstallation` | 模块前缀在前（ModuleHub + Installation） |
| `HubModuleRelease` | 模块前缀被切成 `Hub` + `Module`，与模型读取方（registry 发布目录）语义错位 |
| 服务类 `ModuleHubReleaseService` | 模块前缀在前 |
| 审计资源类型 `module-hub-release` | 模块 key 在前 |

同一个领域里，安装记录叫 `ModuleHubInstallation`，发布记录却叫 `HubModuleRelease`——两个都是 module-hub 的子实体，前缀必须一致。服务类已经按 `ModuleHubReleaseService` 退出错位，模型没有跟上。

## 决策

模型 `HubModuleRelease` 重命名为 `ModuleHubRelease`，物理表名随之改变。

决定性理由：

1. **前缀一致性**——同一模块的子实体统一用 `ModuleHub*` 前缀，读者不需要记忆"哪个模型前缀被切开了"。
2. **服务类已先对齐**——`ModuleHubReleaseService`、`module-hub-release` 审计资源类型都在模块轴命名，模型是最后一个错位点。
3. **零语义变化**——仅命名调整，字段、索引、唯一约束不变；发布历史的选择逻辑（`pickLatestReleases`）完全不变。

## 影响

### 改名范围

| 层 | 位置 | 改动 |
|----|------|------|
| Prisma 模型 | `packages/modules/module-hub/prisma/schema.prisma` | `model HubModuleRelease` → `model ModuleHubRelease` |
| 物理表 | 同上（无 `@@map`） | `"module/module-hub"."HubModuleRelease"` → `"ModuleHubRelease"` |
| 类型导入与返回类型 | `services/release.service.ts` | `HubModuleRelease` → `ModuleHubRelease` |
| Prisma 访问器 | 同上 | `prisma.hubModuleRelease` → `prisma.moduleHubRelease` |
| 测试 mock 键 | `services/release.service.test.ts` | `hubModuleRelease` → `moduleHubRelease` |
| 权限资源键 | `controllers/installation.controller.ts` | `Prisma.ModelName.HubModuleRelease` → `ModuleHubRelease` |
| 消费仓装配产物 | nightwatch-backend `src/modules/module-hub/**`、`prisma/models/module-hub.prisma` | 由 `newbie modules apply` 生成，不手改 |
| 数据库 | nightwatch-backend `prisma/migrations/**` | 新增迁移：`ALTER TABLE ... RENAME TO ...` + 权限资源字符串数据迁移 |

### IAM 权限持久化

`Permission.resource` 与 `PermissionGroupPermission.resource` 以字符串存模型名（`Prisma.ModelName.*`）。模型改名后旧值 `HubModuleRelease` 不再匹配任何路由，需要在新迁移中同步：

```sql
UPDATE "module/account"."Permission" SET resource = 'ModuleHubRelease' WHERE resource = 'HubModuleRelease';
UPDATE "module/account"."PermissionGroupPermission" SET resource = 'ModuleHubRelease' WHERE resource = 'HubModuleRelease';
```

### 数据库迁移

nightwatch-backend 已上线（ADR-036），不允许 `prisma db push`。迁移由 `npx prisma migrate dev --name rename-module-hub-release` 生成并提交 `prisma/migrations/**`。

### 历史 ADR 处理

无。此前没有 ADR 固化该模型的命名；本 ADR 为首次决策。

## Cross-host check

| 维度 | 框架层（registry 模块） | 宿主层（nightwatch-backend） |
|------|------------------------|------------------------------|
| 模型定义 | `ModuleHubInstallation` / `ModuleHubRelease` 前缀统一 | 不新增模型，仅装配 |
| 表名 | 随模型名变化，无 `@@map` | 迁移脚本执行物理改名 |
| 权限资源 | controller 使用 `Prisma.ModelName.ModuleHubRelease` | 迁移把存量 `Permission.resource` 行改到新值 |
| 可移植性 | 任意消费方按新装配产物即可；新宿主首次迁移直接建新表名 | 存量宿主需一次数据迁移，之后无持续成本 |
