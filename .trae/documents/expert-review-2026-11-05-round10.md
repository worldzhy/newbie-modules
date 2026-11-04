# Expert Review round10 — R9-01 修复验证（web-monitor）

评审类型：**定向 delta 复核**——只审 R9-01 修复变更集（3 个文件），不是全模块复审。触发：用户要求"专家 review 以上修改有没有问题"。

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 备注 |
|---|---|---|---|---|
| newbie-modules | dev | a7a3175 | 5 项：`M shared/utils.ts`、`M modules/web/services/report-task.service.ts`、`?? report-task.service.test.ts`、`?? round8/round9 报告` | dirty 路径即被审修复本体 |
| nightwatch-backend | dev | f60bbdd | 0 dirty | 装配面未动（修复尚未装配） |

- 评审窗口：2026-11-05 约 01:00–01:20 CST（Asia/Shanghai；锚点取证时刻 01:18）。
- **流程偏差披露（§8 反模式"评审与修复同会话"）**：被审修复由本会话前序上下文产出，存在"自己修、自己评"的意图确认偏差。补偿：全部关键结论以 executed 证据落地（红/绿对照、CH 探针），置信级别逐条标注；static/inferred 结论不外推为 executed。
- 评审期间的新偏差（透明披露）：第一轮测试执行只复制了测试文件到**未修复**的 backend 装配面，导致 3/4 红——这是方法错误，但它同时构成"测试能检出毒丸"的阴性对照，已纳入 §8 证据链；随后补齐 3 个修复文件重跑转绿。

## 2. 范围与方法

- `scope: modules: [web-monitor]` 的变更集子集：
  - `packages/modules/web-monitor/shared/utils.ts`（新增 `func.toDateOrNow`）
  - `packages/modules/web-monitor/modules/web/services/report-task.service.ts`（4 处客户端时间写入点改 `toDateOrNow`）
  - `packages/modules/web-monitor/modules/web/services/report-task.service.test.ts`（新增，模块首个测试）
- 方法：不变量复核（全量 grep `toDate|new Date(` 逐点归类写/读路径）→ 反驳轮（构造可达输入尝试打破不变量）→ 可执行验证（容器内 `node --import tsx --test`；ClickHouse 8123 直探）。
- 单路执行，无并行子代理；无重跑失败。

## 3. 结论摘要

**修复成立，可以提交。** 无新增 P0/P1；2 个新 P2（测试覆盖缺口、数值字符串解析建议）；1 个反驳向量被运行时探针否决。本修复只关闭 Invalid Date 这一类毒丸，**不等于 drain 可靠性闭环**（R9-04 吞错无记账、R9-07 无界重入队仍 open）。

| 维度 | 评分 | 说明 |
|---|---|---|
| 安全 | 改善 | 匿名可达的确定性重入队毒丸（R9-01）关闭；其他永久失败类毒丸仍可能（待 C 层切片） |
| 契约 | 不变 | 上报侧请求契约未动；drain 语义由"毒丸"改为"非法时间回落采集时刻"，与代码注释 "loss is not acceptable" 一致 |
| 测试 | 改善但有缺口 | 模块首个测试落地且被证明能检出毒丸（对未修复代码 3/4 红）；4 处修复点仅 2 处有真实覆盖（R10-01） |
| 门禁 | 无变化 | registry 无 test script；测试经装配由消费仓 `npm test` 拾取（shortcut 先例已证实装配携带 `.test.ts`） |

## 4. P0

无。

## 5. P1

无新增。R9-01 维持 P1，状态建议记为 **fixed（待提交）**：

- 证据：`report-task.service.ts:375/196/426/470` 全部改 `toDateOrNow`；`utils.ts:112-115` 新增实现。
- 复现路径（修复前）：payload `time="not-a-date"` → `Invalid Date` → Mongoose `Cast to date failed` → flush 失败 → raw `lpush` 永久重入队。
- 回归指针：`report-task.service.test.ts` 4 例。

## 6. P2

### R10-01（测试覆盖缺口）4 处修复点仅 2 处有真实覆盖，test3 名实不符

- `report-task.service.test.ts:102-118` 命名为 "resource requestTime"，但用例 `resourceList: [{ type: "fetch", ... }]` 在 `forEachResources`（`report-task.service.ts:402`）走 **saveAjaxs 分支（L426）**；
- 真正未覆盖的两处：
  - `report-task.service.ts:196`（`collectResource`，非 ajax 资源且 `duration >= slowTime` 才产行）
  - `report-task.service.ts:470`（`collectErrors`，`errorList[].createTime` 非法）
- 性质：测试全部通过但覆盖声明不实——与本范式历史缺陷（计数/口径漂移）同类，须点名。修复：补 collectResource（如 `type:"img"` + 大 `duration`）与 collectErrors 两例，并改正 test3 命名。
- 严重度 P2：实现本身已被静态追踪 + 红绿对照间接覆盖，风险是后续回归无哨兵。

### R10-02（改进建议，非回归）数值字符串 epoch 回落为 now

