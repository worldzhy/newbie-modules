# Backlog

Unfinished engineering tasks. Completed items are deleted (git history is the archive).

来源标记：`[安全评审 round2 2026-10-30]` 指 devbie 仓 `.trae/documents/expert-review-2026-10-30-round2.md`（已入库）。

## P0（未修复）

（暂无）

## 保持现状（不承诺可用）

- [ ] `[R3-19]` workflow / stock-mgmt 空壳模块：`packages/modules/workflow/workflow.module.ts` 与 `packages/modules/stock-mgmt/stock-mgmt.module.ts` 仅为 `@Module({})`，无 controller/service。2026-11-02 用户拍板保持现状，不装配、不补实现、不移出 registry；两个模块均未列入宿主 `modules.json`，属 artifact。若后续启用需走"补实现"路径并作为新里程碑。

## 暂不做（条件触发后再启动）

- [ ] `[2026-11-05 设计讨论，未拍板]` **message-tracker 重构方向（挂起，待后续讨论拍板）**：现状为 NestJS 模块 + 完整 SST serverless app 混装（`packages/modules/message-tracker/sst/`，Lambda 裸 SQL 直写宿主库、独立 DB_* 配置，registry 唯一 package-lock + 99 条告警均出于此），装配后不可用。已讨论的候选方向：A. worker 折进 backend 进程（发送复用 aws-ses/aws-sms，异步复用 queue 模块，SES/SMS → SNS HTTPS 验签回调写 Prisma；删除 sst/、infrastructure/cloudformation、MESSAGE_TRACKER_SQS_*）；B. 保留 Lambda 但升级为独立 service 产物 + 强制回调宿主 API 写库。关键判据：消息量是否需要独立于 API 扩缩容。附：manifest 当前 `layer: "capability"`，按 2026-11-05 用户定位应为 `feature`，落地时一并订正。配套框架契约见 devbie backlog 同日期条目。
- [ ] `[R19-08 观察项 2026-11-06]` **js-error-first-seen 每指纹一个 Redis key**：key 形态 `web-monitor:alert-state:<appKey>:js-error-first-seen:<fingerprint>`，指纹基数随错误种类增长，TTL 2h 自然过期。当前规模无风险；高基数应用下的 key 数量与内存占用应在后续"阈值配置化"ADR 中一并审视（届时可评估指纹分桶/采样）。
- [ ] `[2026-11-05 设计讨论，未拍板]` **feature 模块 AWS 资源统一标准（挂起，待后续讨论拍板）**：拟在 manifest 增加 `infrastructure` 字段（CFN 模板路径、参数、outputs、账号级 prerequisites 只检查不创建），模板随模块同仓存放；已拍板的边界：不为此单开新仓库，Lambda/ECS 等外部运行时不进模块（另立 service 产物）。runner 与部署链契约见 devbie backlog 同日期条目。落地前先出 ADR（本仓写 manifest 契约）。

- [ ] `[安全评审 round2 #6]` **（暂不做，待有微信消费端再启动）** account 微信登录无服务端校验：`packages/modules/account/auth/wechat/auth.service.ts` L17-38，`phone`/`openId` 取自请求体，无 code2session/getPhoneNumber 服务端校验；且漏 `UserStatus.INACTIVE` 检查。修复方案（恢复时按此执行）：改收 `code` 服务端换 openId、服务端解密手机号，补 INACTIVE 拒绝。决策：2026-10-31 用户明确在出现首个微信消费端之前不做；风险留痕——若届时已有调用方接入而未修复，属高危未修复项。

## 装配配置字面量（2026-11-06 清理：条目过时，修复已在现仓）

> 2026-11-06 取证：registry 所有 manifest 的 `requires.config` 值全为纯 `process.env.XXX` 字符串（零 fallback 表达式）；CLI `assemble/modules.ts#L77-86 assertUnwrappableExpressions` reject 含引号内 fallback 的表达式（如 `process.env.X || 'fallback'`）；渲染产物 `modules.config.ts` 中 49 处 process.env 无一处被引号包裹——全是真实 TS 表达式。backlog 原条目描述"10 个 manifest 共 14 处 `|| '默认值'`"是 ADR-033 落地前的历史残留，现已闭环。

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
