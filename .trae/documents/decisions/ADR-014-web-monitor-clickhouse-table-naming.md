# ADR-014: web-monitor ClickHouse 动态表族蛇形命名（WebAjax_/WebErrors_/WebSdkErrors → web_monitor_*）

状态：已采纳
日期：2026-10-22
归属注记：本决策治理 registry 模块的数据面命名契约（真源为 `packages/modules/web-monitor` 的 ClickHouse 模型工厂与查询代码），存放于本仓；nightwatch-backend 侧为装配产物与宿主分析层的同步执行，不另立 ADR。与 ADR-013（backend-monitor 静态表加前缀）是同一评审的姊妹决策。

## 背景

2026-10-22 全系统 ClickHouse 表名评审（10 张表逐一核对）判定 web-monitor 动态表族命名不恰当（重度）。问题本质：

1. **PascalCase 违反库内单一命名法则**：同库其余表全部 snake_case——`backend_monitor_request_logs` / `backend_monitor_error_logs`（ADR-013）、`url_monitor_check_results`、`_clickhouse_schema_migrations`。唯独 web-monitor 三族 `WebAjax_<appId>` / `WebErrors_<appId>` / `WebSdkErrors` 沿用历史 Demo 的 PascalCase。
2. **缺模块前缀**：表名不含模块归属，读者无法从 `SHOW TABLES` 判断归属模块；`WebErrors_` 与 backend-monitor 错误日志在语义上撞车。
3. **`Ajax` 语义过时**：该表存储 SDK 上报的全部网络请求（fetch + XHR），`Ajax` 是 XMLHttpRequest 时代词汇，不能表达领域真相；命名法则要求剔除语义过时词。
4. **`WebSdkErrors` 形态不一致**：无下划线分隔、无实例后缀（共享表，appId 为列），与两族分区表的形态法则都不一致。

命名法则（同 ADR-013，本次评审定稿）：全单词禁自创缩写；模块 key 转 snake_case 作前缀；剔除语义过时词；单复数一致。

约束取证：

- 与 backend-monitor 不同，web-monitor 表**非迁移 SQL 创建**——由模型工厂运行时 `autoCreate`（`models/clickhouse/web/ajax.ts` 等，`tableName = 前缀 + appId`，createModel 时 CREATE TABLE IF NOT EXISTS，autoSync 跟随 schema）。因此新装实例与新 appId 直接得到新名；存量 6 张表（3 个 appId × 2 族，取证时均 0 行）以 `RENAME TABLE`（ClickHouse 瞬时元数据操作）保数据；`WebSdkErrors` 无存量表，新代码首次上报 SDK 错误时自建新名。
- 引用面（2026-10-22 grep 取证）：registry 侧 enum 3 个值 + 3 个工厂文件引用 + schema.prisma 注释 1 处；宿主 nightwatch-backend 应用层 analysis（query-isolation 白名单常量/注释/错误消息与测试、prompt-builder 提示词与 few-shot SQL 示例、analysis.service 注释）约 25 处 SQL/文本字面量。
- TypeScript 符号名（工厂函数 `WebAjax`、服务方法 `ch.WebAjax()`、enum 成员名 `WEB_AJAX`）是代码层标识符，不属数据面契约，本次不动；是否随语义重命名另案评审。
- 列契约（url/method/duration/... 与共享表 appId 列）全部不变。

## 候选方案

- **A. `web_monitor_requests_<appId>` / `web_monitor_errors_<appId>` / `web_monitor_sdk_errors`（选定）**：模块前缀 + 领域名全 snake；`requests` 准确表达"全部网络请求"；共享表 `web_monitor_sdk_errors` 与分区族同前缀、形态自洽。
- **B. 仅 snake 化不改语义（`web_ajax_<appId>` / `web_errors_<appId>`）**：被否——`ajax` 语义过时是实名缺陷，改名窗口只有一次（无外部消费方），不应把过时词固化进新名；且缺模块前缀的问题未解。
- **C. 维持不改**：被否——同 ADR-013 的评审结论；无外部消费方，现在是唯一低成本窗口。

## 决策

选 A，具体形态：

1. registry `packages/modules/web-monitor`：`models/enum.ts` 三个 enum 值改为 `web_monitor_requests_` / `web_monitor_errors_` / `web_monitor_sdk_errors`；`prisma/schema.prisma` 注释同步。
2. 装配同步至 nightwatch-backend `src/modules/web-monitor`（机械复制，diff 为空）。
3. 宿主应用层字面量同步：analysis/query-isolation（WEB_TABLE_PREFIXES、WEB_SDK_ERROR_TABLE、注释、错误消息）与 query-isolation.test、analysis/prompt-builder（提示词与 few-shot SQL 示例）、analysis.service 注释。
4. 数据面：本地 nightwatch 实例执行 6 张 `RENAME TABLE`（`WebAjax_<appId>` → `web_monitor_requests_<appId>`、`WebErrors_<appId>` → `web_monitor_errors_<appId>`，appId ∈ 55PRWcH / ZrXXAAf / wT2eT8R）；`WebSdkErrors` 无存量表无需操作。生产实例按 nightwatch-production-runbook 另案择时执行。
5. 操作时序：新代码构建完成 → 停后端 → RENAME → 启动新代码。autoCreate 对已存在的新名表为 no-op，新上报直接写入重命名后的表。

决定性理由：**数据面命名必须自含模块归属、语义准确且全库单一法则**——`web_monitor_` 前缀让表族在任意宿主装配下成立；`requests` 取代过时词 `ajax`；snake_case 与库内其余全部表收敛为单一法则。

## 跨宿主 / 演进检验

- 换任意宿主装配 web-monitor：表名只表达"web-monitor 模块的请求/错误/SDK 错误数据"，无宿主概念泄漏；appId 后缀语义由模块 installation 契约承载，宿主可用任意站点主数据映射。
- 与 ADR-013 构成完整命名体系：静态表 = 模块前缀 + 领域名；动态分区表 = 模块前缀 + 领域名 + 安装实例后缀；共享表 = 模块前缀 + 领域名（实例 ID 为列）。三种形态同一法则。
- 旧名无外部消费方（未上线、无第三方宿主），无兼容负担；未来新增 web 侧数据面表遵循同一法则，无需新决策。

## 影响

**更容易**：

- `SHOW TABLES` 全库按模块聚类且风格统一（backend_monitor\_\* / url_monitor\_\* / web_monitor\_\*），排障、备份脚本与 analysis prompt 的表名事实一致。
- AI 生成 SQL 的提示词语义准确（requests 而非 ajax），few-shot 示例与真实表名一致，减少上下文歧义。

**更难 / 后续工作**：

- 生产 ClickHouse（库名仍为 worldzhy、表名仍为旧名）需在发版窗口执行同样的 RENAME（连同 ADR-013 的两张），属运维操作，按 runbook 另案执行。
- 引用面为字符串字面量（SQL in code / prompt 文本），编译期无法兜底；以 grep 取证清单 + 行为级验证（report 上报写入重命名表 + analysis 查询路径）作为交付证据。

## Errata

- 2026-10-23 生产迁移修订：上节"生产 ClickHouse 需执行 RENAME 保数据"作废——platform 未上线，生产数据可丢弃。随 main 同步部署时改为设置 `CLICKHOUSE_DB=nightwatch`、由新代码自建全表后 `DROP DATABASE worldzhy`；本地实例的 RENAME 步骤仍有效。
