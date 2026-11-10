# ADR-055: web-monitor 重命名为 frontend-monitor

状态：已采纳
日期：2026-11-10
归属注记：本决策治理 registry 模块 `web-monitor` 的 key 命名与跨仓影响面，存放于本仓。nightwatch-backend/nightwatch-frontend 侧为机械同步执行，不另立 ADR。

## 背景

2026-11-10 模块命名轴评审发现：`web-monitor` 与 `backend-monitor` 在本域**命名轴不一致**。

两个模块的核心事实：

| 模块 | 安装绑定 | 采集侧 | 观测对象 |
|------|----------|--------|----------|
| web-monitor | 只给 `FRONTEND` 应用装 | 浏览器 Web SDK | 前端应用的用户体验层 |
| backend-monitor | 只给 `BACKEND` 应用装 | Node.js reporter | 后端应用的进程运行时层 |

两个 monitor 的**安装逻辑本来就是架构层绑定**——宿主按 `ApplicationType.FRONTEND` / `BACKEND` 枚举决定装哪些设施，与采集侧技术载体无关。

当前问题：
- `web-monitor` 的 `web` 是**采集侧技术载体**命名
- `backend-monitor` 的 `backend` 是**架构层**命名
- 两者在同一轴上无法对齐

## 候选方案

三个真实可选项：

### 方案 A：改 backend-monitor → server-monitor（保持 web-monitor 不动）

把 backend-monitor 从架构层轴拉到采集侧技术载体轴。统一后的轴为：
- server-monitor（Node.js server 进程采集侧）←→ web-monitor（浏览器 Web 采集侧）

**优点**：server/web 按技术载体对称，语义范围清晰。

**缺点**：
1. **绑定关系与命名脱节**——FRONTEND 应用（Next.js）同样跑在 Node.js server 上，但 server-monitor 只给 BACKEND 应用装，名字暗示的覆盖范围（"所有有 server 的应用"）与实际安装逻辑矛盾
2. **扩展性差**——future 宿主机监控（CPU/内存/磁盘）会与 `server` 语义直接冲突，server-monitor 会被抢占或再次改名
3. **Copilot SQL 语义模糊**——`server_monitor_request_logs` 表名对 AI 推断来说 "server" 到底指宿主机还是应用进程不明确；`backend_monitor_*` / `frontend_monitor_*` 直接告诉你这是什么层的数据

### 方案 B：改 web-monitor → frontend-monitor（保持 backend-monitor 不动）← 选定

把 web-monitor 从采集侧技术载体轴拉到架构层轴。统一后的轴为：
- backend-monitor（后端应用层监控）←→ frontend-monitor（前端应用层监控）

**优点**：
1. **绑定关系 100% 自洽**——名字与宿主 `ApplicationType.FRONTEND` / `BACKEND` 枚举一一对应，安装逻辑零解释成本
2. **扩展性碾压**——frontend/backend 是应用架构层二分法，稳定且不会被未来监控类型抢占（宿主机监控、移动端监控、边缘计算监控都不冲突）
3. **registry 通用性不退化**——frontend/backend 是 Web 应用的**通用架构概念**（跨宿主成立），不是 nightwatch 特有的业务词汇
4. **Copilot SQL 语义清晰**——AI 推断表名时直接知道数据所属层级

**缺点**：
1. 改动成本中高（web-monitor 是大模块：4 个子模块、动态 ClickHouse 表族、5+ 已固化 ADR）
2. `web_monitor_*` ClickHouse 表前缀需全部改为 `frontend_monitor_*`，涉及动态表创建逻辑（ADR-014）

### 方案 C：都不改

接受当前命名轴不一致。

**缺点**：未来每次讨论 monitor 模块时都要解释"为什么 web 对 backend 不对"，认知债持续累积。

## 决策

选 **方案 B**。

决定性理由（三条叠加）：

1. **绑定关系自洽性**压倒一切——两个 monitor 的安装逻辑本来就是按 `ApplicationType` 枚举分配的，模块 key 必须反映这个绑定关系，否则每次新增宿主或讨论模块装配时都要额外解释"FRONTEND 应用为什么有 Node.js server 进程却不装 server-monitor"。

2. **架构层二分法的稳定性**——frontend/backend 描述的是应用天然具备的层次关系（有前端就有后端），不依赖当前技术栈。server/web 描述的是当前 Node.js + 浏览器技术栈下恰好存在的两个采集侧，技术栈演进会打破这个对应关系（宿主机监控、移动端监控、边缘计算监控都会让 server-monitor 语义坍缩）。

