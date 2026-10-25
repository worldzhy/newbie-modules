# ADR-019: installation 凭证原语收敛——签发/轮换/吊销与校验算法归 security

状态：已采纳
日期：2026-10-25
归属注记：本决策治理 newbie-modules 模块代码，单一源存放于本仓。它**延伸** ADR-009 的边界：ADR-009 只决定了"认证策略归 security、installation 表归 collector、resolver 由 collector 实现"，未决定"签发/存储/吊销/校验算法是否也必须各自复制"。

## 背景

ADR-009 落地时是 5 个 collector（heartbeat / health / backend-monitor / module-hub / web-monitor）。此后 people-evaluation 作为第六个 collector 复制了同一套凭证实现，复制路径的代价已从"风格问题"变成实证的安全语义分叉：

1. **吊销语义分叉**：backend-monitor 与 web-monitor 的 resolver 有 60s 正向缓存，注释写"吊销后最长 60s 仍被接受，此处可接受"；people-evaluation 明确写相反口径——"不缓存正值，吊销与轮换必须在下一个请求生效"。同一个"吊销即拒"契约在六个 collector 上并不等价，且由各模块作者自行拍板。
2. **审计覆盖分叉**：只有 module-hub 对 enroll/rotate/revoke 写审计；其余五个签发长效凭证的路径完全没有审计记录。第六个 collector 出现时又漏一次。
3. **校验骨架重复**：backend-monitor 与 web-monitor 的 resolver 近乎逐字相同（UUID 正则、正/负缓存常量、缓存上限、touch 节流、负缓存淘汰），people-evaluation 只保留负缓存。改一处漏一处即口径分裂。
4. **无契约测试**：`security/authentication/installation/` 与各 collector 的 installation 服务均无测试，上述漂移无法被自动发现。

这些副本漂移的不是业务差异，而是机制差异。真实业务差异只有四类：域投影字段（applicationId / appKey / evaluateeUserId）、在线阈值、legacy header 名、web-monitor 的 body token 例外——它们恰好都应该留在 collector。

## 候选方案

- **A. 只共享 token 哈希函数**：收敛六行 `sha256`。治症状：吊销口径、审计覆盖、校验骨架的漂移仍在。
- **B. 收敛凭证原语 + 生命周期 + 校验算法到 security，存储与域投影留在 collector（选定）**。
- **C. installation 表物理合并**：公共列 + kind。与 ADR-009 候选 D 同因否决——域列差异真实（lastSnapshot* / targetSpec / appKey / evaluateeUserId），合并只能选宽表或 JSONB 扩展，伤类型安全。
- **D. 维持现状（复制即扩展路径）**：第七个 collector 仍要人肉复刻审计、吊销口径与缓存骨架，与"不可复用、不可验证、不可追溯"零容忍冲突。

## 决策

1. **security 新增 `installation/` 目录，导出的全部是纯机制，不新增 Nest provider、不改任何模块依赖**：
   - `installation-credential.ts`：token 格式常量（UUID）、`generateInstallationToken()`、`hashInstallationToken()`、`InstallationCredentialStore` 端口（create / findByTokenHash / updateTokenHash / setRevokedAt）、`issueInstallationCredential` / `rotateInstallationCredential` / `revokeInstallationCredential` / `restoreInstallationCredential`。
   - `installation-token.verifier.ts`：校验算法（格式校验 → 哈希 → 存储查询 → 吊销判定），只提供有上限的负缓存，**不提供正向缓存**。
   - `installation-credential.audit.ts`：审计事件常量（`installation.enroll` / `.rotate` / `.revoke` / `.restore`）与 `InstallationAuditRecorder` 类型。
2. **吊销口径统一为"下一请求生效"**：撤销 backend-monitor / web-monitor 的 60s 正向缓存。理由是恢复 ADR-009 的"吊销即拒"契约；正向缓存若无跨实例失效通道，在多实例部署下会产生假吊销窗口。未来若确有吞吐需要，引入正向缓存必须同时提供失效通道（opt-in），不得默认开启。
3. **审计不可省略**：生命周期函数的 recorder 是**必填参数**，由各 collector 注入 `AuditLogService` 实现（audit → security 的依赖方向不变，不成环）。六个 collector 的 `newbie.module.json` 均声明 `audit` 依赖。漏接审计在编译期即失败，不依赖人肉记忆。
4. **表结构不变**：`tokenHash String @unique @db.VarChar(64)` + `revokedAt` 软吊销，明文只返回一次。
5. **collector 退化为三件事**：域字段、四个方法的 store 适配、域投影（resolver 返回值与在线态派生）。
6. **契约测试**：security 单测覆盖签发/轮换/吊销/恢复/校验/负缓存上限；另加静态扫描测试，断言 installation 相关文件不得自行生成 token（`randomUUID` 仅允许出现在 security 的凭证原语内）。

## 跨宿主 / 演进检验

- token 格式、哈希、吊销判定与"项目/应用"等宿主概念无关；`kind` 仍是 collector 模块自身的 key。
- 存储仍留在各 collector，独立装配不变；collector 只新增对 `audit` 的显式声明，account 与 module-hub 已建立该先例，不产生模块间新耦合。
- 不触碰 wire 契约：Bearer 唯一标准、legacy header 过渡期、web-monitor body token 例外均按 ADR-009 执行，SDK 无需改动。
- 新增第 N 个 collector 的成本从"重新做一遍安全决策"降为"实现四个方法的 store + 域投影"，审计缺失与吊销口径分叉在类型层被堵住。

## 影响

**更容易**：吊销、审计、缓存语义只有一处实现；新增 collector 不需要再决定这三件事；漂移由单测与静态扫描守护。

**更难 / 显式后果**：

- web-monitor 与 backend-monitor 从"每 token 60s 一次查询"变为"每请求一次索引查询"（负缓存继续吸收垃圾流量）。这是用吞吐换正确性；若生产数据证明不足，按决策 2 以 opt-in + 失效通道补回，而不是恢复静默延迟。
- 一次性改动面跨 registry 六模块（heartbeat / health / module-hub / backend-monitor / web-monitor / people-evaluation）+ security，并按 registry-first 流程同步到消费仓 nightwatch-backend。

**范围外（本次不做）**：`InstallationPresence`（enrolled / online / lastSeenAt / revokedOnly）在四个模块重复派生，语义一致、仅阈值不同；可在后续里程碑以"带阈值参数的共享派生函数"收敛，不属于凭证原语。

## 勘误（2026-10-25，评审后补记，正文不改）

- **术语**：决策 4 所列 store 端口方法 `updateTokenHash` 在实际实现中命名为 `replaceTokenHash`；两者指同一方法，后续引用以代码为准。
- **负缓存的边界被显式确认**：只缓存"格式合法但库中不存在"的 token；格式非法者不查库也不入缓存，否则垃圾流量会按上限淘汰掉真正需要吸收的条目（实现与 `installation-token.verifier.test.ts` 已固化该行为）。
- **并发窗口（接受）**：collector 先读取再写入，两步之间行被删除时 Prisma 抛 P2025 并表现为 500 而非 404。installation 行全生命周期只做软吊销、代码中不存在硬删除路径，故该窗口在实践中不可达；如将来引入硬删除或级联删除，需在 store 适配层把 P2025 映射为 NotFound。
