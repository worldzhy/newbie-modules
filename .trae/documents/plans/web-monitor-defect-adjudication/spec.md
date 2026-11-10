# Spec: web-monitor 疑似源码缺陷逐条裁决

状态：待用户逐条拍板（本 spec 不含已生效的代码改动）
范围：`packages/modules/web-monitor`（registry = 唯一源），消费仓 `nightwatch-backend/src/modules/web-monitor` 为机械同步产物
背景：web-monitor 全功能行为测试补写（registry `54fb7d5` / backend `11442d6`，278 例全绿）。9 条疑似缺陷均"测试固化现状、源码未动"，现逐条取证后裁决。

## 判定口径

- 定论：有当前源码/调用方证据，行为按描述发生。
- 推测：证据不足以证明真实可达性或影响程度。
- 任何修复都需用户逐条批准；未经批准不改源码、不改钉点测试。

## 逐条判决

### D1 error.service `getAverageErrorList` 前导逗号 SQL

- 判定：定论
- 证据：`packages/modules/web-monitor/modules/web/services/error.service.ts` L88-99。`type` 为空或不在五种已知值时 `groupBy` 保持 `""`；listQuery `select` 模板为 `` `${groupBy}, MAX(createTime) ...` ``，实际生成 `, MAX(createTime) ...`；`ClickHouseModel.objectToSql`（backend `src/modules/clickhouse/clickhouse.model.ts` L71）直接拼 `SELECT ${q.select}`，ClickHouse 语法错误。同一查询的 countQuery 也带 `groupBy: ""`（无 GROUP BY）。
- 真实可达：`modules/web/error.controller.ts` L27-35 不校验 `type`；前端 `errors/page.tsx` L89-122 将 `actualType`（由 tab 派生）原样传入，缺省/新增 tab 值即可触发 500。
- 影响：错误聚合主列表在该入参下 500；实时模式（`realTime=1`）不走该分支，不受影响。
- 选项：A 条件化构造 select（groupBy 为空时去掉前导逗号，countQuery 的 groupBy 传 undefined）；B 控制器白名单校验未知 type 返回 400；C 保持现状（钉点测试已固化）。
- 建议：A（最小改动、修可用性；同步更新 `error.service.test.ts` L139-156 钉点）。

### D2 page.service `getRealTimeAveragePageList` 时间窗不进 `$match`

- 判定：定论
- 证据：`page.service.ts` L107-145，`match` 仅 `{ isFirstIn: true }` + 可选 `speedType`；`beginTime/endTime` 只经 `getSpaceTime` 生成分钟桶（L146-159），聚合无条件全表 `$match: match`。
- 真实可达：`page.controller.ts` L40-54 暴露该端点且强制双边 + ≤1h；但前端 `src` 内除 `_gen` 外无调用方，当前 UI 未使用。
- 影响：单次请求对整张 `WebPage` 集合聚合，数据量大时延迟/内存风险（可用性），输出正确性不受影响（窗口外结果被丢弃）。属潜在风险而非现网故障。
- 选项：A 将双边时间窗并入 `$match`（`func.toDate` 同口径）；B 保持现状并记录为已知性能风险。
- 建议：A（改动集中在 1 个方法；更新 `page.service.test.ts` L150-196 三个用例）。

### D3 beginTime/endTime 双边/单边口径不一致

- 判定：定论（行为不一致）
- 证据：双边才生效：`resource.service.ts` L27、L81、L102；`page.service.ts` L186-193；`environment.service.ts` L10。支持单边：`analysis.service.ts` L31-39 与 `getMatch` L74-86；`custom.service.ts` L62-70；`resource.service.ts` L46-51；`error.service.ts` L44-52 两个方法亦为单边；`pvuvip.service.getMatch` L144-156 单边。
- 真实可达：现有前端在 pages/list、pages/visit、resources/detail 等处均双边传参，当前 UI 不受影响；差异对外部 API 消费者与后续新增页面生效。
- 影响：单边查询在双边系方法中静默退化"全量"，易造成误判与无谓扫描。
- 选项：A 全部统一为"按边生效"（改 5 个双边方法 + 钉点测试）；B 全部统一为"双边必填"（控制器 400，属对外合约变更）；C 保持现状并写明各端点口径。
- 建议：A（与多数新代码一致、无破坏性）；若你更看重显式合约可选 B。

### D4 custom.service `delCustomFilter` 不存在也返回 true

- 判定：定论
- 证据：`custom.service.ts` L34-49。`findOne` 对合法但不存在的 `_id` 返回 `null` 不抛错；随后 `deleteOne` 不校验 `deletedCount`，直接 `return true`。仅非法 ObjectId 导致 findOne 抛错时才报 "does not exist"。
- 影响：删除不存在的自定义过滤项被报告成功（幂等语义），无数据破坏；UI 可能对陈旧行显示成功。
- 选项：A `findOne` 结果为空即抛 "does not exist"；B 接受幂等成功并把返回值语义写入文档；C 保持现状。
- 建议：A（错误分支文案已存在，改动 2 行）。

### D5 pvuvip `getHistoryPvUvIplist` 的 num 为 undefined

- 判定：定论（但与 D2 类似，属未被调用代码）
- 证据：`pvuvip.service.ts` L35-43 `obj.num = num?.num;`（无日报时字段为 `undefined`，JSON 序列化后字段消失）；对照 L46-62 `numRes?.num || 0`。
- 真实可达：`pvuvip.controller.ts` L65-81 走 `getHistoryPvUvIplistByRange`，`getHistoryPvUvIplist` 仅测试引用，无生产调用方。
- 影响：当前无线上影响；若未来接入该列表接口会输出缺字段。
- 选项：A `?? 0` 对齐；B 保持现状并标注 dead code。
- 建议：A（一行；同步 `pvuvip.service.test.ts` 对应断言）。

