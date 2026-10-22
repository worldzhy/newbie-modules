# ADR-015: 移除 web-monitor 独立 ClickHouse 库覆盖键（WEB_MONITOR_CLICKHOUSE_DB）

状态：已采纳
日期：2026-10-23
归属注记：本决策治理 registry 模块的配置契约（真源为 `packages/modules/web-monitor/newbie.module.json` 与 ClickHouse 模型服务），存放于本仓；nightwatch-backend 侧为装配产物与宿主 env 模板的同步执行，不另立 ADR。与 ADR-013 / ADR-014（ClickHouse 表命名体系）是同一数据面治理线的后续决策。

## 背景

2026-10-22 web-monitor 配置评审发现：web-monitor 是全生态唯一携带独立 ClickHouse 库覆盖键的 collector 模块——`newbie.module.json` 声明 `clickhouseDB: process.env.WEB_MONITOR_CLICKHOUSE_DB`，`models/clickhouse/monitor-clickhouse.service.ts` 以 `modules.web-monitor.clickhouseDB || modules.clickhouse.database` 二级回退解析库名。其余 ClickHouse 消费模块（backend-monitor、url-monitor）一律直接使用共享键 `modules.clickhouse.database`（env `CLICKHOUSE_DB`），形态不对称。

判定该覆盖键应移除，三条决定性理由：

1. **是 footgun 不是 feature**：两个 env 键静默漂移即破坏宿主分析层——analysis 的 query-isolation 白名单与 prompt-builder 生成的 SQL 按默认库解析 `web_monitor_*` 表（ADR-014 命名体系），traceId 跨表 join 同样假定同库；一旦 `WEB_MONITOR_CLICKHOUSE_DB` 与 `CLICKHOUSE_DB` 取值分叉，写入侧落到另一个库而读取侧无报错，故障隐性且难以排查。
2. **违反单库架构事实**：ClickHouse 迁移引擎（ADR-008 前向迁移管线）只以 `CLICKHOUSE_DB` 为目标库；collector 模块不应自带部署拓扑——模块的职责是声明表结构，库的选择是宿主部署决策，由共享 clickhouse 模块统一承载。
3. **YAGNI**：全部在役环境（本地、生产模板）从未出现与 `CLICKHOUSE_DB` 不同的取值需求；ClickHouse 在同一连接上不存在按库的资源隔离能力，该键不提供任何真实收益。

约束取证（2026-10-23 grep）：

- registry 侧引用仅 3 处：`newbie.module.json` config-service 键与 env 块各 1 处、`monitor-clickhouse.service.ts` 回退读取 1 处；无 README/文档引用。
- 宿主 nightwatch-backend 侧：`.env` / `.env.example` 各 1 行（均在 `@@newbie-modules-*` 标记块内，装配自动再生）；`deploy/env.template` 1 行（`WEB_MONITOR_CLICKHOUSE_DB=web_monitor`，宿主自有，手工删除）；装配产物 `modules.config.ts` 与 `src/modules/web-monitor/newbie.module.json` 随装配再生。生产库可丢弃（平台未上线），无数据迁移负担。
- newbie-starter / fewbie-starter 无引用。

## 候选方案

- **A. 删除覆盖键，统一走共享 `CLICKHOUSE_DB`（选定）**：registry 移除 config-service 键与 env 条目，`monitor-clickhouse.service.ts` 改为 `getOrThrow("modules.clickhouse.database")` 单源解析；宿主 env 模板同步清理。
- **B. 保留并文档化**：被否——保留一个无任何消费方需要、且与架构事实（单库迁移、同库分析）相冲突的键，等于把 footgun 制度化；文档无法消除两键漂移的隐性故障模式。
- **C. 维持现状不改**：被否——不对称本身即配置契约缺陷；无外部消费方，现在是唯一零成本窗口。

## 决策

选 A，具体形态：

1. registry `packages/modules/web-monitor/newbie.module.json`：删除 `config-service.web-monitor.clickhouseDB` 键与 `env.WEB_MONITOR_CLICKHOUSE_DB` 条目。
2. registry `models/clickhouse/monitor-clickhouse.service.ts`：删除二级回退，库名单源解析为 `configService.getOrThrow("modules.clickhouse.database")`。
3. 装配同步至 nightwatch-backend（`newbie update --all -y --force`），装配产物（`modules.config.ts`、装配镜像 `newbie.module.json`、`.env` / `.env.example` 标记块）随装配自动移除该键。
4. 宿主 `deploy/env.template` 手工删除 `WEB_MONITOR_CLICKHOUSE_DB=web_monitor` 行。
5. 验证：重启后 web-monitor 上报冒烟（写入共享库 `web_monitor_requests_<appKey>` 表），确认行为不变。

决定性理由：**collector 模块不得自带部署拓扑**——库选择是宿主级决策，由共享 clickhouse 模块单源承载；消除两键漂移的隐性故障模式，使配置契约与单库架构事实一致。

## 跨宿主 / 演进检验

- 换任意宿主装配 web-monitor：模块只声明表结构（ADR-014 命名体系），库名恒等于宿主共享 clickhouse 配置，无模块级拓扑泄漏；宿主如需隔离，应通过独立 ClickHouse 集群/连接（共享模块配置）实现，而非模块内覆盖键。
- 与 ADR-008 一致：迁移管线目标库唯一（`CLICKHOUSE_DB`），模块不再引入引擎不可见的第二库。
- 若未来出现真实的按模块分库需求，应由共享 clickhouse 模块以显式契约（如多连接配置）承载，届时另立 ADR；本决策不排除该演进，只排除"模块私有 env 覆盖"这一错误形态。

## 影响

**更容易**：

- ClickHouse 库配置收敛为单键 `CLICKHOUSE_DB`，全环境无第二真源；新装实例少一个必配项。
- 分析层（query-isolation / prompt-builder）与 traceId 跨表 join 的"同库"前提由架构保证，不再依赖运维保持两键同步。

**更难 / 后续工作**：

- 生产部署模板已含 `WEB_MONITOR_CLICKHOUSE_DB=web_monitor` 的环境需在下一次发版时清理该变量（连同生产 CH 库切换为 `nightwatch` 的既定操作一并执行）；无兼容负担（生产库按既定决策可丢弃）。
