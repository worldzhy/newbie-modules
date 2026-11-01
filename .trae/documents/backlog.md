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

- [ ] `[round4 R4-02 → ADR-039 平台级改造]` **P1（重判定：架构改造，非越权修复）** security-evaluation 改为平台级模块：主体坐标 `platform`、`POST /subjects/sync` 改 ingest 契约（`sourceType/sourceId` 取代 `scopeType/scopeId`）、新增 `SecurityEvaluationAssetSource`（多对多溯源）、读接口 scope 参数降为筛选、存量数据坐标迁移 + 主体合并 + finding 去重。设计见 nightwatch-backend `.trae/documents/decisions/ADR-039-security-evaluation-as-platform-module.md`（待拍板）。不再需要白名单/resolver/矩阵那套改动。
- [ ] `[round4 R4-04]` **P2** 负缓存键仅 `(knowledgeItemId, scopeKey)`，缺实体集/模型版本维度，且采集层在硬召回前过滤（`evidence/security-evaluation-evidence.provider.ts`）。需产品确认失效语义：缓存键加实体集指纹，或缓存只用于"是否再调 LLM"、硬召回始终先跑。
- [ ] `[round4 R4-09]` **P2** 证据预算 `fetchedAt asc` 截断，硬命中永不负缓存，候选 >200 时新条目永久落在 `overBudget`。需决定预算策略：改新条目优先（翻转排序，老条目可能饿死），或建 per-scope 已评估水位（需 schema 变更）。