### D6 analysis.service `this.cfg` 未使用

- 判定：定论（且是全模块模式，非单文件）
- 证据：`analysis.service.ts` L9-14 仅赋值；`topAnalysisLimit`（L17-20）读代码常量 `WEB_MONITOR_CONFIG.top_alalysis_size`。同类未使用 `cfg` 还存在：`error.service.ts` L11-13、`page.service.ts` L14-16、`resource.service.ts` L9-14、`jobs.service.ts` L50、`report-task.service.ts` L85、`ajax.service.ts` L13、`pvuvip-task.service.ts` L26、`pvuvip.controller.ts` L19-29。
- 影响：死代码/误导（让人以为有运行时配置覆盖能力），无行为影响。
- 选项：A 仅清理 analysis.service（最小）；B 批量清理上述全部死 cfg + 对应构造注入；C 保持现状（不算缺陷）。
- 建议：C 或 A。不建议在本次缺陷修复批次里做 B（会扩散到 DI 与测试夹具）。

### D7 jobs.service L242 `WebResource` 在 `runSignal` 之外

- 判定：定论（隔离粒度缺陷）；可达性为推测
- 证据：`jobs.service.ts` L242 `const resourceModel = this.models.WebResource(system.appKey);` 位于 L243 的 `for` 与 L244 `runSignal` 之外。抛错源：`models/mongo/web-monitor-models.service.ts` L58-64 `assertAppKey`；系统 appKey 违规时该系统的 slow-resource ×3、slow-ajax、js-error-spike、js-error-first-seen 全部被跳过，仅由 `evaluateThresholdAlerts` 的 per-system catch 记录（L130-135），不影响其他系统。
- 真实可达：`appKey` 通常由站点创建时校验；未验证是否存在历史脏行，故"可被触发"为推测。
- 影响：单个系统内告警静默丢失，与其余 signal 的隔离意图不符。
- 选项：A 将模型获取移入每个 `runSignal` 回调（或紧邻首个使用处），保持隔离；B 保持现状（依赖 per-system catch）。
- 建议：A（一行位置调整；更新 `jobs.service.test.ts` 相应用例）。

### D8 report.controller 对象体 + `text/plain` 被 400

- 判定：定论
- 证据：`report.controller.ts` L44-52。`content-type` 含 `text/plain` 时强制 `JSON.parse(body)`；body 为对象时得到 `"[object Object]"` → 抛错 → 400。钉点：`report.controller.test.ts` L124-131。
- sendBeacon 正常路径：字符串体 + `text/plain`，L83-93 用例通过；guard 注释（backend `installation.guard.ts` L103）称存在 text body parser 将体保留为原始字符串（注册位置未在 backend `src` 内找到，故注册方为推测）。
- 影响：仅"已解析对象 + text/plain"的非主流客户端；无已知调用方。字符串路径不受影响。
- 选项：A 收敛为 `query = typeof body === "string" ? JSON.parse(body) : body`（去掉 content-type 二次解析）；B 保留 400 但给出明确文案；C 保持现状（现状已作为合约钉住）。
- 建议：A（逻辑更简单，且对象/字符串两路都成立；更新 L124-131 用例）。

### D9 utils `decryptPhone` 未知字符对静默丢弃

- 判定：定论
- 证据：`shared/utils.ts` L183-197。未知两字符对 → `decryptP[t]` 为 `undefined`，`join("")` 丢弃；奇数尾字符从未 flush。钉点：`shared/utils.test.ts` L224-226（`"QRzz"→"0"`、`"QRi"→"0"`）。
- 使用点：`report-task.service.ts` L325、L531、L586 对客户端 `p` 字段解码后写 phone。
- 影响：畸形/恶意 SDK 输入产生截断或错位的手机号入库；不崩溃。是否"缺陷"取决于对 phone 数据质量的要求。
- 选项：A 未知对即视为解码失败，整体返回 `undefined`（调用方不写 phone）；B 严格抛错拒绝该条上报；C 保持现状（钉点已固化，视为客户端契约）。
- 建议：A（保留其余字段、避免错误 PII）；若你接受静默降级则选 C。

## 非目标

- 不改 `web-monitor` 的对外路由、权限、防注入与 token 鉴权契约（除 D8 的请求体解析简化）。
- 不处理 backlog 中其他条目（mongo models 测试缺口、throttle 时钟、consume 开关等）。
- 不引入新 ADR；如你要求把 D3 的口径定为合约变更，再补 ADR。

## 验证（逐项批准后执行）

1. registry 改源码 + 更新对应钉点测试；`npm run test:web-monitor`（仅依赖无关用例）。
2. 逐文件机械同步到 `nightwatch-backend/src/modules/web-monitor`，`diff -rq` 两边目录必须为空。
3. 消费仓全量：`docker exec -w /home/worldzhy/src/nightwatch-backend 66b958b39256 sh -c 'node --import tsx --test <web-monitor test files>'`，目标 278 例保持全绿（按改动项更新断言）。
4. `format:check` 两仓通过。
5. 两仓显式路径提交、推送，`ls-remote` 核对 hash。
6. 更新 registry backlog：删除已修复条目；未修的保留并写明裁决。

## 待批准

按 D1-D9 逐条回复：修（选 A/B/C 中哪个）或 不修。未回复项保持现状。
