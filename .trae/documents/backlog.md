# Backlog

Unfinished engineering tasks. Completed items are deleted (git history is the archive).

来源标记：`[安全评审 round2 2026-10-30]` 指 devbie 仓 `.trae/documents/expert-review-2026-10-30-round2.md`（已入库）。

## P0（未修复）

（暂无）

## 保持现状（不承诺可用）

- [ ] `[R3-19]` workflow / stock-mgmt 空壳模块：`packages/modules/workflow/workflow.module.ts` 与 `packages/modules/stock-mgmt/stock-mgmt.module.ts` 仅为 `@Module({})`，无 controller/service。2026-11-02 用户拍板保持现状，不装配、不补实现、不移出 registry；两个模块均未列入宿主 `modules.json`，属 artifact。若后续启用需走"补实现"路径并作为新里程碑。

## 暂不做（条件触发后再启动）

- [ ] `[2026-11-05 设计讨论，未拍板]` **message-tracker 重构方向（挂起，待后续讨论拍板）**：现状为 NestJS 模块 + 完整 SST serverless app 混装（`packages/modules/message-tracker/sst/`，Lambda 裸 SQL 直写宿主库、独立 DB_* 配置，registry 根与 `sst/` 各一份 package-lock + 99 条告警均出于此），装配后不可用。已讨论的候选方向：A. worker 折进 backend 进程（发送复用 aws-ses/aws-sms，异步复用 queue 模块，SES/SMS → SNS HTTPS 验签回调写 Prisma；删除 sst/、infrastructure/cloudformation、MESSAGE_TRACKER_SQS_*）；B. 保留 Lambda 但升级为独立 service 产物 + 强制回调宿主 API 写库。关键判据：消息量是否需要独立于 API 扩缩容。附：manifest 当前 `layer: "capability"`，按 2026-11-05 用户定位应为 `feature`，落地时一并订正。配套框架契约见 devbie backlog 同日期条目。
- [ ] `[R19-08 观察项 2026-11-06]` **js-error-first-seen 每指纹一个 Redis key**：key 形态 `web-monitor:alert-state:<appKey>:js-error-first-seen:<fingerprint>`，指纹基数随错误种类增长，TTL 2h 自然过期。当前规模无风险；高基数应用下的 key 数量与内存占用应在后续"阈值配置化"ADR 中一并审视（届时可评估指纹分桶/采样）。
- [ ] `[2026-11-05 设计讨论，未拍板]` **feature 模块 AWS 资源统一标准（挂起，待后续讨论拍板）**：拟在 manifest 增加 `infrastructure` 字段（CFN 模板路径、参数、outputs、账号级 prerequisites 只检查不创建），模板随模块同仓存放；已拍板的边界：不为此单开新仓库，Lambda/ECS 等外部运行时不进模块（另立 service 产物）。runner 与部署链契约见 devbie backlog 同日期条目。落地前先出 ADR（本仓写 manifest 契约）。

- [ ] `[安全评审 round2 #6]` **（暂不做，待有微信消费端再启动）** account 微信登录无服务端校验：`packages/modules/account/auth/wechat/auth.service.ts` L17-38，`phone`/`openId` 取自请求体，无 code2session/getPhoneNumber 服务端校验；且漏 `UserStatus.INACTIVE` 检查。修复方案（恢复时按此执行）：改收 `code` 服务端换 openId、服务端解密手机号，补 INACTIVE 拒绝。决策：2026-10-31 用户明确在出现首个微信消费端之前不做；风险留痕——若届时已有调用方接入而未修复，属高危未修复项。

## 装配配置字面量（2026-11-06 清理：条目过时，修复已在现仓）

> 2026-11-06 取证：registry 所有 manifest 的 `requires.config` 值全为纯 `process.env.XXX` 字符串（零 fallback 表达式）；CLI `assemble/modules.ts#L77-86 assertUnwrappableExpressions` reject 含引号内 fallback 的表达式（如 `process.env.X || 'fallback'`）；渲染产物 `modules.config.ts` 中 46 处 process.env 无一处被引号包裹——全是真实 TS 表达式（2026-11-09 实测 46）。backlog 原条目描述"10 个 manifest 共 14 处 `|| '默认值'`"是 ADR-033 落地前的历史残留，现已闭环。

## 技术债（已在 ADR 登记，未落地）

（暂无）

## security-evaluation 评审 round4 未修项（2026-10-31）

报告：`.trae/documents/expert-review-2026-10-31-round4.md`；台账：同目录 `findings.md`。

（R4-04 + R4-09 已修复：NegativeCache → VerdictCache（加 verdict 枚举），record 加 verdict/matchedEntity 字段；filterUncached 加 verdict="not-relevant" + TTL 过滤（默认 7 天，NEGATIVE_CACHE_TTL_DAYS env 可覆盖）；evidence provider fetchedAt asc → desc；硬命中也写缓存（audit-only，不进 filterUncached）。commit 16930cf。）

## 安全评审 round3 P2（二次取证后 open，2026-11-02 入账）

> 来源：devbie `.trae/documents/expert-review-2026-10-31-round3.md` §P2 + §R3-G1。9 条误报与 1 条出界已剔除（见同文件 §误报剔除与本次复核记录）。

