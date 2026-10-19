# ADR-007: 抽取 redis foundation 模块、统一 Redis 配置契约、删除 cache 模块

状态：已采纳
日期：2026-10-15
归属注记：本决策治理 newbie-modules 模块代码，单一源存放于本仓（nightwatch-backend 侧编号 ADR-010，该处现为同编号重定向存根）。2026-10-19 起按单一源规则执行。

## 背景

registry 中 Redis 连接由三个模块各自 `new Redis()` 建立，实测同一宿主
（nightwatch）共 5 条连接：

| 建连方 | 配置来源 | db | 连接数 |
| --- | --- | --- | --- |
| web-monitor `models/redis/RedisService` | `WEB_MONITOR_REDIS`（`host:port:password:db` 弱契约字符串） | 1 | 1 |
| security `RateLimiterService` 三个子类 | `SECURITY_REDIS_HOST/PORT` | 0 | 3 |
| account `VerificationCodeService` | **跨模块读 `modules.security.redis`**（隐式耦合） | 0 | 1 |

问题：

1. **重复建连、无共享实现**，违反"同一基础设施行为必须共享"的治理规则；
   rate-limiter-flexible 官方支持同一 `storeClient` + 不同 `keyPrefix`，
   三个 limiter 本不需要三条连接。
2. **配置契约不统一**：两套 env 命名 + 一个冒号分隔字符串（密码含冒号即解析
   错误）；account 跨模块读 security 命名空间的配置。
3. **db0/db1 双库隔离**是 Redis 官方不鼓励、且 Cluster 不支持的反模式；
   实际隔离靠的是各使用方自带的 keyPrefix，db 号是多余的隔离维度。
4. health-sdk 已存在 `createRedisIndicator`（按 `getClient()` duck-type），
   事实上在等一个共享 RedisService 出现。
5. registry 内 `cache` 模块自批量导入起就是坏的：`cache.module.ts` 引用
   `../microservices.config`，该文件在 git 全历史中从未存在；且零装配、
   零模块依赖、零源码引用。

## 候选方案

1. **新建 foundation 层 `redis` 全局模块，单客户端 db0 + keyPrefix 隔离，
   统一 `REDIS_*` 契约（采纳）**。
2. 新建 redis 模块但支持命名多客户端、保留 db0/db1——"共享模块"退化为连接
   工厂，多 db 反模式永久保留。
3. 能力上移到 newbie 核心包（与 PrismaService 同级）——核心框架被迫引入
   基础设施依赖，违背 cache/queue/mongo 已确立的 foundation 层先例。
4. 什么都不做——5 条连接、3 套配置口径、隐式跨模块耦合永久存在。
5. 引入 NestJS Redis transporter（`@nestjs/microservices`）——其语义是
   进程间 fire-and-forget pub/sub，不提供 KV/数据结构操作，且无可靠性保证；
   与单体进程内 EventEmitter2 架构和 web-monitor 的队列消费诉求均不匹配。

## 决策

采纳方案 1，决定性理由：**单客户端 + 显式 keyPrefix 是唯一同时消除重复建连、
统一配置契约、消除多 db 反模式、且与 Cluster 演进路径兼容的形态**。

具体契约：

- 新模块 `packages/modules/redis`，`layer: foundation`，`@Global()`，
  导出 `RedisService`：`isConfigured()` / `getClient(): ioredis.Redis`。
- 配置：`REDIS_HOST`（空=未配置）、`REDIS_PORT`（默认 6379）、
  `REDIS_PASSWORD`（空=无密码）、`REDIS_DB`（默认 0）。
- **可选依赖语义**：未配置 `REDIS_HOST` 时不建连、不抛错；security/account
  维持现有"无 redis 则降级内存限流"的跨宿主弹性；web-monitor 是强依赖方，
  未配置时在首次取用处得到明确错误。
- security、account、web-monitor 声明 `moduleDependencies: ["redis"]`，
  ioredis 依赖从三者 manifest 上移到 redis 模块。
- web-monitor 键全部加 `web-monitor:` 命名空间（枚举与 IP 缓存键），
  与 db0 既有 `ip-*-` / `verification-code-attempt-` 前缀键零碰撞；
  db1 内临时数据（队列、30d IP 缓存、瞬时锁）作废并自然重建。
- 废弃 `SECURITY_REDIS_HOST/PORT`、`WEB_MONITOR_REDIS`；
  删除 web-monitor 私有 RedisService 与其包装方法，调用点直接用共享 client。
- **删除 cache 模块**：其不可编译且零使用方；未来若需要缓存抽象，在 redis
  foundation 之上重建。queue 模块完好且语义独立（Bull 作业队列），不在本次范围。

## 跨宿主 / 演进检验

- 不使用 redis 的宿主：不配置 `REDIS_HOST` 即可，security/account 自动降级
  内存实现，与现状行为一致。
- 使用 redis 的宿主：一套 env 契约，所有模块共享一条连接。
- Cluster 演进：单 db + 显式 key 前缀是 Cluster 兼容形态；多 db 被提前消灭。
- 不泄漏任何宿主/厂商概念；模块形态对齐 mongo foundation 先例
  （`@Global` + 单一共享连接 + 明确错误信息）。
- fewbie templates 无对旧 env 名的引用（已 grep 取证）；nightwatch 是当前
  唯一装配宿主，env 迁移只涉及本仓 `.env` / `.env.example`。

## 影响

- registry：新增 redis 模块；security/account/web-monitor 改构造注入与
  manifest；删除 cache 模块与 web-monitor 私有 RedisService。
- nightwatch：`.env` / `.env.example` 切换到 `REDIS_*`；装配后 redis 连接
  从 5 条收敛为 1 条；db1 残留临时数据作废（无持久化价值）。
- 未来 health 模块可直接用 `createRedisIndicator(redisService)` 接入健康检查；
  web-monitor 手写 rpop 队列未来可另行评估迁移到 queue/BullMQ，不在本次范围。
