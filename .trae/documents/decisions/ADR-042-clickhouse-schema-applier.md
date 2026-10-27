# ADR-042: ClickHouse 静态轨简化为 schema applier（退役 V*.sql 版本化迁移引擎）

状态：已采纳
日期：2026-10-27
归属注记：本决策治理 newbie-modules 模块 ClickHouse 静态表定义形态与 runner 契约，单一源存放于本仓。

Supersedes: **ADR-008** 的"registry 持有 `clickhouse/migrations/V*.sql` + 版本化前向迁移引擎"决策（退役 migrate-cli/planMigrations/checksum/历史表/discoverMigrations/splitStatements）。保留 ADR-008 的双轨框架概念和 ADR-041 的动态轨（createModel autoCreate/autoSync），不受本决策影响。

## 背景

ClickHouse 静态表（backend-monitor、url-check、work-evaluation）的 schema 定义形态在 2026-10-27 经历了一次完整的"推翻-重建"迭代：

1. ADR-008 确立 V*.sql 版本化前向迁移引擎：registry 持有 `clickhouse/migrations/V<timestamp>__<desc>.sql`，runner 扫描模块自有迁移文件，planMigrations 版本排序 + checksum 校验 + 历史表记录。17/17 单元测试全绿。
2. 10-27 同一会话内，迁移了目录名从 `clickhouse-migrations/` 到 `clickhouse/migrations/`（与 prisma/migrations/ 对称），git mv 未正确生效导致 origin/dev 新旧两套目录并存，修复时发现 registry 语义根本问题 —— **registry 的职责是永远提供最新定义，但 migrations/ 存的是历史快照**，两个概念冲突。

更深层的问题是：prisma 的 `schema.prisma → prisma/migrations/` 范式成立，因为 prisma 有内建的 schema→SQL diff 引擎（`prisma migrate dev`），且 migrations/ 归宿主持有（registry 只放 schema.prisma）。ClickHouse 无等价 diff 引擎，且 ADR-008 把 migrations/ 放在了 registry 侧，导致"registry 存历史"的语义扭曲。

Pre-launch 阶段的真实需求只有一个：**部署时确保所有模块的静态表存在，schema 是最新的**。版本追踪、checksum 校验、迁移历史审计 — 这些是上线后有生产数据时才需要的能力，pre-launch 不引入。

## 候选方案

1. **维持 ADR-008：registry 持有 V*.sql + 版本化迁移引擎**：runner 功能完整但与 registry 语义冲突（registry 存历史快照），migrations/ 目录是静态轨独有的嵌套层级。
2. **registry schema.sql + newbie update 自动生成宿主 migrations/V*.sql + diff 引擎**：概念最像 prisma，但 ClickHouse 无 SQL AST diff 工具（prisma 有内建 diff 引擎），从零写 diff 引擎是大工程；且 D 方案推演暴露出 pre-launch 下"每次输出 CREATE TABLE IF NOT EXISTS 作为 migration"不能演进 schema（表已存在时 ClickHouse 跳过，新列永远加不上）的致命缺陷。
3. **registry schema.sql + runner 直接执行（schema applier）**：registry 只放当前 DDL，runner 每次启动时扫描 `modules/*/clickhouse/schema.sql`，对每张表做 DESCRIBE TABLE diff → CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN / MODIFY COLUMN。砍掉版本追踪、checksum、历史表、discoverMigrations/planMigrations/splitStatements。

## 决策

选方案 3，决定点如下。

### Registry 侧形态

每个模块的静态表定义统一为单文件 `clickhouse/schema.sql`，内容是完整的 `CREATE TABLE IF NOT EXISTS ...` DDL：

```
packages/modules/<module>/
  clickhouse/
    schema.sql                              ← 完整 DDL，无版本号，无 migrations/
```

- **backend-monitor**：schema.sql 包含 `application_request_logs` 和 `application_error_logs` 两张表的 CREATE
- **url-check**：schema.sql 包含 `url_monitor_check_results` 一张表的 CREATE
- **work-evaluation**：schema.sql 包含 `work_evaluation_session_messages` 一张表的 CREATE

**为什么不用 migrations/ 目录**：pre-launch 下每张表只有一次 CREATE（首次建表），没有增量迁移，migrations/ 是空壳包装。未来有增量时直接改 schema.sql（DDL 是完整的当前定义），不需要在 migrations/ 里追加 ALTER 片段。

### Runner 契约（schema applier）

Runner 从"版本化迁移引擎"降级为"schema applier"，每次启动时执行：

