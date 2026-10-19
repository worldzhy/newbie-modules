# ADR-008: ClickHouse 静态表采用版本化前向迁移（迁移引擎沉淀进 clickhouse foundation 模块）

状态：已采纳
日期：2026-10-16
归属注记：本决策治理 newbie-modules 模块代码，单一源存放于本仓（nightwatch-backend 侧编号 ADR-014，该处现为同编号重定向存根）。2026-10-19 起按单一源规则执行。

## 背景

backend-monitor 的两张 ClickHouse 基建表（`application_request_logs` / `application_error_logs`）长期只有"手动 migration"一条落地路径：SQL 文件放在宿主仓 `clickhouse/migrations/`，ClickHouse 无 migration runner，文件头注释要求人记得在每个环境手工执行。2026-10-16 定时任务 `backend.detect-error-spikes`（每 5 分钟）在 dev 与 prod 同时报 `Code: 60 Unknown table expression identifier 'application_error_logs'`，根因不是数据问题而是**表从未被创建**：

- 生产镜像（Dockerfile.prod）不打包 `clickhouse/` 目录，实例宿主机不 clone 仓库，生产环境物理上拿不到 migration 文件；
- compose.prod.yml 的一次性 `migrate` service 只跑 Prisma，部署链路没有任何环节执行 ClickHouse DDL；
- 实例重建（runbook §4.2）后问题必然复发。

同时发现现状存在两套互不相容的 schema 机制：backend-monitor 静态表靠手写 DDL；web-monitor 的运行期多租户表（库运行时才创建、表名按 appId 动态生成）靠 clickhouse 模块 `createModel` 的 autoCreate/autoSync。需要决定：ClickHouse schema 管理的标准形态是什么、迁移引擎归属哪一层、开发态与部署态分别怎么调用。

写代码前决定，因为这涉及 newbie-modules foundation 模块的新能力、部署契约（compose/deploy.sh）和跨宿主可移植性。

## 候选方案

1. **版本化前向迁移（Flyway 语义最小集），引擎沉淀进 clickhouse foundation 模块**：`V<version>__<description>.sql` + 每库历史表 + checksum 校验 + 顺序执行；SQL 随属主模块（backend-monitor）分发；引擎提供两个薄前端（部署态 node CLI / 开发态 newbie 命名空间命令）。
2. 宿主层 shell 脚本 + 一次性 clickhouse-client 容器：只在 nightwatch 的 deploy/ 实现，按文件名顺序执行 SQL。
3. 统一改为 `createModel` code-schema + autoSync：所有表都在应用进程首访时自动建表/改表。
4. 什么都不做：保留手动 migration，只把补跑步骤写进 runbook。

## 决策

采用**方案 1**。决定性论据：

- **部署期正确性必须由部署链路保证，不能靠人记得**。与现有 Prisma `migrate` 一次性 service 同构：compose 增 `ch-migrate` 一次性服务，backend `depends_on` 其成功；deploy.sh 在发布 backend 时自动带上两个 migrate 服务，契约由脚本保证。
- **引擎属于框架不属于宿主**。clickhouse 是 foundation 层注册模块（fewbie 等下一个宿主都会消费），迁移账本/校验/执行是通用能力；SQL 属主是 backend-monitor，迁移文件放在该模块的 `clickhouse-migrations/` 目录随装配分发——"谁的表谁出 SQL，引擎只认约定目录"。方案 2 在第二个宿主上必然重造。
- **运行期多租户表与静态基建表物理上不同质，方案 3 是伪统一**：web-monitor 的库/表在部署时刻尚不存在（表名带 appId），静态迁移无法表达；且 autoSync 的 DROP COLUMN 对有数据表是危险隐式操作。保留双轨并明确划界，比强行一种机制整洁。
- 方案 4 已被生产事故证伪。

### 机制细节

