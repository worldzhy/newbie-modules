# Backlog

Unfinished engineering tasks. Completed items are deleted (git history is the archive).

来源标记：`[安全评审 round2 2026-10-30]` 指 devbie 仓 `.trae/documents/expert-review-2026-10-30-round2.md`（未跟踪文件）。

## P0（未修复，1 条）

- [ ] `[安全评审 round2 #6]` **account 微信登录无服务端校验**：`packages/modules/account/auth/wechat/auth.service.ts` L17-38，`phone`/`openId` 取自请求体，无 code2session/getPhoneNumber 服务端校验；且漏 `UserStatus.INACTIVE` 检查。修复：改收 `code` 服务端换 openId、服务端解密手机号，补 INACTIVE 拒绝。

## 技术债（已在 ADR 登记，未落地）

- [ ] ADR-037 契约 3：`JudgmentInput.subject` 收窄为 `Omit<EvaluationSubjectRef, "kind">`。
- [ ] ADR-037 契约 3：注释术语 "the knowledge store is the evidence layer" 改为 "serves as intel's evidence source, not manifest items"。
- [ ] ADR-037 契约 4（threat-intel 补账）：窗口内候选情报投影成 `EvaluationEvidenceItem`（`layer: "knowledge"`）进 manifest，预算未比对条目进 `skipped` 并登记数量；第二处旁路（注入 provider 读 `project` 表构造匹配实体）收敛为经 `input.subject` / `input.evidence` 传入或显式登记外部来源。来源：2026-10-29 评审，已同时登记在 nightwatch-backend ADR-037「影响」节。
- [ ] ADR-039 术语过期：与当前 security-evaluation 实现不匹配，待随下一次契约修订同步。
