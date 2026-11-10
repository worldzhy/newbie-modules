# Tasks: web-monitor 疑似缺陷修复（按拍板结果执行）

前置：`web-monitor-defect-adjudication-spec.md` 中 D1-D9 每条已获用户明确选择（修/不修 + 选项字母）。未获批的条目不执行。

## Phase 0 — 拍板入账

- [x] 0.1 记录 D1-D9 每条最终裁决（修 A/B/C 或不修）到 registry backlog 对应条目。
- [x] 0.2 仅对"修"的条目建立代码改动清单（文件 + 行 + 测试文件）。

## Phase 1 — registry 源码与钉点测试

- [x] 1.1 D1（修 A）：`modules/web/services/error.service.ts` L88-99 条件化 select/groupBy；更新 `error.service.test.ts` L139-156 断言为合法 SQL 形态。
- [x] 1.2 D2（修 A）：`page.service.ts` L107-145 将双边时间窗并入 `$match`；更新 `page.service.test.ts` L150-196 三个用例。
- [x] 1.3 D3（修 A）：`resource.service.ts` L27/L81/L102、`page.service.ts` L186-193、`environment.service.ts` L10 改为按边生效；更新 `resource.service.test.ts` L68-78、`environment.service.test.ts` L82-86、`page.service.test.ts` L223-238。
- [x] 1.4 D4（修 A）：`custom.service.ts` L34-49 findOne 为空即抛；更新 `custom.service.test.ts` 删除不存在用例。
- [x] 1.5 D5（修 A）：`pvuvip.service.ts` L35-43 `?? 0`；更新 `pvuvip.service.test.ts` L124-139。
- [x] 1.6 D6：裁决 C（保持现状），未改代码。
- [x] 1.7 D7（修 A）：`jobs.service.ts` L242-243 模型获取移入 `runSignal` 内；更新 `jobs.service.test.ts` 对应用例。
- [x] 1.8 D8（修 A）：`report.controller.ts` L44-52 简化为 string→parse / object→直接用；更新 `report.controller.test.ts` L124-131。
- [x] 1.9 D9（修 A）：`shared/utils.ts` L183-197 未知对返回 `undefined`；更新 `shared/utils.test.ts` L224-226，并检查 `report-task.service.ts` L325/L531/L586 调用语义。
- [x] 1.10 registry 自测：`npm run test:web-monitor`（9/9 通过）。

## Phase 2 — 同步消费仓

- [x] 2.1 逐文件复制 registry → `nightwatch-backend/src/modules/web-monitor`（只复制实际改动文件）。
- [x] 2.2 `diff -rq` 两目录：registry `packages/modules/web-monitor` vs backend `src/modules/web-monitor` 输出为空。
- [x] 2.3 `npm run build`（backend；顺带修复测试文件 5 处仅类型错误）。

## Phase 3 — 消费仓全量测试

- [x] 3.1 `docker exec -w /home/worldzhy/src/nightwatch-backend 66b958b39256 sh -c 'node --import tsx --test <web-monitor 测试文件列表>'`。
- [x] 3.2 结果：279 例全绿、0 失败（新增 1 例缺失文档用例）。

## Phase 4 — 格式与提交

- [x] 4.1 `format:check`（registry 与 backend 各自 web-monitor 目录）通过。
- [x] 4.2 registry：显式路径暂存 + 英文提交信息 + push（credential helper 单命令注入）。→ `fc330c6`
- [x] 4.3 backend：仅暂存 `src/modules/web-monitor` 改动，避开另一会话的未跟踪文件与 `src/application/authorization/scope-resolvers.ts`；提交 + push。→ `34ddf32`
- [x] 4.4 `ls-remote` 核对两个远端 dev 头与本地一致（推送后远端已含 `fc330c6` / `34ddf32`；本地随后又被并行会话推进）。
- [x] 4.5 更新 registry backlog：已修条目删除，未修条目保留裁决结论。
