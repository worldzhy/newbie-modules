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

（R4-04 + R4-09 已修复：NegativeCache → VerdictCache（加 verdict 枚举），record 加 verdict/matchedEntity 字段；filterUncached 加 verdict="not-relevant" + TTL 过滤（默认 7 天，NEGATIVE_CACHE_TTL_DAYS env 可覆盖）；evidence provider fetchedAt asc → desc；硬命中也写缓存（audit-only，不进 filterUncached）。commit 16930cf。）

## 安全评审 round3 P2（二次取证后 open，2026-11-02 入账）

> 来源：devbie `.trae/documents/expert-review-2026-10-31-round3.md` §P2 + §R3-G1。9 条误报与 1 条出界已剔除（见同文件 §误报剔除与本次复核记录）。

（Wave 5 最后一条 P2-08 已修复：event-emitter `record()` 前加 lazy `deleteMany({ emittedAt: < now - N days })`，默认 30 天，`EVENT_EMISSION_RETENTION_DAYS` env 可覆盖；无 @nestjs/schedule 依赖、无 migration。）

