# ADR-041: ClickHouse 动态运行时表（web-monitor 多租户）— 采用 createModel autoCreate/autoSync 轨

状态：已采纳
日期：2026-10-27
归属注记：本决策治理 newbie-modules 模块代码，单一源存放于本仓。web-monitor 的动态轨实现位于本仓 `packages/modules/web-monitor/models/clickhouse/`。

## 背景

ADR-008 确立了 ClickHouse 双轨设计：**静态轨**（部署时刻已确定的基建表，如 backend-monitor 的 request_logs/error_logs、work-evaluation 的 session_messages）由 migration runner 前向迁移管理；**动态轨**（运行期才创建、表名带运行时参数的多租户表）不在 runner 管辖范围内。

web-monitor 是唯一已知走动态轨的模块，其三张目标表按 appId 动态生成（`web_monitor_requests_<appId>`、`web_monitor_errors_<appId>`），加上一张不带 appId 的全局表（`web_monitor_sdk_errors`）。ADR-008 仅一笔带过"动态轨 = createDatabase + createModel"，未记录动态轨的完整契约、触发时机、生命周期约束。本 ADR 补齐这部分设计。

## 决策

web-monitor 的 ClickHouse 表采用以下机制：

1. **建库**：`WebMonitorClickHouseService.onModuleInit()` 调用 `ClickHouseService.createDatabase(dbName)`，启动时确保宿主级共享库存在（ADR-015 规定 clickhouse 模块不分宿主库，web-monitor 与 backend-monitor 共用同一物理库）。

2. **建表/改表**：`ClickHouseService.createModel(config, dbName)` 内置 `autoCreate` + `autoSync` 双开关：
   - **autoCreate = true（默认）**：首次访问某 appId 时，`DESCRIBE TABLE` 返回不存在 → 从 `ClickHouseTableConfig.schema` 生成 `CREATE TABLE IF NOT EXISTS`
   - **autoSync = true**：表已存在且代码 schema 与实际列有 diff 时 → `ALTER TABLE ADD/DROP/MODIFY COLUMN` 逐列修正

3. **触发时机**：
   - 建库：**进程启动时**（`OnModuleInit`）—— 确保任何后续 appId 调用不会因库不存在而失败
   - 建表/改表：**首次访问某 appId 时**（factory 懒加载）—— 不在模块启动时预热所有 appId（appId 列表未知），按需创建

4. **表命名**：

   | 表前缀 | 类型 | 命名模式 | ClickHouseTablePrefix enum |
   |---|---|---|---|
   | web_monitor_requests | per-appId | `web_monitor_requests_<appId>` | `WEB_AJAX = "web_monitor_requests_"` |
   | web_monitor_errors | per-appId | `web_monitor_errors_<appId>` | `WEB_ERROR = "web_monitor_errors_"` |
   | web_monitor_sdk_errors | 全局单表 | `web_monitor_sdk_errors`（无 appId 后缀） | `WEB_SDK_ERROR = "web_monitor_sdk_errors"` |

   per-appId 表：factory 返回 `(appId: string) => Promise<ClickHouseModel>`，内部缓存 `models[appId]` 避免重复 createModel。
   全局表：factory 返回 `() => Promise<ClickHouseModel>`，内部缓存单个 `_model`。

5. **Schema 定义归属**：每张表的 schema（列、类型、DEFAULT、ENGINE options）以 `ClickHouseTableConfig` 对象形式写在对应 factory 文件里（`web-monitor/models/clickhouse/web/{ajax,error,sdk-error}.ts`），与 `autoCreate`/`autoSync` 开关一起定义。schema 是代码的一部分，随模块装配进宿主编译产物。

## 与静态轨的划界（不变量）

