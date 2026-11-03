# Backlog

Unfinished engineering tasks. Completed items are deleted (git history is the archive).

来源标记：`[安全评审 round2 2026-10-30]` 指 devbie 仓 `.trae/documents/expert-review-2026-10-30-round2.md`（已入库）。

## P0（未修复）

（暂无）

## 保持现状（不承诺可用）

- [ ] `[R3-19]` workflow / stock-mgmt 空壳模块：`packages/modules/workflow/workflow.module.ts` 与 `packages/modules/stock-mgmt/stock-mgmt.module.ts` 仅为 `@Module({})`，无 controller/service。2026-11-02 用户拍板保持现状，不装配、不补实现、不移出 registry；两个模块均未列入宿主 `modules.json`，属 artifact。若后续启用需走"补实现"路径并作为新里程碑。

## 暂不做（条件触发后再启动）

- [ ] `[安全评审 round2 #6]` **（暂不做，待有微信消费端再启动）** account 微信登录无服务端校验：`packages/modules/account/auth/wechat/auth.service.ts` L17-38，`phone`/`openId` 取自请求体，无 code2session/getPhoneNumber 服务端校验；且漏 `UserStatus.INACTIVE` 检查。修复方案（恢复时按此执行）：改收 `code` 服务端换 openId、服务端解密手机号，补 INACTIVE 拒绝。决策：2026-10-31 用户明确在出现首个微信消费端之前不做；风险留痕——若届时已有调用方接入而未修复，属高危未修复项。

## 技术债（已在 ADR 登记，未落地）

（暂无）

## security-evaluation 评审 round4 未修项（2026-10-31）

报告：`.trae/documents/expert-review-2026-10-31-round4.md`；台账：同目录 `findings.md`。

- [ ] `[round4 R4-04]` **P2** 负缓存键仅 `(knowledgeItemId, scopeKey)`，缺实体集/模型版本维度，且采集层在硬召回前过滤（`evidence/security-evaluation-evidence.provider.ts`）。需产品确认失效语义：缓存键加实体集指纹，或缓存只用于"是否再调 LLM"、硬召回始终先跑。
- [ ] `[round4 R4-09]` **P2** 证据预算 `fetchedAt asc` 截断，硬命中永不负缓存，候选 >200 时新条目永久落在 `overBudget`。需决定预算策略：改新条目优先（翻转排序，老条目可能饿死），或建 per-scope 已评估水位（需 schema 变更）。

## 安全评审 round3 P2（二次取证后 open，2026-11-02 入账）

> 来源：devbie `.trae/documents/expert-review-2026-10-31-round3.md` §P2 + §R3-G1。9 条误报与 1 条出界已剔除（见同文件 §误报剔除与本次复核记录）。

- [ ] `[R3-P2-01]` **P2** account api-key LRU 仅 `max` 无 TTL，校验只比对 hash 不查 `UserStatus`：`account/modules/api-key/api-key.service.ts` L38-93、`account/security-ports/api-key.verifier.ts` L16-30。
- [ ] `[R3-P2-08]` **P2** event-emitter 全量事件落库、无保留期：`event-emitter/event-emitter.service.ts` L36、L99-107。
- [ ] `[R3-P2-09]` **P2** elasticsearch 代码读 `retries` 但 manifest 未声明：`elasticsearch/elasticsearch.service.ts` L32 vs `newbie.module.json` L8-14。
- [ ] `[R3-P2-10]` **P2** web-monitor `POST /system/add` body 用 `projectId`，宿主 resolver 只认 `params/query/body.appId`：`web-monitor/modules/site/site.service.ts` L27 vs nightwatch-backend `scope-resolvers.ts` L202-212（跨仓，修复在两边对齐字段）。
- [ ] `[R3-P2-11]` **P2** `@RequireOwner` 注释与 guard 行为相反：`security/authorization/require-owner.decorator.ts` L9-11 称 admin 可绕过，`ownership.guard.ts` L9-13 明确无绕过；改注释或加 ADMIN bypass 需拍板。
- [ ] `[R3-P2-12]` **P2** people-finder `createTaskBatch` check-then-create，`schema.prisma` L34 `batchId` 无 `@unique`：`people-finder/people-finder.service.ts` L126-137。
- [ ] `[R3-G1-1]` **P2** tag/tag-group 全部路由零授权、DTO 直通 Prisma 输入：`tag/tag.controller.ts` L45-63、L117-134；`tag/tag-group.controller.ts` L13-28。

