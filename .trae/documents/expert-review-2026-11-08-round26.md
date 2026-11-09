# 专家评审 round26 — url-check 功能测试与验证

## 1. 锚点

| 仓 | branch | HEAD | dirty | 备注 |
| --- | --- | --- | --- | --- |
| newbie-modules | dev | `93a4797` | 3（本轮新增测试文件） | 模块真源 |
| nightwatch-backend | dev | `bbb0b34` | 4（本轮新增测试文件） | 装配面 + 宿主通知桥 |
| nightwatch-frontend | dev | `ae6b3e1` | 5（并行会话在途：`next-env.d.ts`、`applications/[applicationId]/layout.tsx`、`i18n/messages/{en,zh}.json`、`.trae/documents/expert-review-2026-11-08-round18.md`） | 均在 url-check 域之外；被审页面 `url-check/page.tsx` 未 dirty，结论非 provisional |

时间：2026-11-08 19:2x–19:53 CST（开始时刻未单独打点，首个取证命令在 19:30 前）。
装配一致性：`diff -rq newbie-modules/packages/modules/url-check nightwatch-backend/src/modules/url-check` → 空（本轮新增 3 个测试文件 back-port 后复跑，仍为空）。

## 2. 范围与方法

- `scope: modules: [url-check]`。被审对象：注册表模块 `packages/modules/url-check/**`、装配产物 `src/modules/url-check/**`、宿主侧消费面（`src/application/scheduled-jobs/tasks/url.check-availability.job.ts`、`src/application/notifications/url-check/*`、`src/application/authorization/scope-resolvers.ts`）、前端契约消费点 `src/app/(dashboard)/projects/[projectId]/(monitoring)/url-check/page.tsx`。
- 方法：新增 38 个行为级用例（4 个文件，见 §9），覆盖此前 0 覆盖的 admin store、传输层、DTO 边界与宿主通知桥；跑全仓测试；tsc/eslint/prettier；ClickHouse 实库取证；dayjs 解析探针。
- 计数出处：
  - 新增用例数：`grep -c '^test(' <4 files>` → 18 + 11 + 5 + 4 = 38。
  - url-check 相关用例：`node --import tsx --test <6 files>` → `tests 52 / pass 52 / fail 0`。
  - 全仓：`npm test` → `tests 759 / pass 759 / fail 0`。
  - 端点数与权限装饰器数：`grep -cE '@(Get|Post|Patch|Delete)\(' src/modules/url-check/url-check.controller.ts` → 8；`grep -c '@RequirePermission'` → 8。
- 明确排除：浏览器端交互与视觉、通知中心实际投递（飞书）、生产环境行为、`web-monitor` 等其他模块。

## 3. 结论摘要

| 维度 | 评分 | 依据 |
| --- | --- | --- |
| 安全（SSRF） | 4/5 | 写入时 fail-fast、逐跳复检、DNS 全地址校验均有 executed 证据；DNS rebinding TOCTOU 已在源码注释显式接受 |
| 架构 | 4/5 | 模块↔宿主分层清晰，事件桥与 scope resolver 齐备；通知桥存在脏数据容错缺口（R26-02） |
| 契约 | 3/5 | `UrlCheckResultDto.checkedAt` 声明 ISO，实际下发 ClickHouse 原始串，前端按本地时区解析（R26-01） |
| 测试 | 4/5 | 关键路径补齐 38 例；前端展示层仍无自动化覆盖 |
| 门禁 | 4/5 | tsc/eslint/prettier/全量测试全绿；registry 无 runner，测试只能在消费仓执行（既有约定） |
| 治理 | 4/5 | findings/backlog 登记；修复未在本会话执行（评审只读边界） |

## 4. P1

### R26-01 检查结果时间早显 8 小时（UTC 原样串被前端当本地时间）

- 仓：newbie-modules（模块）+ nightwatch-frontend（展示）
- 严重度：P1｜暴露面：live｜可达性：任意登录的项目查看者｜可利用性：直接
- 证据链（executed + static）：
  1. 写入：`url-check-probe.service.ts:180` 用 `toClickHouseDate(checkedAt)`，产出 `YYYY-MM-DD HH:MM:SS.mmm`（UTC，无 `T`/`Z`）。
  2. 列类型：`clickhouse/migrations/V20261022000000__init_url_check_tables.sql` 中 `checked_at DateTime64(3, 'UTC')`。
  3. 读取：`url-check.service.ts:121-129` 直接 `checked_at AS checkedAt` 透传 JSONEachRow，服务端不做时区/ISO 归一。
  4. 前端：`page.tsx:271` `dayjs(result.checkedAt).format(...)`，非 ISO 串按**本地时区**解析。
