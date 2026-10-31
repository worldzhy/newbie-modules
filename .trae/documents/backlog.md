# Backlog

Unfinished engineering tasks. Completed items are deleted (git history is the archive).

来源标记：`[安全评审 round2 2026-10-30]` 指 devbie 仓 `.trae/documents/expert-review-2026-10-30-round2.md`（已入库）。

## P0（未修复）

（暂无）

## 暂不做（条件触发后再启动）

- [ ] `[安全评审 round2 #6]` **（暂不做，待有微信消费端再启动）** account 微信登录无服务端校验：`packages/modules/account/auth/wechat/auth.service.ts` L17-38，`phone`/`openId` 取自请求体，无 code2session/getPhoneNumber 服务端校验；且漏 `UserStatus.INACTIVE` 检查。修复方案（恢复时按此执行）：改收 `code` 服务端换 openId、服务端解密手机号，补 INACTIVE 拒绝。决策：2026-10-31 用户明确在出现首个微信消费端之前不做；风险留痕——若届时已有调用方接入而未修复，属高危未修复项。

## 技术债（已在 ADR 登记，未落地）

（暂无）

## security-evaluation 评审 round4 未修项（2026-10-31）

报告：`.trae/documents/expert-review-2026-10-31-round4.md`；台账：同目录 `findings.md`。

- [ ] `[round4 R4-02]` **P1** 读面 scope 由客户端决定：`scopeType/scopeId/subjectId` 原样下传，OPERATOR 可跨项目读。注意：单纯把 `Evaluation*` 加进 `HOST_SCOPED_RESOURCES` 无效——`AccountPermissionAuthorizer` 在系统级授权命中时直接返回 true，不会走到项目 scope 检查（`account/security-ports/permission.authorizer.ts` L42-L69）。需先决定授权语义（项目 scope 是否覆盖系统级 grant），或由模块在 service 层按调用者主体复核；同时 `GET results`（仅 subjectId）、`GET assets/:assetId/...`（仅 assetId）等无 scope 键的路由需配套 resolver，否则 fail-closed 会拒绝现有前端调用。
- [ ] `[round4 R4-04]` **P2** 负缓存键仅 `(knowledgeItemId, scopeKey)`，缺实体集/模型版本维度，且采集层在硬召回前过滤（`evidence/security-evaluation-evidence.provider.ts`）。需产品确认失效语义：缓存键加实体集指纹，或缓存只用于"是否再调 LLM"、硬召回始终先跑。
- [ ] `[round4 R4-09]` **P2** 证据预算 `fetchedAt asc` 截断，硬命中永不负缓存，候选 >200 时新条目永久落在 `overBudget`。需决定预算策略：改新条目优先（翻转排序，老条目可能饿死），或建 per-scope 已评估水位（需 schema 变更）。