```
对每个 clickhouse/schema.sql：
  1. 解析 schema.sql 提取表名（CREATE TABLE IF NOT EXISTS 后第一个标识符）
  2. DESCRIBE TABLE 拿实际列（表不存在时返回 null）
  3. 表不存在 → 直接执行完整 CREATE TABLE IF NOT EXISTS（不解析列定义）
  4. 表已存在 → 解析 schema.sql 提取期望列（列名+类型）
     → diffTableMeta(期望列, 实际列) → { addColumns, modifyColumns, deleteColumns }
     → 执行 ALTER TABLE ADD COLUMN / MODIFY COLUMN
     → deleteColumns 默认跳过（warn 日志）
```

#### 为什么表不存在时不解析列

ClickHouse DDL 支持复合类型（`Nested(x UInt32, y String)`、`Map(String, UInt32)`、`Tuple(...)`），简单正则按逗号拆列会断裂。但表不存在时 runner 只需要执行完整的 CREATE TABLE 字符串 — ClickHouse 本身是最可靠的 DDL 解析器，直接把 schema.sql 内容喂给 ClickHouse 的 `command` 接口即可，不需要在 runner 侧做 DDL 解析。

列解析只在表已存在、需要做 DESCRIBE TABLE diff 时才需要。这时 runner 可以用更健壮的策略：逐行扫描 CREATE TABLE (...) 块，识别顶层逗号（不在括号内）分隔的列定义，允许复合类型内部的括号。或者更彻底：**表已存在时也不解析列，直接比较 `DESCRIBE TABLE` 结果和 ClickHouse 执行 `CREATE TABLE ...` 能否成功** — 这过于复杂，不选。当前阶段只做 addColumns / modifyColumns 的简单类型对比（复用 ClickHouseService.diffTableMeta 的 normalizeType 逻辑），足够覆盖 pre-launch 和上线初期的 schema 变更模式（加列、改类型）。

#### 退役的迁移引擎代码

以下 runner 代码被**退役**而非"保留待启用"：

| 退役组件 | 原用途 | 替代 |
|---|---|---|
| `discoverMigrations()` | 扫 `clickhouse/migrations/V*.sql` | 扫 `clickhouse/schema.sql`（glob 换后缀） |
| `planMigrations()` | 版本排序 + 已应用过滤 | 无版本概念，每张表一次 DESCRIBE |
| checksum 校验 | SHA-256 防漂移 | 无（schema.sql 是唯一输入，git 版本控制兜底） |
| `_clickhouse_schema_migrations` 历史表 | 记录已应用版本 | 无（单实例 + schema.sql 即真相） |
| `splitStatements()` | 多语句切分 | 无（schema.sql 是单条 CREATE TABLE） |
| `runPlan()` | 版本顺序执行 | 无（每张表独立 DESCRIBE + ALTER） |
| `migrate-cli deploy/status` | 部署态 CLI | 改为 schema applier 入口（参数变化） |

退役理由：上线后如果需要版本追踪，当前 runner 的 schema applier 路径不与 V*.sql 引擎互斥（可以再加回来），但**当前阶段为不存在的需求预留复杂度违反 YAGNI**。

### DROP COLUMN 护栏

runner 有一个配置项 `autoApplyDropColumns`，默认值 `false`：

- `false`（默认）：schema.sql 里删掉的列（deleteColumns）→ **跳过**，只打 warn 日志：`Schema drift: runner autoApplyDropColumns=false, skipping DROP for col_b`
- `true`：执行 DROP COLUMN（生产环境严禁，只允许在临时重置场景下手动开启）

这是 ClickHouseService.createModel autoSync 的同款护栏（autoSync 能力存在但 DROP 默认被视为 safety rail）。

### 表级属性变更纪律（不可 ALTER 的属性）

ClickHouse 不支持 ALTER TABLE 修改以下属性：
- ENGINE 类型
- PARTITION BY
- ORDER BY
- SETTINGS

schema.sql 里改了这些属性后，runner 的 CREATE TABLE IF NOT EXISTS 对已存在表是 no-op — 表级属性不会被改变，但 schema.sql 和实际表会漂移。

**纪律**：上线后禁止修改 ENGINE / PARTITION BY / ORDER BY。这些是建表时定死的结构属性。如果必须改（例如分区策略优化），只能走一次性重建（手动 DROP TABLE + 按新 schema.sql 建表），属于运维操作，不走 runner 自动路径。

### 并发安全假设

本决策假设 **单实例部署**，runner 不存在并发执行问题（nightwatch 生产是单实例 + 四个容器）。多实例场景下多个 backend 进程同时启动时可能并发 DESCRIBE + ALTER，ClickHouse 的 `ALTER TABLE ADD COLUMN` 有内置锁（同一表的 ALTER 串行执行），不会丢数据但可能产生冲突日志。多实例部署时需要给 runner 加分布式锁（ClickHouse `_distributed_benchmark` 或 Redlock），届时另立 ADR。

