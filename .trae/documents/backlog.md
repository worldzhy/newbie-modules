# Backlog

Unfinished engineering tasks. Completed items are deleted (git history is the archive).

来源标记：`[安全评审 round2 2026-10-30]` 指 devbie 仓 `.trae/documents/expert-review-2026-10-30-round2.md`（未跟踪文件）。

## P0（未修复，1 条）

- [ ] `[安全评审 round2 #6]` **account 微信登录无服务端校验**：`packages/modules/account/auth/wechat/auth.service.ts` L17-38，`phone`/`openId` 取自请求体，无 code2session/getPhoneNumber 服务端校验；且漏 `UserStatus.INACTIVE` 检查。修复：改收 `code` 服务端换 openId、服务端解密手机号，补 INACTIVE 拒绝。

## P2（安全评审 round2，registry 18 条）

- [ ] `packages/modules/account`：审批子网 token 可重放。修复：一次性消费或绑定状态校验。
- [ ] `packages/modules/account`：验证码 validate→写→inactivate 三步非原子，一码两用。修复：单事务条件更新。
- [ ] `packages/modules/llm/management/llm-connection.service.ts` L128：`includes("****")` 判掩码，含 `****` 的真密钥被静默丢弃。修复：显式 mask 标记。
- [ ] `packages/modules/tencent-cos`：长期明文密钥 + 代码兜底默认值。修复：走凭证链、删除默认值。
- [ ] `packages/modules/aws-cloudformation`：示例 stack 内嵌 `postgres/postgres` 弱口令与真实 RDS 地址。修复：改占位符。
- [ ] `packages/modules/copilot`：把 ClickHouse/Prisma/Lark 原始 message 回喂模型。修复：统一错误摘要。
- [ ] `packages/modules/copilot`：`lark.cards` Map 只写不删，内存泄漏。修复：按会话/容量清理。
- [ ] `packages/modules/evaluation`：publishVersion `count→updateMany` 不在事务内，可发 0 criteria 版本。修复：事务内校验。
- [ ] `packages/modules/task-management`：状态机 check-then-act TOCTOU。修复：条件更新（`updateMany where status`）。
- [ ] `packages/modules/security-evaluation`：intel 单 run 通知无上限，可刷屏。修复：分页/上限。
- [ ] `packages/modules/security-evaluation`：`findingSummary` 全量载入内存。修复：分页聚合或增量统计。
- [ ] `packages/modules/aws-cloudwatch`：EC2 `deleteMany` 丢 `projectId` 条件，删掉他项目行。修复：补 `projectId`。
- [ ] `packages/modules/googleapis/google-drive`：删除授权先删本地后调远端，远端失败后残留失管。修复：先远端后本地。
- [ ] `packages/modules/redis`：无 `onModuleDestroy`，连接泄漏。修复：实现销毁钩子。
- [ ] `packages/modules/elasticsearch`：无 `onModuleDestroy`。修复：同上。
- [ ] `packages/modules/pdf/pdf.service.ts` L17：`getPdfPageCount` 全页渲染，OOM。修复：只读页树。
- [ ] `packages/modules/xlsx`：monkey-patch 全局 `console` + 无 zip bomb 防护。修复：局部 logger + 解压体积上限。
- [ ] `packages/modules/health`：HTTP 请求无超时。修复：`AbortSignal.timeout`。

> 原 P2 中「saas：team id 去重查错表」随 saas 模块移除（`6612f72`）作废，不再登记。

## 技术债（已在 ADR 登记，未落地）

- [ ] ADR-037 契约 3：`JudgmentInput.subject` 收窄为 `Omit<EvaluationSubjectRef, "kind">`。
- [ ] ADR-037 契约 3：注释术语 "the knowledge store is the evidence layer" 改为 "serves as intel's evidence source, not manifest items"。
- [ ] ADR-037 契约 4（threat-intel 补账）：窗口内候选情报投影成 `EvaluationEvidenceItem`（`layer: "knowledge"`）进 manifest，预算未比对条目进 `skipped` 并登记数量；第二处旁路（注入 provider 读 `project` 表构造匹配实体）收敛为经 `input.subject` / `input.evidence` 传入或显式登记外部来源。来源：2026-10-29 评审，已同时登记在 nightwatch-backend ADR-037「影响」节。
- [ ] ADR-039 术语过期：与当前 security-evaluation 实现不匹配，待随下一次契约修订同步。