- 文件命名：`V<YYYYMMDDHHMMSS>__<snake_case_description>.sql`，字典序即执行序；引擎扫描所有已装配模块的 `clickhouse-migrations/`（runner 自定位 `modules/` 根，dev 为 `src/modules`，prod 为 `dist/src/modules`，SQL 经 nest assets 进 dist）。
- 每个目标库一张历史表 `_clickhouse_schema_migrations(version, name, checksum, applied_at)`，MergeTree `ORDER BY version`；每文件成功后立即写一行。
- 只前向、无 down、禁止修改已应用文件；启动时对已应用文件做 SHA-256 checksum 校验，漂移即失败。
- **ClickHouse DDL 无事务**（与 Flyway 的固有差异）：HTTP 接口（26.x）不允许多语句且无 multiquery 设置，runner 内置 SQL 语句切分器（识别引号/标识符/注释，仅在顶层分号切分），逐条 `command` 下发；失败不写历史行，重试重跑整文件。因此 migration 公约要求 DDL 可重入（`CREATE/ADD ... IF NOT EXISTS`）、只许前向修复、禁止 DROP 有数据表。
- 三个入口共用同一引擎：部署态 `node dist/src/modules/clickhouse/migration/migrate-cli.js deploy|status`（ch-migrate 服务）；开发态 `newbie clickhouse migrate|status`（模块 manifest 声明 `"cli": "clickhouse"`，复用 newbie 已有的模块命令扩展点）；npm script `migrate:clickhouse` 兜底。生产镜像不带 src/modules 与 newbie-cli（devDependency），故生产唯一入口是编译后的 migrate-cli，不经过 newbie——脚手架命令归 newbie，部署期运维归模块可编译入口，与 `npx prisma migrate deploy` 的边界一致。

### 双轨边界（不变量）

- **静态轨**：部署时刻已确定的基建表（backend-monitor 两张表）→ runner 前向迁移；永不改成 `createModel` code-schema。
- **动态轨**：web-monitor 运行期多租户库/表 → `createDatabase` + `createModel` autoCreate/autoSync；runner 永不扫描、永不触碰其目标库（当前只迁移 `CLICKHOUSE_DB`，历史表按库独立，机制对多库就绪）。

### 干净起点

本 ADR 落地时 dev/prod 的 ClickHouse 数据均已获授权清空：两个历史手动 migration（含 DROP 的 20260926 + 加列的 20260930）合并压为单个初始迁移，直接是含 `installation_id` 的最终两张表 DDL（`CREATE TABLE IF NOT EXISTS`，无 DROP）；宿主 `clickhouse/migrations/` 目录删除。

## 跨宿主 / 演进检验

- 引擎不引用任何 nightwatch 概念：连接配置只读 `CLICKHOUSE_URL/USER/PASSWORD/DB`（与 clickhouse 模块自身 config 同一组 env）；迁移目录按"所有已装配模块下的约定子目录"发现，新宿主拥有 ClickHouse 表的模块自动纳入，零引擎改动。
- 模块 CLI 扩展点是 newbie-cli 既有通用机制（先例：aws-secrets-manager 的 `newbie secrets`），不引入宿主特例。
- 多库：历史表按目标库隔离；未来出现第二个静态库时按目录/env 扩展，账本模型不变。
- 代价：模块新增 `migration/`、`cli/` 子目录与对 `@clickhouse/client` 的既有依赖；宿主需在 nest-cli.json 声明一条 SQL assets glob（装配器可在未来版本把该约定自动化）。

## 影响

- 更容易：新环境/实例重建后 ClickHouse schema 自动就绪；新迁移只需在属主模块加一个 SQL 文件；迁移漂移在部署期被 checksum 拦截；fewbie 可直接复用引擎。
- 变更点：newbie-modules 的 clickhouse 模块（引擎 + 两个前端 + manifest cli 字段）、backend-monitor 模块（迁入初始 SQL）；nightwatch-backend（nest assets、compose.prod.yml ch-migrate 服务、deploy.sh 参数联动、package.json script、删除宿主 clickhouse/migrations）。
- 后续：dev 清 volume 验证；prod 在主线发布窗口清空 `/opt/nightwatch/data/clickhouse` 后由 ch-migrate 自动建表；backup.sh 的 clickhouse 分支将首次面对"有表"状态，发布后手动验证一次备份。