- 复现（实库 + 解析探针，环境：backend `bbb0b34`，ClickHouse `nightwatch.url_check_results` 2795 行）：
  ```
  $ clickhouse-client --query "SELECT ... FROM nightwatch.url_check_results ORDER BY checked_at DESC LIMIT 1 FORMAT JSONEachRow"
  {"target_id":"534df664-...","is_up":true,"status_code":200,"checked_at":"2026-11-08 11:52:00.080"}
  $ TZ=Asia/Shanghai node -e "console.log(dayjs('2026-11-08 11:52:00.080').format('YYYY-MM-DD HH:mm:ss'))"
  2026-11-08 11:52:00          # 实际本地时间为 19:52
  $ TZ=Asia/Shanghai node -e "console.log(dayjs('2026-11-08T11:52:00.080Z').format('YYYY-MM-DD HH:mm:ss'))"
  2026-11-08 19:52:00          # 期望
  ```
- 影响：近期检查列表的"检查时间"整列早 8 小时；与其他由 Prisma 下发（ISO 带 `Z`）的时间列（`openedAt`/`recoveredAt`）不一致，排障时易误判。
- 修复方向（不涉及成本取舍，只按契约正确性）：在服务端产出 ISO-8601（带 `Z`）——查询侧 `formatDateTime`/`toISOString` 投影，或在 `listCheckResults` 内 `new Date(`${row.checkedAt}Z`).toISOString()`；**不要**让前端猜时区。回归测试：断言该接口返回 `^...Z$`。
- 状态：open。

## 5. P2

| ID | 仓 | 标题 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| R26-02 | nightwatch-backend | `onRecovered` 在 `downSince=""` 时 `minuteBucket` 抛 RangeError 并被 catch 吞掉 → 恢复通知永久丢失 | executed：构造空 `downSince` 调用 `onRecovered`，`notifyCalls=0`；`new Date("")+8h` → `Invalid Date` → `toISOString()` 抛 `RangeError` | open |
| R26-03 | newbie-modules | IPv4-mapped 公网地址被误判为未知并拦截，与注释"由内嵌 IPv4 判定"不符 | executed：`assertPublicHttpUrl("http://[::ffff:8.8.8.8]/")` → `URL host is not a public address: ::ffff:808:808`（URL 归一后 `::ffff:` 分支切出 `808:808`，`isIP=0` → 视为未知拦截） | open |
| R26-04 | newbie-modules | 观察：`Number.parseInt("12abc")` 得 12，limit 容错接受脏后缀 | executed：`listCheckResults` limit 矩阵测试；无用户可见影响 | open（不单独立项） |
| R26-05 | newbie-modules | 域外新发现：`npm run format:check` 在 dev 上已红（`message-tracker/sst/` 下 5 个 tracked 文件未格式化），而 CI `ci.yml:26` 正是该命令 → 格式门禁当前无法作为合并闸门 | executed：registry `npm run format:check` 输出；`git status` 显示这些文件未修改（存量问题，非本轮引入） | open |

R26-02 触发前提是 `isAlertOpen=true` 且 `alertOpenedAt=null`——应用路径（probe `advanceState` 与 service `update` 暂停分支）始终成对写这两列，常规流程不可达；属脏数据/外部改库下的容错缺口，故 P2。
R26-03 为 fail-closed（安全不受影响），仅失去"用 IPv4-mapped 写法添加公网目标"的能力。

## 6. 误报剔除

- **"公网 IPv6 字面量导致 TypeError"**：撤销。探针把 `assertPublicHttpUrl` 的 `void` 返回值当 URL 使用，模块实际正确放行 `http://[2001:4860:4860::8888]/`。
- **"暂停后未重置 consecutiveFailures，恢复即告警"**：不列为缺陷。计数器语义为"自上次成功以来的连续失败"，暂停期间没有成功样本，恢复后首个失败重燃告警符合语义；如果业务要的是"恢复观察期"，那是需求变更而非 bug。

## 7. 已核验通过的不变量（正面结论）

每条均有对应已跑用例（文件见 §9）：