- `"1700000000000"`（字符串形 epoch ms）→ `new Date("1700000000000")` = NaN → 回落采集时刻。旧行为同为 NaN（毒丸），新行为严格更优，**不构成回归**；但 SDK 若以字符串上送 epoch，时间精度静默丢失。建议 `toDateOrNow` 对纯数字字符串先 `Number()` 再铸造。
- 严重度 P2：数据精度，非可用性。

## 7. 误报剔除（反驳轮否决的向量）

**"合法但越界的 Date 仍构成同类毒丸"——否决（executed）。**

- 构造：`time` 为可解析但超出 ClickHouse `DateTime` 值域 [1970, 2106] 的日期（`WebAjax.createTime` 为 `ClickHouseDataType.DateTime`，`models/clickhouse/web/ajax.ts:11`；`insertMany` 走 JSONEachRow 直传，`clickhouse.model.ts:49-58`）。
- 探针（本地 CH 8123，`default.probe_r901` 同构表）：
  - `"2026-11-05T01:02:03.000Z"` → 插入成功，存 `2026-11-05 01:02:03`（CH 接受 ISO/T/Z 序列化）；
  - `"1966-01-01T00:00:00.000Z"` → **插入成功，静默截断为 `1970-01-01 00:00:00`**；
  - `"3000-01-01T00:00:00.000Z"` → **插入成功，静默截断为 `2106-02-07 06:28:15`**。
- 结论：越界合法 Date 不触发写失败，不构成重入队毒丸。Mongo 侧 BSON Date 为 Int64 ms，JS Date 全域（±8.64e15 ms）可编码（spec 级 static）。威胁模型不变：攻击者本就能伪造值域内任意时间戳，截断不新增能力。探针表已 DROP。

## 8. 已核验通过的不变量

1. **drain 全部 7 类 bucket 行的 `createTime` 均可追溯到 `toDateOrNow`**（static，逐点核对）：源头 `L375`（page/environment/custom/sdkError 经 `item.createTime` 派生）+ `L196`/`L426`/`L470` 三处自带字段包装。
2. **模块内剩余 `func.toDate` 全部位于只读路径**（static，grep 全量）：`pvuvip.controller.ts:54,86,87,104,105`、`page.controller.ts:39`、`page.service.ts:154,199,200,221,222`、`resource.service.ts:47,48`——均为查询过滤，无 store 写。
3. **测试对毒丸有检出能力**（executed）：未修复装配面下 3/4 红（`createTime` 为 Invalid Date，JSON 序列化呈 `null`）；修复后 4/4 绿（容器 `node --import tsx --test`）。
4. **CH 越界 Date 截断不抛错**（executed 探针，见 §7）。
5. **`toDateOrNow` 对 JSON.parse 可达类型不抛**（static）：输入类型域 {string, number, boolean, null, array, plain object}；`String()` 对该域不抛；`Number.isNaN(getTime())` 兜底全部不可解析形态；`time` 省略（undefined）→ now，已有测试覆盖。
6. **装配携带 `.test.ts`**（static 先例）：`nightwatch-backend/src/modules/shortcut/shortcut-item.controller.test.ts` 存在；装配后 `npm test` 的 `find src -name '*.test.ts'` 会拾取本测试。
7. **backend 工作树复核后 0 dirty**（executed，`git status --porcelain` 空）。

## 9. 覆盖率清单

- **审了**：变更集 3 文件全行；`report-task.service.ts` 全文（含 drain/flush/requeue L282-369）；`utils.ts` 全文；模块内全部 `toDate|new Date(` 命中点（grep 100 行逐条归类）；CH 序列化路径（`clickhouse.model.ts`）；CH DateTime 边界行为（运行时探针）；装配测试先例（shortcut）。
- **没审**：Mongo schema 层（WebPage/WebResource 等 Date 字段定义，按修复前既有行为不变未动）；`@clickhouse/client` 内部 Date 序列化实现（以探针结果代替源码阅读）；读路径非法 `beginTime/endTime` 的 Mongoose 查询铸造行为（inferred：Invalid Date 过滤至多单请求失败，不构成队列毒丸——维持 round9 前既有定级，未新探）；redis/mongo 容器内真实 drain 端到端（以单测 + CH 探针代替）；frontend。

## 10. 修复优先级

1. **提交本修复**（registry-first：装配 web-monitor → `diff -rq` 零差异 → backend `npm test` 拾取新测试 → `nest build` → 双仓提交）。阻塞点：等用户点头。
2. **R10-01 补测试**（collectResource + collectErrors 两例，改 test3 命名）——可与 C 层切片同批，不阻塞本次提交。
3. **R10-02**（数字字符串 epoch 解析）——随 C 层切片评估，不单独提交。
4. R6-13 剩余切片按 round9 §10 修订顺序：C 层（含 R9-04 记账、R9-07 有界重试/死信）→ A 批次（38 端点参数级校验）→ D → R8-07 定级。

## 11. 台账指针

- `newbie-modules/.trae/documents/findings.md`：R9-01 → fixed（待提交，回归指针 = 本测试 4 例）；新增 R10-01/R10-02；R9-04/R9-07 维持 open。
- round9 报告：`expert-review-2026-11-04-round9.md`（本报告不改写其 findings，仅验证 R9-01 的修复落地）。
