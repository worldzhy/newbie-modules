# Backlog

Unfinished engineering tasks. Completed items are deleted (git history is the archive).

来源标记：`[安全评审 round2 2026-10-30]` 指 devbie 仓 `.trae/documents/expert-review-2026-10-30-round2.md`（已入库）。

## P0（未修复）

（暂无）

## 保持现状（不承诺可用）

- [ ] `[R3-19]` workflow / stock-mgmt 空壳模块：`packages/modules/workflow/workflow.module.ts` 与 `packages/modules/stock-mgmt/stock-mgmt.module.ts` 仅为 `@Module({})`，无 controller/service。2026-11-02 用户拍板保持现状，不装配、不补实现、不移出 registry；两个模块均未列入宿主 `modules.json`，属 artifact。若后续启用需走"补实现"路径并作为新里程碑。

## 暂不做（条件触发后再启动）

- [ ] `[2026-11-05 设计讨论，未拍板]` **message-tracker 重构方向（挂起，待后续讨论拍板）**：现状为 NestJS 模块 + 完整 SST serverless app 混装（`packages/modules/message-tracker/sst/`，Lambda 裸 SQL 直写宿主库、独立 DB_* 配置，registry 唯一 package-lock + 99 条告警均出于此），装配后不可用。已讨论的候选方向：A. worker 折进 backend 进程（发送复用 aws-ses/aws-sms，异步复用 queue 模块，SES/SMS → SNS HTTPS 验签回调写 Prisma；删除 sst/、infrastructure/cloudformation、MESSAGE_TRACKER_SQS_*）；B. 保留 Lambda 但升级为独立 service 产物 + 强制回调宿主 API 写库。关键判据：消息量是否需要独立于 API 扩缩容。附：manifest 当前 `layer: "capability"`，按 2026-11-05 用户定位应为 `feature`，落地时一并订正。配套框架契约见 devbie backlog 同日期条目。
- [ ] `[2026-11-05 设计讨论，未拍板]` **feature 模块 AWS 资源统一标准（挂起，待后续讨论拍板）**：拟在 manifest 增加 `infrastructure` 字段（CFN 模板路径、参数、outputs、账号级 prerequisites 只检查不创建），模板随模块同仓存放；已拍板的边界：不为此单开新仓库，Lambda/ECS 等外部运行时不进模块（另立 service 产物）。runner 与部署链契约见 devbie backlog 同日期条目。落地前先出 ADR（本仓写 manifest 契约）。

- [ ] `[安全评审 round2 #6]` **（暂不做，待有微信消费端再启动）** account 微信登录无服务端校验：`packages/modules/account/auth/wechat/auth.service.ts` L17-38，`phone`/`openId` 取自请求体，无 code2session/getPhoneNumber 服务端校验；且漏 `UserStatus.INACTIVE` 检查。修复方案（恢复时按此执行）：改收 `code` 服务端换 openId、服务端解密手机号，补 INACTIVE 拒绝。决策：2026-10-31 用户明确在出现首个微信消费端之前不做；风险留痕——若届时已有调用方接入而未修复，属高危未修复项。

## 装配配置字面量（W1 后残余，2026-11-03 入账）

- [ ] `[R5-01-followup]` 仍有 10 个 manifest 共 14 处 `process.env.X || '默认值'`：account、aws-s3、aws-ses、aws-sms、aws-sqs、elasticsearch、llm、message-tracker、tencent-cos、web-monitor。CLI 正则无法解包含内层引号的值，生成结果为**字符串字面量**而非表达式（`web-monitor`、`account`、`aws-s3` 等已装配宿主，值在运行时错误）。修复方向二选一：(a) 逐个改为纯 `process.env.X`（无默认值，缺省即失败）；(b) 让 CLI 直接把整段表达式原样输出（需处理内层引号）。判据：`newbie modules apply` 不再输出此类告警，且生成文件里 `process.env` 无引号包裹。

## 技术债（已在 ADR 登记，未落地）

（暂无）

## security-evaluation 评审 round4 未修项（2026-10-31）

报告：`.trae/documents/expert-review-2026-10-31-round4.md`；台账：同目录 `findings.md`。

（R4-04 + R4-09 已修复：NegativeCache → VerdictCache（加 verdict 枚举），record 加 verdict/matchedEntity 字段；filterUncached 加 verdict="not-relevant" + TTL 过滤（默认 7 天，NEGATIVE_CACHE_TTL_DAYS env 可覆盖）；evidence provider fetchedAt asc → desc；硬命中也写缓存（audit-only，不进 filterUncached）。commit 16930cf。）

## 安全评审 round3 P2（二次取证后 open，2026-11-02 入账）

> 来源：devbie `.trae/documents/expert-review-2026-10-31-round3.md` §P2 + §R3-G1。9 条误报与 1 条出界已剔除（见同文件 §误报剔除与本次复核记录）。

（Wave 5 最后一条 P2-08 已修复：event-emitter `record()` 前加 lazy `deleteMany({ emittedAt: < now - N days })`，默认 30 天，`EVENT_EMISSION_RETENTION_DAYS` env 可覆盖；无 @nestjs/schedule 依赖、无 migration。）