1. **写入时 SSRF fail-fast**：非公网字面量（含 `169.254.169.254`、`[::1]`）在 `project` 查询与 insert 之前被拒（断言 `projectLookups=0`、`targetCreates=0`）。
2. **重定向逐跳复检**：302 → `127.0.0.1` 在第二次 `fetch` 前被拦（`fetchCalls=1`，记录 `is_up=false`、`status_code=null`）。
3. **跳数上限**：6 次重定向响应后报 `Too many redirects (>5)`，`fetch` 恰好 6 次。
4. **状态码边界**：399 判 up、400 判 down（HTTP 级失败 `error` 为空串，以状态码为信号）。
5. **响应体不缓冲**：探针调用 `response.body.cancel()`，流 `cancel()` 被触发。
6. **结果写入失败隔离**：ClickHouse insert 抛错时状态机仍推进（`consecutiveFailures=1`、`lastCheckedAt` 已写），周期不 reject。
7. **单目标故障隔离**：某目标 `update` 抛错不中断其余目标。
8. **并发批次上限**：11 个目标峰值并发恰为 10，11 行结果全部落库。
9. **暂停关警原子性**：`isActive=false` 时告警与未恢复 incident 在同一 `$transaction` 内关闭，`durationMs` 由 `alertOpenedAt` 起算；无告警时零 incident 写入。
10. **查询边界**：`listCheckResults`/`listIncidents` 的 limit 默认 50、上限 200、0/负/非数字回落 50，`targetId` 以 UUID 类型参数绑定。
11. **统计口径**：窗口 `24h|7d|30d` → `INTERVAL 24/168/720 HOUR` 与 `toStartOfHour|toStartOfInterval(6 HOUR)|toStartOfDay` 桶表达式一一对应；非法窗口回落 24h；MTTR 的 `gte` 边界按窗口换算（30d ≈ 720h）。
12. **DTO 边界**：`javascript:`/`ftp:`/含空白 URL 全部被拒；大写 `HTTPS://` 放行；uuid/名称 255/URL 2048 长度边界成立；`window` 只接受 `24h|7d|30d`。
13. **权限面**：控制器 8 个端点全部带 `@RequirePermission`（8/8），scope resolver 覆盖 `UrlCheckTarget` 与 `project`，RBAC 契约测试（SCOPE_ROLE_PERMISSION_MATRIX 完备性）随全量测试通过。
14. **通知路由**：down/recovered 的通知键、严重度、链接、dedup 桶（UTC+8 分钟桶）与 `status=recovered`/`recoveredAt` 均符合 R21-04 之后的契约；通知中心抛错被吞掉，不影响事件处理。

## 8. 覆盖率清单

- 审了：模块 service/probe/DTO/events、ClickHouse 迁移与写入格式、宿主定时任务接线、宿主通知桥、scope resolver 与 RBAC 矩阵、前端 url-check 页的时间/统计渲染契约、registry↔装配一致性。
- 没审：前端交互与视觉（无浏览器 E2E）、飞书实际投递、通知中心内部渲染、生产环境、`web-monitor` 等相邻模块、Prisma 模型文件生成物。

## 9. 修复优先级

1. R26-01（P1，用户可见的错时间）——服务端输出 ISO-8601 + 接口级回归断言。
2. R26-02 / R26-03（P2，随下一次 url-check 改动顺手修；R26-03 需同时修正注释或补十六进制内嵌 IPv4 判定）。

## 10. 台账指针

- 本仓 `findings.md`：`## round26`。
- backlog：已登记 R26-01/R26-02/R26-03 修复项（引用 ID，不复制正文）。

## 11. 本轮新增测试文件

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `packages/modules/url-check/url-check.service.test.ts` | 18 | admin store：SSRF 写时校验顺序、项目不存在、暂停关警事务、limit 矩阵、stats 窗口与聚合 |
| `packages/modules/url-check/url-check-probe-transport.test.ts` | 11 | 传输层：重定向逐跳复检/跳数上限/相对 Location、399↔400、网络失败、body 不缓冲、insert 失败隔离、目标隔离、并发 ≤10、down/recovered 事件载荷 |
| `packages/modules/url-check/url-check.dto.test.ts` | 5 | DTO：协议白名单、空白 URL、长度/uuid 边界、window 枚举 |
| `nightwatch-backend/src/application/notifications/url-check/url-check-alerts.notifications.service.test.ts` | 4 | 宿主通知桥：路由字段、dedup 桶、`status=recovered`、失败吞掉 |