3. **registry 通用性不退化**——frontend/backend 是 Web 应用的通用架构概念，任何宿主（哪怕是 Go/Python 后端或 Vue/Angular 前端）都会有这两个层次。registry 模块的 admission criteria 禁止的是**宿主业务词汇**（如 nightwatch 的 ProjectMember、SecurityReport），而 frontend/backend 属于前者。

## 跨宿主 / 演进检验

- **换宿主装配 frontend-monitor**（比如 Go/Python 后端 + Vue 前端宿主）：模块 key `frontend-monitor` 仍然成立——宿主可以通过 module-hub 的 externalRef 映射机制，把它装到宿主的前端应用类型上（宿主内部不一定叫 FRONTEND，但装配时可以做一层映射）。
- **宿主机监控新增**：加 `host-monitor` 模块。frontend-monitor / backend-monitor / host-monitor 三者互不冲突。
- **移动端监控新增**：加 `mobile-monitor` 模块。架构层二分法不受影响。
- **ClickHouse 表前缀法则**（ADR-013/014）：模块 key snake_case 作前缀，改名后 `frontend_monitor_*` / `backend_monitor_*` / `url_monitor_*` / `health_*` / `heartbeat_*` 统一收敛为单一法则。

## 影响

### 改名范围（全量清单）

| 层 | 路径 | 改动 |
|----|------|------|
| Registry 模块目录 | `packages/modules/web-monitor/` | → `frontend-monitor/`（整目录重命名） |
| 所有文件内字面量 | 整个 registry 新目录 | `web-monitor` → `frontend-monitor`、`WebMonitor` → `FrontendMonitor`、`web_monitor` → `frontend_monitor` |
| ClickHouse 迁移 SQL | `clickhouse/migrations/V*.sql` | `web_monitor_*` → `frontend_monitor_*` |
| API 路径 | controller decorator | `/web-monitor/*` → `/frontend-monitor/*` |
| InstallationKind 枚举 | nightwatch-backend `application.dto.ts` | `WEB_MONITOR = "web-monitor"` → `"frontend-monitor"` |
| 装配产物 | nightwatch-backend `src/modules/frontend-monitor/` | 从 registry 机械 back-port，diff 为空 |
| Copilot SQL 字面量 | datasource、prompt-builder、analysis、alert-jobs | 所有 `web_monitor_*` 表引用改名 |
| 动态表创建逻辑 | web-monitor site.service.ts / jobs.service.ts | 表名前缀 `web_monitor_*_` → `frontend_monitor_*_` |
| 前端 API 调用 | `getWebMonitor*` → `getFrontendMonitor*` | apits 重新生成 |
| 前端页面路径 | `web-monitor/` → `frontend-monitor/` | 路由目录重命名 |
| 前端 i18n namespace | `webMonitor` → `frontendMonitor` | en.json / zh.json |
| newbie-modules.json | nightwatch-backend / nightwatch-frontend | module key `web-monitor` → `frontend-monitor` |

### 历史 ADR 处理

| ADR | 状态 | 处理 |
|-----|------|------|
| ADR-014 web-monitor ClickHouse 表命名 | superseded by 本 ADR | 头部标注 supersedes + 保留原文（时点快照原则） |
| ADR-015 移除 web-monitor DB override | superseded by 本 ADR | 同上 |
| ADR-050 web-monitor 告警通道严重度 | superseded by 本 ADR | 同上 |
| ADR-051 web-monitor 告警冷却/恢复 | superseded by 本 ADR | 同上 |

### ClickHouse 存量数据

系统未上线，生产数据可丢弃。本地开发实例直接 `DROP TABLE web_monitor_*` + 由新代码自动创建 `frontend_monitor_*`。无需迁移脚本。

### 更容易

- 模块 key 与宿主 ApplicationType 枚举 100% 对齐，装配逻辑零解释成本
- Copilot AI 推断 SQL 表名时语义清晰
- 未来新增其他 monitor 模块时命名轴不变

### 更难 / 后续工作

- 已固化的 ADR-014/015/050/051 需标注 superseded（时点快照，正文不改）
- 三仓同步改名需逐一验证引用点（SQL 字面量分散在 analysis、alert-jobs、prompt-builder 等多处）
- 前端路由改名后，旧链接（`/web-monitor`）需要 redirect 吗？（当前系统未上线，可直接硬改）