### CLI 入口变更

`migrate-cli.js deploy` 改为 schema applier 语义：

- 原：扫描 `modules/*/clickhouse/migrations/V*.sql` → planMigrations → 按版本顺序执行
- 新：扫描 `modules/*/clickhouse/schema.sql` → 逐表 DESCRIBE + diff → CREATE IF NOT EXISTS / ALTER ADD / ALTER MODIFY
- `migrate-cli.js status`：原输出"已应用/待应用版本"，新输出"每张表的实际 schema vs 期望 schema 差异"

### nest-cli.json assets 变更

原 glob `"modules/*/clickhouse/migrations/*.sql"` 改为 `"modules/*/clickhouse/schema.sql"`（单文件，不再有 migrations/ 目录）。schema.sql 经 nest assets 进 dist，runner 在运行时从 dist 读。

### Pre-launch vs Post-launch 是同一条路径

| 阶段 | schema 变更传播 | runner 行为 |
|---|---|---|
| Pre-launch（现在） | 改 registry schema.sql → newbie update → 清库重建或重启 | DESCRIBE 空表 → CREATE TABLE IF NOT EXISTS（清库后）|
| Post-launch（有生产数据） | 改 registry schema.sql → newbie update → 发布 | DESCRIBE 已有表 → 缺列 ALTER ADD / 类型不同 ALTER MODIFY |

**没有切换点**，没有一次性迁移，没有 flag。同一份 schema.sql，同一份 runner 代码，同一条行为契约。

## 跨宿主 / 演进检验

- **宿主无关**：schema.sql 是纯 ClickHouse DDL，不引用任何 newbie 概念。下一个宿主装配 ClickHouse 静态表模块时，只需要在 nest-cli.json 加 `"modules/*/clickhouse/schema.sql"` glob 并确保 runner 存在。
- **双轨保留**：动态轨（web-monitor createModel autoCreate/autoSync）不受影响。动态轨的 schema 定义是 TypeScript 里的 ClickHouseTableConfig 对象，运行时 diff DESCRIBE TABLE，与静态轨的 schema.sql + 启动时 DESCRIBE 是两个独立机制。
- **未来版本追踪**：如果上线后确实需要版本审计，可以在 runner schema applier 路径上叠加一层 V*.sql 机制 — 两者的输入不同（schema.sql vs V*.sql）但输出相同（CREATE/ALTER）。届时另立 ADR，不提前设计。
- **单 ClickHouse 连接**：runner schema applier 和动态轨 createModel 都走 ClickHouseService 的同一个 @clickhouse/client 连接，不引入新的依赖。

## 影响

**更容易**：

- 去掉 migrations/ 空壳目录，registry 静态表定义从 V*.sql 历史快照收敛为 schema.sql 当前 DDL — 语义纯粹。
- 去掉版本追踪、checksum、历史表、discoverMigrations/planMigrations/splitStatements 等一整层迁移基础设施 — runner 代码量砍 2/3，每次部署少了一个故障模式（checksum 漂移、排序错误、历史表损坏）。
- pre-launch schema 变更传播更简单：改 schema.sql → newbie update → 清库重建，不需要"手动写 ALTER V*.sql"。

**需要纪律的约束**：

- 上线后 schema.sql 禁止删列（默认 DROP 禁用，手动开 DROP 是运维操作）。
- 上线后 schema.sql 禁止改 ENGINE / PARTITION BY / ORDER BY（ClickHouse ALTER TABLE 不支持，改了不会被应用）。
- 审计轨迹只靠 git（schema.sql 的 commit history），ClickHouse 侧无 `_clickhouse_schema_migrations` 历史表。

**执行清单**：

1. newbie-modules 3 模块：`clickhouse/migrations/V*.sql` → 合并为 `clickhouse/schema.sql`（去掉版本号和 migrations/ 子目录）
2. newbie-modules runner：从迁移引擎重写为 schema applier（DESCRIBE TABLE diff + CREATE/ALTER）
3. newbie-modules migrate-cli：deploy/status 入口改为 schema applier 语义
4. newbie-modules runner 单元测试：从 17/17 迁移引擎测试 → 替换为 schema applier 测试
5. newbie-starter nest-cli.json：glob 改为 `"modules/*/clickhouse/schema.sql"`
6. nightwatch-backend 消费侧：newbie template update + newbie modules update 同步 + 验证
7. ADR-008 Errata：追加"2026-10-27，V*.sql 迁移引擎由 ADR-042 退役"
