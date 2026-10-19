# ADR-006: TOTP 两步验证升级为账号级门禁，覆盖全部登录渠道

状态：已采纳（用户拍板方案 A，2026-10-13）
日期：2026-10-13
归属注记：本决策治理 newbie-modules 模块代码，单一源存放于本仓（nightwatch-backend 侧编号 ADR-007，该处现为同编号重定向存根）。2026-10-19 起按单一源规则执行。

## 背景

用户在安全设置开启 TOTP 后，Google/Lark OAuth 登录完全绕过两步验证。取证结论：`isTotpEnabled` 只在密码登录控制器被调用；更严重的是 Lark/WeChat 登录不经过共享 `authService.login()`，而是各自直接 `sessionService.generate()` 铸造会话（有意绕过邮箱验证/位置门）。同时 Lark 的 email merge 与 Google 的 email 解析意味着"控制邮箱"即可绕过 TOTP——而防邮箱被控正是 TOTP 的核心威胁模型。若只把检查搬进 `login()`，Lark/WeChat 两条直连铸造路径仍然漏网。

## 候选方案

1. **什么都不做**：TOTP 仅为密码渠道因子。被否——TOTP 的安全承诺（账号级第二因子）与实现不符，且邮箱被控场景反而成为绕过通道。
2. **仅"知识因子"渠道强制（密码/验证码），OAuth 视为 provider 已强认证而豁免**：业界有"联邦登录算 MFA"立场，但与用户在平台内开启 TOTP 的心智预期冲突，且堵不住 Lark email merge 绕过路径。
3. **共享 TOTP 门禁 + 契约测试强制（选定）**：`TwoFactorService.evaluateLoginMfaGate()` 作为唯一门禁实现；`authService.login()` 内部调用（覆盖密码/验证码/Google/approve-subnet），Lark/WeChat 两条直连铸造路径在 `sessionService.generate()` 前显式调用同一门禁；`login-audit-coverage` 契约测试新增静态检查——凡直接铸造会话的登录文件必须引用该门禁，否则测试失败。

## 决策

方案 3。决定性理由：TOTP 是**账号级属性**而非渠道属性，会话铸造是登录的唯一收敛点，门禁必须覆盖"所有能到达会话铸造的路径"；在会话铸造路径分散于三个文件的现状下，唯一能同时保证"共享实现"与"不可遗漏"的机制是把门禁调用写成显式代码 + 用契约测试机械拦截新渠道绕过（延续"跨渠道一致行为要有共享实现"与"审计覆盖用契约测试强制"两条既有治理规则）。

语义细节：

- 门禁位置统一在**资格检查之后、会话铸造之前**；Lark/WeChat 虽豁免邮箱/位置门，但不豁免账号级 TOTP 门。
- MFA challenge 不是登录失败，不记 `recordLoginFailure`（与既有密码渠道行为一致）；TOTP 验证码错误仍走 `consumeMfaChallenge` 的既有审计。
- 命中门禁时不重置登录限流、不销毁既有会话（WeChat 的 `session.deleteMany` 移到门禁之后），登录在 TOTP 完成前视为未完成。
- `/auth/login-by-totp` 以 `mfaVerified: true` 显式声明已验第二因子，是唯一合法的跳过方式。
- JSON 渠道（密码/验证码/WeChat/approve-subnet）复用既有 `{ totpToken, type: TOTP, multiFactorRequired: true }` 响应形状；OAuth 渠道（Google/Lark）302 到前端 `/account/login/totp-callback#totpToken=...`（hash 传递，与既有 token 同机制）。

## 跨宿主 / 演进检验（registry 模块设计必填）

- 门禁实现位于 account 模块内（TwoFactorService），不依赖任何宿主概念；换宿主装配后语义不变。
- 响应契约是纯 account 模块契约（`multiFactorRequired` 早已存在），未泄漏 Google/飞书/微信具体概念。
- 新增登录渠道时的失效模式：新渠道直连 `sessionService.generate()` 而不调门禁 → 契约测试直接失败（文件级静态断言），不需要人工记忆。未来若新增第二 MFA 方式（如短信），`evaluateLoginMfaGate` 是唯一需要扩展的点。
- WeChat 小程序客户端当前无法完成 TOTP challenge：TOTP 用户在小程序实现 challenge 前无法经 WeChat 登录（fail closed，属账号级安全的正确姿态）；客户端跟进项记录于此。

## 影响

- 已开启 TOTP 的用户在合入后下一次任意渠道登录即被要求动态码（行为收紧，无灰度，用户已拍板）。
- `LoginByPasswordResponseDto` 的 `token`/`tokenExpiresInSeconds` 从"必填"修正为可选（诚实化双分支联合），前端 `_gen/api.ts` 随 apits 重生成。
- 前端新增 `/account/login/totp-callback` 页与共享 TOTP 挑战表单；登录页验证码渠道接入 MFA 分支。
- Google/Lark OAuth 的真实 IdP 握手无法本地 E2E，重定向分支以契约测试 + totp-callback 页面端到端 + 代码评审兜底。