（Wave 5 最后一条 P2-08 已修复：event-emitter `record()` 前加 lazy `deleteMany({ emittedAt: < now - N days })`，默认 30 天，`EVENT_EMISSION_RETENTION_DAYS` env 可覆盖；无 @nestjs/schedule 依赖、无 migration。）




## 安全评审 round27 P3（2026-11-08，registry）

> 来源：devbie `.trae/documents/expert-review-2026-11-08-round27.md`（R25 修复批次复核）。
> R27-02 已于 `4817d10` 修复：`permission-group.dto.test.ts` 用前端同一张向量表断言 Create/Update DTO，装配进 backend 后 5/5 通过。

## security-evaluation credentialRef 评审（2026-11-08 入账）

> 来源：本会话对 credentialRef 交付（registry `c87ad2c` / backend `842e62e` / frontend `a08edde`）的评审；5 条问题经 2 个独立探针确认。问题 1、2 属宿主层，见 nightwatch-backend backlog 同日条目。

- [x] `[SE-CRED-03]` **unevaluable 桶不覆盖悬空引用（minor，建议只补文档）**：`packages/modules/security-evaluation/reporting/security-evaluation-report.service.ts` L100-105 仅判 `!subject.credentialRef`；模块对引用不透明、无法解析绑定是否存在。结论：不改代码——provider 只枚举 live binding，悬空引用属退役 subject 的瞬态，run 时会以 subject 级失败暴露。若要固化，在 ADR-039 或 report 注释写明"悬空引用 = run-time skipped，不是 unevaluable"。**fixed（2026-11-09，`b48d9bf`）**：报告注释已写明 dangling ref 与 unevaluable 的分工。


## web-monitor 疑似源码缺陷（2026-11-09 入账，同日裁决关闭）

> 来源：web-monitor 全功能行为测试补写（registry `54fb7d5` / backend `11442d6`，278 例全绿）。裁决：用户批准 spec `.trae/documents/web-monitor-defect-adjudication-spec.md`（执行清单 `web-monitor-defect-adjudication-tasks.md`）。D1-D5、D7-D9 取选项 A 修复（registry `fc330c6` / backend `34ddf32`）：消费仓 build 通过、279 例全绿、两侧 `diff -rq` 为空。

- [ ] `[D6 保持现状 2026-11-09]` 死 cfg：`analysis.service`、`error.service`、`page.service`、`resource.service`、`jobs.service`、`report-task.service`、`ajax.service`、`pvuvip-task.service`、`pvuvip.controller` 构造中读取的 `this.cfg` 均未使用（limit 走 `WEB_MONITOR_CONFIG` 常量）。裁决 C：非缺陷、无行为影响；若后续批量清理 DI 与测试夹具时统一处理。


## web-monitor 测试覆盖已知缺口（2026-11-09 入账）

- [ ] `models/mongo/web-monitor-models.service.ts`（集合命名契约）无法单测：tsx 运行时不发 emitDecoratorMetadata，Mongoose schema 模块在测试中无法加载（`@Prop` 抛 CannotDetermineTypeError）；`import "reflect-metadata"` 与 `--tsconfig` 均无效，`mock.module` 需实验 flag 不能进 `npm test`。若未来切换测试运行时（如 ts-node/vitest 编译模式），可补回该文件测试。
- [ ] `services/web-token.resolver.ts` throttle 间隔到期后再次触达的方向未覆盖：`InstallationTouchThrottle` 实例私有且时钟取 `Date.now()`，不改源码注入时钟则不可达。
- [ ] `report.controller` consume 关闭分支（`is_web_consume_task_run`）不可测：`web-monitor-config.ts` 为代码常量不可注入。

## round30 评审入账（2026-11-09，workspace scope）

> 来源：devbie `.trae/documents/expert-review-2026-11-09-round30.md`；台账见 devbie `findings.md` round30 节与同目录 `findings.md` 引用行。

- [ ] `[R30-02 待拍板]` ClickHouseModel 原始插值面收敛（P3，真源在本仓 `packages/modules/clickhouse/clickhouse.model.ts:41,62-72`）：待拍板加标识符白名单入口（API 层）或仅 API 约束注释（文档层）。

## round31 backlog 核对入账（2026-11-09，plan scope）

> 来源：devbie `.trae/documents/expert-review-2026-11-09-round31.md`（scope = 6 份 backlog 的声明清单）。

- [x] `[R31-13]` **本文件 `:17`「registry 唯一 package-lock」计数不实（P3）**：实测 2 个（仓根 + `packages/modules/message-tracker/sst/`，`find -name package-lock.json -not -path '*/node_modules/*'`）。**fixed（2026-11-09）**：`mission-tracker` 条目改为「根与 sst 各一」。
- [x] `[R31-17]` **本文件 `:25`「`modules.config.ts` 49 处 process.env」计数不实（P3）**：**fixed（2026-11-09）**：实测 46（`grep -c 'process.env' nightwatch-backend/src/modules/modules.config.ts`），行内已改为 46；「无 fallback」部分成立。
- [x] `[R31-20 备注]` `:41` event-emitter「默认 30 天」表述偏松：代码为 `getOrThrow`（未配置抛错），30 仅 `.env` 与 manifest `example`，非代码默认。
