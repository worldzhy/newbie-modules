# ADR-013: backend-monitor ClickHouse 表名加模块前缀（application_* → backend_monitor_*）

状态：已采纳
日期：2026-10-22
归属注记：本决策治理 registry 模块的数据面命名契约（真源为 `packages/modules/backend-monitor` 的 clickhouse-migrations 与查询代码），存放于本仓；nightwatch-backend 侧为装配产物与宿主查询层的同步执行，不另立 ADR。

## 背景

2026-10-22 全系统 ClickHouse 表名评审（10 张表逐一核对）判定：`application_request_logs` / `application_error_logs` 命名不恰当（中度）。问题本质：

1. **前缀泄漏宿主概念**：`application_` 来自 nightwatch 的 Application 模型语义。backend-monitor 是 registry 通用 collector 模块，任意宿主装配后数据面表名仍以某个具体宿主的概念开头，违反"禁止把具体宿主概念焊进通用模块"原则（2026-10-08 用户明确）。
2. **与既有惯例不一致**：同库其余表均遵循"模块 key snake_case 前缀"——`url_monitor_check_results`（宿主 url-monitor）、`_clickhouse_schema_migrations`（迁移引擎自有）。唯独 backend-monitor 两张表无前缀，读者无法从表名判断归属模块。

命名法则（本次评审定稿，适用于全部数据面命名）：全单词禁自创缩写；模块 key 转 snake_case 作前缀；剔除语义过时词；单复数一致。

约束取证：

- 表名真源在 registry `clickhouse-migrations/V20261016000000__init_backend_monitor_tables.sql`（CREATE TABLE IF NOT EXISTS，前向-only 迁移引擎 ADR-014/devbie）。已 applied 的实例不会因 SQL 修改而重跑，存量数据须以 `RENAME TABLE`（ClickHouse 瞬时元数据操作，零数据搬迁）保数据；新装实例直接得到新名。
- 引用面（2026-10-22 grep 取证）：registry 侧 service 插入/查询 6 处 + DTO 注释 2 处 + README 2 处 + 迁移 SQL 3 处；宿主 nightwatch-backend 应用层 analysis（query-isolation / prompt-builder / 测试）、scheduled-jobs（错误尖峰检测）、copilot datasource 模板等约 30 处 SQL 字符串字面量。
- 列名 `application_id` **不动**——它表达领域含义（被监控应用的稳定 UUID，模块-hub externalRef 映射），在任意宿主下成立；本次只改表名前缀，不改列契约。

## 候选方案

- **A. 加模块前缀 `backend_monitor_`（选定）**：`backend_monitor_request_logs` / `backend_monitor_error_logs`，与 `url_monitor_check_results` 同一惯例，表名自含模块归属。
- **B. 泛化前缀 `monitor_request_logs`**：被否——`monitor_` 过宽，web-monitor / url-monitor / backend-monitor 同库并存时会再次歧义；前缀必须精确到模块 key。
- **C. 维持 `application_*` 不改**：被否——宿主概念泄漏是实名缺陷，且评审已判定不恰当；无外部消费方，改名成本仅限本生态，现在是唯一低成本窗口。

## 决策

选 A，具体形态：

1. registry `packages/modules/backend-monitor`：迁移 SQL 两表改名（含注释）、`backend-monitor.service.ts` 插入表与 4 处 FROM、`backend-monitor.dto.ts` 注释、README 同步。
2. 装配同步至 nightwatch-backend `src/modules/backend-monitor`（机械复制，diff 为空）。
3. 宿主应用层 SQL 字面量同步：analysis（query-isolation 白名单常量、prompt-builder、query-isolation.test）、scheduled-jobs/backend.detect-error-spikes.job、copilot datasource（backend-monitoring-templates / metrics 及测试）。
4. 数据面：本地 nightwatch 实例执行 `RENAME TABLE nightwatch.application_request_logs TO nightwatch.backend_monitor_request_logs`（error_logs 同）；生产实例按 nightwatch-production-runbook 另案择时执行。
5. 列契约、`request_id` 关联语义、TTL/PARTITION/ORDER BY 全部不变。

决定性理由：**通用模块的数据面命名必须自含模块归属且不绑定任何宿主概念**——`backend_monitor_` 前缀让表名在任何宿主装配下都成立，且与库内既有表名惯例收敛为单一法则（模块 key snake 前缀）。

## 跨宿主 / 演进检验

- 换任意宿主装配 backend-monitor：表名只表达"backend-monitor 模块的请求/错误日志"，无 nightwatch 概念泄漏；`application_id` 列语义由模块-hub externalRef 约定承载，宿主可用任意主数据映射。
- 与 web-monitor 动态表族（`web_monitor_*_<appId>`，见 ADR-014）构成完整命名体系：静态表 = 模块前缀 + 领域名；动态分区表 = 模块前缀 + 领域名 + 安装实例后缀。
- 旧名无外部消费方（未上线、无第三方宿主），无兼容负担；未来新增 collector 模块的表名遵循同一法则，无需新决策。

## 影响

**更容易**：

- 表名即可读归属：`SHOW TABLES` 输出按模块聚类（backend_monitor_* / url_monitor_* / web_monitor_* / _clickhouse_schema_migrations），排障与备份脚本无需查文档。
- analysis prompt 中的表名事实与模块文档一致，AI 生成 SQL 的上下文歧义减少。

**更难 / 后续工作**：

- 生产 ClickHouse（库名仍为 worldzhy、表名仍为旧名）需在发版窗口执行同样的 RENAME + 库名归一，属运维操作，按 runbook 另案执行。
- 引用面为字符串字面量（SQL in code / prompt 文本），编译期无法兜底；以 grep 取证清单 + 行为级验证（ingest 写入 + analysis 查询 + 错误尖峰任务）作为交付证据。
