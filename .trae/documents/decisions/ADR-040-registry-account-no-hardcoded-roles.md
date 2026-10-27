# ADR-040: registry account 模块不再硬编码宿主 role name

状态：已采纳（2026-10-27 用户批准）
日期：2026-10-27

> 归属：registry 模块边界与契约决策 → 本仓实施。宿主侧（nightwatch-backend seed + auth bootstrap）随本决策同步改造。

## 背景

registry 的 `account` 模块在 auth auto-provision 路径中硬编码了 `"USER"` role name：

- `auth.service.ts`（password signup + Google auto-provision）：`connectOrCreate: { where: { name: "USER" }, create: { name: "USER", isBuiltin: true } }`
- `lark/lark-auth.service.ts`（Lark SSO auto-provision）：同上
- `wechat/auth.service.ts`（WeChat mini-program auto-provision）：同上

这把 nightwatch（作为一个宿主）的"新注册用户默认拿到哪个 role"的业务决定，上升成了框架级规则。其他宿主可能叫 `CUSTOMER` / `TENANT_ADMIN` / `CONTRIBUTOR` 等，不应该被迫使用 `"USER"`。

Role 体系天生是宿主语义：宿主决定有几个 builtin role、叫什么、各自权限是什么。registry 只负责 auth + identity + RBAC 基础设施（Prisma models + controllers + guards），不假设 role 的命名或默认绑定。

## 候选方案

- **A. registry 去掉硬编码，宿主 seed 提供**：registry 的 4 处 auto-provision 不再 `connectOrCreate` 任何 role；宿主 seed 必须先 upsert 好自己的 builtin roles，auth service 只做"注册 User"不绑 role。宿主通过 seed 或 auth bootstrap hook 在 user 创建后 assign 默认 role。
- **B. registry 提供 configuration callback**：registry account 模块暴露 `DEFAULT_BUILTIN_ROLE_NAMES` 常量，宿主通过 config（`newbie.config.json` 或 env）注入。registry auth service 读 config 来 assign 默认 roles。

## 决策

选 **A**。决定性理由：

1. Role 命名和默认绑定是宿主**业务语义**，不是框架配置。注入 config 只解决了命名可配，但"默认绑哪些 role、是否绑、绑单个还是多个"这些更丰富的语义无法通过单一 config 值表达。
2. 宿主 seed 已经有 upsert builtin roles 的模式（nightwatch seed.ts 里 upsert ADMIN + USER），只是从未显式把它变成"auth 依赖"。把依赖关系显性化比隐式 config 更可追溯。
3. registry 改动极小（4 处 connectOrCreate 删掉），宿主改动集中在 seed.ts + 一个薄 bootstrap 层，侵入面明确。

## 具体变更

### Registry（本仓）

删除 4 处 role 自动绑入：

| 文件 | 变更 |
|------|------|
| `auth/auth.service.ts` password signup | user.create 的 data 里删除 `roles: { create: { role: connectOrCreate USER } }` |
| `auth/auth.service.ts` Google auto-provision | 同上 |
| `auth/lark/lark-auth.service.ts` | 同上 |
| `auth/wechat/auth.service.ts` | 同上 |

注册后的 User 行没有任何 UserRole 绑定——宿主必须在 seed 或自定义 hook 里 assign。

### Host（nightwatch-backend）

宿主 seed.ts 已经 upsert ADMIN + USER + OPERATOR 三个 builtin roles。新增一条 bootstrap 路径：

- auth service 的 signup / loginByGoogle / Lark / WeChat 返回新创建的 user 后，宿主注入一个 `DefaultRoleAssignService`（或简单的 Prisma 调用）把宿主配置的默认 role（nightwatch 下是 `MEMBER`，见命名决策）绑上。
- 也可以让 auth service 返回 user ID + "是否新创建"标志，宿主在自己的 controller 或 interceptor 里 assign。两种做法都 OK，选更薄的一种即可。

### 影响

- **已有数据库**：不破坏现有 UserRole 数据——已有用户的 role 绑定行不动。只有从 registry 更新后**新注册**的用户不再自动拿 role，需要宿主 bootstrap。
- **Auth 行为不变**：signup / SSO 流程的 User 创建、Email backfill、PendingApproval gate 全部保持原样。只是少了一步 role 自动绑入。
- **scope-resolvers 不受影响**：Project / Application scope-resolvers 按 role name 匹配（`ADMIN`, `OWNER`, `EDITOR`, `VIEWER`），这些是项目内 role、与全局 Role 体系是两条独立模型。

## 不在本次范围

- PermissionSet 架构（单独决策）
- Role 命名从 USER → MEMBER / OPERATOR（随本决策一起在宿主 seed 里固化）
- ADMIN 是否需要硬编码（注释说明设计意图可接受，不运行时硬编码）
