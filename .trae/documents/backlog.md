# Backlog

Unfinished engineering tasks. Completed items are deleted (git history is the archive).

来源标记：`[安全评审 round2 2026-10-30]` 指 devbie 仓 `.trae/documents/expert-review-2026-10-30-round2.md`（未跟踪文件）。

## P0（未修复，1 条）

- [ ] `[安全评审 round2 #6]` **account 微信登录无服务端校验**：`packages/modules/account/auth/wechat/auth.service.ts` L17-38，`phone`/`openId` 取自请求体，无 code2session/getPhoneNumber 服务端校验；且漏 `UserStatus.INACTIVE` 检查。修复：改收 `code` 服务端换 openId、服务端解密手机号，补 INACTIVE 拒绝。

## P1（安全评审 round2，registry 分组）

- account：微信登录响应/用户 list 泄露 `twoFactorSecret`/`pendingTwoFactorSecret`/`wechatSessionKey`；send-verification-code 三态响应构成账号枚举 oracle；signup 无限流可邮件轰炸。修复：显式 select、统一响应文案、补限流。
- membership：写接口零授权（自助刷积分/改订阅）+ `req.user.id` 恒 undefined，`/memberships/me` 永远 500。修复：补权限、`req.user.userId`。
- `organization.controller.ts` L28-32：body 直接用 `Prisma.OrganizationCreateInput`，可批量赋值嵌套 memberships/apiKeys。修复：显式 DTO。
- `people-finder` L215-219：任务批 callbackUrl 仅 `@IsString()`，SSRF 内网 POST + 响应体落日志。修复：协议 + 域名白名单。
- `security-evaluation rulebook` L766/L978：IAM action 精确大小写匹配（`iam:passrole` 漏报、wildcard 严重度降档）；`toAccessKey` 缺字段取危险默认（status 缺省=Active、createdAt=epoch）。修复：toLowerCase 归一；缺数据进 skipped 桶。
- `security-evaluation report.service.ts` L114：`latestResultsBySubject` 不按 evaluationKey 分组，覆盖率面板只反映最后跑完的轴（违反 ADR-020 D5.2）。修复：按 (subjectId, evaluationKey) 分组。
- `security-evaluation criteria.seed.ts` L186：`count===0` 才补种，半崩重启后发布 criteria 不全版本。修复：按基线 key 集合补差集。
- `work-evaluation redaction.ts` L18：脱敏正则匹配不到 JSON 形态 `"password": "hunter2"`。修复：放宽正则。
- `aws-identity aws-credentials.controller.ts` L26-33：bootstrap 端点无权限装饰器，绕过 GET 权限返回完整 binding。修复：补 `@RequirePermission`。
- `aws-s3 controller`：listFiles/getFilePath/uploadFile/uploadPart 无权限装饰器；`overwrite` 字符串 `"false"` 为真值。修复：补权限、`overwrite==="true"` 显式比较。
- `tencent-cos`：整 controller 无授权；delete 把 COS key 传给按 DB id 查的 service（永远 500）；文件夹 cosKey 缺尾 `/` 导致递归删除误伤同前缀目录。修复：补权限、按 fileId、统一带 `/`。
- `security/rate-limiter.guard.ts` L29：取裸 socket 地址而非 `req.ip`，反代后全站共享一桶。修复：`req.ip` + trust proxy。
- `copilot kernel`：`agent-runner.ts` L302-306 内部 `error.message` 进 SSE failed 帧；`consume-agent-run.ts` L23-35 `onEvent` 抛错跳过 `handle.fail()`；`conversation-store.ts` 会话/消息/replay 三处无上限；skill pages 过滤只在 prompt 层生效、tools 列表未过滤。
- `shortcut/shortcut-item.controller.ts` L46-49：parentId 悬空/跨项目导致 tree 端点 500。修复：写入校验 parentId 同项目。
- event-scheduling：`event-issue.service.ts` L42 host 存在即 return，冲突检查永不执行；`event-host.service.ts` L100 读未 select 的 profile，永远返回空数组。
- `webhook/webhook.service.ts` L153：存了 secret 从不签名（无 HMAC），SSRF 无防护。
- `audit/http-access.interceptor.ts` L196：无条件信任客户端 XFF 首跳，审计 IP 可伪造。
- `notification-center` L312：list 无归属过滤，任意登录用户可读全部/他项目通知（IDOR）。
- `pdf/pdf.service.ts` L17：utf8 读二进制 PDF，正常文件损坏。
- `map/place.controller.ts` L56：`@Param` 无 ParseIntPipe 三路由全 500；create 用 UncheckedCreateInput（mass-assignment）。

## 技术债（已在 ADR 登记，未落地）

- [ ] ADR-037 契约 3：`JudgmentInput.subject` 收窄为 `Omit<EvaluationSubjectRef, "kind">`。
- [ ] ADR-037 契约 3：注释术语 "the knowledge store is the evidence layer" 改为 "serves as intel's evidence source, not manifest items"。
- [ ] ADR-037 契约 4（threat-intel 补账）：窗口内候选情报投影成 `EvaluationEvidenceItem`（`layer: "knowledge"`）进 manifest，预算未比对条目进 `skipped` 并登记数量；第二处旁路（注入 provider 读 `project` 表构造匹配实体）收敛为经 `input.subject` / `input.evidence` 传入或显式登记外部来源。来源：2026-10-29 评审，已同时登记在 nightwatch-backend ADR-037「影响」节。
- [ ] ADR-039 术语过期：与当前 security-evaluation 实现不匹配，待随下一次契约修订同步。
