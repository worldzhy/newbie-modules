# Backlog

Unfinished engineering tasks. Completed items are deleted (git history is the archive).

来源标记：`[安全评审 round2 2026-10-30]` 指 devbie 仓 `.trae/documents/expert-review-2026-10-30-round2.md`（已入库）。

## P0（未修复）

（暂无）

## 暂不做（条件触发后再启动）

- [ ] `[安全评审 round2 #6]` **（暂不做，待有微信消费端再启动）** account 微信登录无服务端校验：`packages/modules/account/auth/wechat/auth.service.ts` L17-38，`phone`/`openId` 取自请求体，无 code2session/getPhoneNumber 服务端校验；且漏 `UserStatus.INACTIVE` 检查。修复方案（恢复时按此执行）：改收 `code` 服务端换 openId、服务端解密手机号，补 INACTIVE 拒绝。决策：2026-10-31 用户明确在出现首个微信消费端之前不做；风险留痕——若届时已有调用方接入而未修复，属高危未修复项。

## 技术债（已在 ADR 登记，未落地）

（暂无）

## 清理项

- [ ] GitHub 模块同名死方法未清：`packages/modules/github/github.service.ts` 的 `listAccessibleRepositories` / `listCommits` / `getCommitDetail` / `listPullRequests` / `listPullRequestReviews` 及 `GitHubCommitEvidence` / `GitHubCommitDetail` / `GitHubPullRequestEvidence` / `GitHubReviewEvidence`、`MAX_EVIDENCE_PAGES` 在 nightwatch-backend 已无任何调用方（ADR-029 证据采集改为走 security-evaluation 端口）。bitbucket 模块 2026-10-31 落地时已裁掉同组方法，GitHub 侧对照裁剪作为独立清理项。