| 维度 | 静态轨 | 动态轨 |
|---|---|---|
| 建表时机 | 部署前（ch-migrate 服务） | 运行时（首次访问 appId） |
| 表名 | 固定、可枚举 | 动态、带运行时参数 |
| 建表机制 | `V*.sql` 前向迁移文件 | `createModel` autoCreate |
| schema 来源 | SQL 文件 | 代码里的 `ClickHouseTableConfig` |
| 改表机制 | 新增 `V*.sql` 文件（runner 按版本顺序执行） | `createModel` autoSync（代码 schema diff → ALTER TABLE） |
| 历史记录 | `_clickhouse_schema_migrations` 表记录已应用版本 | 无历史记录（autoSync 只比较 schema 差异，不记录每次变更） |
| 适用模块 | backend-monitor、url-check、work-evaluation | web-monitor |
| runner 管辖 | ✅ 扫描 `clickhouse/migrations/V*.sql` | ❌ 永不扫描、永不触碰 |

**为什么 web-monitor 不走静态轨**：appId 列表在 deploy 时刻未知（取决于运行时创建了哪些 web-monitor 安装），`V*.sql` 无法表达 per-appId 动态表名。这是运行时多租户表的本质限制，不是"技术上能做但没做"的选择。

## 动态轨的约束

### autoSync 的风险与 mitigation

`ClickHouseService.syncTable()` 执行 DROP COLUMN 时 ClickHouse 物理丢弃列（不同于 PostgreSQL 的 ALTER DROP COLUMN）。autoSync 在以下条件下是安全的：

- **所有变更只加列或改列类型**：加列和改类型是前向的、不破坏数据；web-monitor 当前三张表自创建以来只加过列，从未触发 DROP
- **代码 schema 是真源**：schema 只在代码里定义，运行时不手动改表；如果有人手动删了列，autoSync 会把它加回来

autoSync 的 DROP COLUMN 能力**设计上存在但应视为 safety rail**——schema 真源在代码里，永远不应该出现"表有某列但代码 schema 没有"的正常情况。如果确实出现，说明有人绕过了代码改了表，autoSync 把它删掉是正确行为。

### 并发安全

per-appId factory 内部用 `modelCreates[appId]` Promise 字典 + `models[appId]` 缓存保证：同一 appId 并发调用时只有一个 createModel 在执行，其他等待同一个 Promise。避免重复建表。

### 错误处理

autoCreate 阶段的 `DESCRIBE TABLE` 抛 ClickHouse error code 60 (table doesn't exist) 之外的错误（网络、认证）时，createModel 直接 re-throw，上层业务代码（SDK ingest endpoint）需要处理这个异常。这与静态轨的 runner 模式不同——runner 有独立的 ch-migrate 服务保证部署链路，但动态轨的错误发生在运行时业务调用链上。

## 跨宿主 / 演进检验

- **宿主无关**：动态轨机制完全在 clickhouse foundation 模块内（`ClickHouseService.createModel`），web-monitor 是第一个消费者但不绑定 nightwatch 特定的 appId 来源。fewbie 等下一个宿主如果也有运行时多租户 ClickHouse 表，直接复用同一机制。
- **未来新模块的选择准则**：判断一张 ClickHouse 表走哪条轨 → "表名和表数量在 deploy 时刻能否完全枚举？" 能 → 静态轨；不能（运行时参数决定）→ 动态轨。
- **不统一 schema 真源**：静态轨以 `V*.sql` 文件为真源，动态轨以代码对象为真源。两者都是 ClickHouse 的合法 schema 定义方式，各自适配不同的部署场景，不强行统一。
- **代价**：无 runner 改动，无新依赖。动态轨能力已存在于 clickhouse foundation 模块（`ClickHouseService.createModel`），本 ADR 记录的是 web-monitor 对该能力的具体用法与约束。

## 影响

- 确认 web-monitor 为什么**不**走 `clickhouse/migrations/V*.sql` 轨——不是遗漏，是 ADR-008 双轨设计的刻意选择
- 记录动态轨的完整契约，为未来模块提供选择准则
- autoSync 的 DROP COLUMN 能力在代码 schema 是真源的前提下是安全的；如果未来有人绕开代码改表，autoSync 会把它修正回来
