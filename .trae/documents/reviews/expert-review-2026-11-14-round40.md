# Expert Review — round40（2026-11-14，scope=`plan`）

被审方案：对话内提出的两项修复设计——R39-01「`alertKey` 显式配对」与 R39-02「通知运维权限组拆分」。评审目标：方案与 ADR-062 / ADR-063 是否矛盾。

## 1. 锚点

| 仓 | branch | HEAD | 工作树 | 说明 |
| --- | --- | --- | --- | --- |
| newbie-modules（ADR 所在，模块真源） | dev | `60b2a20` | dirty 9 | 本会话 round39 修复 + 报告/台账产物，全部在 notification-center 与 `.trae/documents` |
| nightwatch-backend（宿主 seed / 装配面） | dev | `8d67da2` | dirty 7 | 同上，seed 未改 |
| nightwatch-frontend（展示面） | dev | `e6b92eb` | dirty 14 | 含并行 3D 会话的提交与在途改动，与本模块无路径交集 |

时间：2026-11-14 00:24 CST（开始）。

**偏差披露（§10 教训 7）**：本方案由主会话在同一次会话中提出并自评，且工作树含本会话的修复改动。结论按 `static`（读码 / 文档）等级给出；未执行运行时探针（方案尚未实现）。本报告无 P0/P1，未触发独立代理反驳轮。

## 2. 范围与方法

- scope：`plan`；审查范围 = 主张清单 ∪ 其依赖路径。未扩审其他模块与宿主业务代码。
- 依赖路径（全部已读全文或定位）：`ADR-062`、`ADR-063`、`nightwatch-backend/.trae/documents/decisions/ADR-043-builtin-roles-admin-member.md`、`prisma/seeds/permission-groups.ts`、`packages/modules/notification-center/prisma/schema.prisma`、`packages/modules/notification-center/notification-center.service.ts`、前端 `components/require-permission.tsx` / `lib/route-access.ts` / `hooks/use-can-see.ts`。
- 方法：主张逐条对照 ADR 原文与实现；对「无需改动」类主张核对现有设施是否存在（grep）；未做代码修改。

主张清单与映射：

| ID | 主张 | 依赖 |
| --- | --- | --- |
| C1 | `notify()` 新增可选 `alertKey`；缺省回落 `deduplicationKey` → `notificationKey` | `notification-center.service.ts:81`、`schema.prisma:167-169` |
| C2 | `upsertAlert` 改按 `fingerprint` `findFirst` 后按 id 更新，保留各自 `notificationKey` 渲染恢复模板 | `notification-center.service.ts:414-422`、`schema.prisma:189` |
| C3 | 两个双 key 调用方显式传 `alertKey`，firing/recovered 复用同一 Alert 行与冻结裁决 | `ADR-062:86`、`ADR-062:135` |
| C4 | 不需要 schema 变更 / migration | `schema.prisma:164-192` |
| C5 | 现有单 key 调用方零改动 | `notification-center.service.ts:81-95` |
| C6 | seed 新增 `Notification Operations` 组，`Notifications` 组用 `excludeResources` 排除三张控制面表，MEMBER 绑定排除新组 | `permission-groups.ts:33`、`:211-215`、`:313`、`:429-431` |
| C7 | 权限覆盖率门禁保持绿 | `permission-groups.ts:340-350`、`ADR-043:57-63` |
| C8 | 前端三张运维卡按原子权限隐藏（原表述：需补 `useHasPermission`） | `components/require-permission.tsx:23-36`、`lib/route-access.ts:17-19` |
| C9 | `NotificationSetting` 留在 `Notifications` 组，成员可读可调 | `permission-groups.ts:211-215` |
| C10 | 以单份 ADR-064 记录两项决策 | `ADR-062` 路径、`ADR-043:7` |

## 3. 主张判定表

| ID | 判定 | 依据 |
| --- | --- | --- |
| C1 | **成立**（细化，非矛盾） | ADR-062 未规定 `fingerprint` 的取值来源；新增 `alertKey` 只是把「配对键从哪来」变成显式入参。缺省回落保持既有行为。 |
| C2 | **不成立**（与 ADR-062 文本矛盾） | ADR-062:86 声明「firing 与 recovered 同进同退**由数据模型保证**」。改为 `findFirst` 后，保证来自「查找约定」，而 `@@unique([notificationKey, fingerprint])`（`schema.prisma:189`）在跨 key 配对时不再生效（不同 notificationKey 本就允许同 fingerprint 两行）。并发下同一生命周期可能产生两行 Alert。ADR-062 该句与 `术语退场` 表 `:168` 必须由新 ADR 改写，否则实现与决策文本冲突。 |
| C3 | **成立** | 与 ADR-062:86 的目标（恢复复用裁决）和 `:135` 的「对所有消费方一致」同一方向；本轮修复的是实现未达成决策目标，不是改目标。 |
| C4 | **成立** | 不改列、不加表。语义债见 C2：唯一键的配对职责退化为防重。 |
| C5 | **成立**（static） | 回落链 `alertKey ?? deduplicationKey ?? notificationKey` 与现实现 `deduplicationKey ?? notificationKey`（`service.ts:81-95`、`:260`）同构；单 key 调用方无需改。 |
| C6 | **成立**（机制支持），但**与 ADR-043 矛盾** | `deriveGroupAtoms` 支持 `excludeResources` / `extraResources`（`permission-groups.ts:33`、`:294-320`）。但 ADR-043:19 / `:42` 明文「MEMBER 绑定除 `All` / `IAM` / `JDY`（+Overview）外的全部内建组」，新增排除项直接违反该条，须由宿主新 ADR 部分取代 ADR-043。 |
| C7 | **成立**（static） | `deriveNonAllPermissionSupply()` 仅跳过 `allResources`（`permission-groups.ts:340-350`），命名新组即计入供给，门禁仍绿。**反向风险**：ADR-043:53 已言明门禁「只校验路由原子 ⊆ 全组供给，不校验 MEMBER 可达性」，因此门禁不会阻止该组将来被静默加回 MEMBER——ADR 应写明这是有意的 ADMIN-only 例外。 |
| C8 | **不成立**（方案需更正） | 前端无 `useHasPermission`（grep `useHasPermission|hasPermission|usePermission` 在 `src` 下无匹配），但**也不需要新增**：`hasRouteAccess` 按 `routePath` **精确匹配**（`lib/route-access.ts:17-19`），新组声明 `routePath: "/notifications/operations"` 后直接用 `useCanSee("/notifications/operations")`（`hooks/use-can-see.ts:13-15`）即可。原方案「补一个原子权限 hook」是多余抽象。 |
| C9 | **成立** | `NotificationSetting` 未被加入 `excludeResources`，仍随 `module/notification-center` 命名空间进入 `Notifications` 组（`permission-groups.ts:211-215`）。 |
| C10 | **不成立**（治理矛盾） | `alertKey` 属 registry 模块契约，权限组绑定属宿主产品决策（ADR-043:7「role 体系不进入 registry」）。单份 ADR-064 无法同时落在两仓 → 应为 **newbie-modules ADR-064**（配对契约，部分修订 ADR-062 §4/术语表）+ **nightwatch-backend ADR-044**（权限拆分，部分取代 ADR-043 绑定规则；backend 现有最大编号 043）。 |

## 4. 方案外新发现

| ID | 仓 | 发现 | severity |
| --- | --- | --- | --- |
| R40-01 | newbie-modules | `schema.prisma:167-169` 注释仍写「fingerprint … Defaults to the notification key when the caller supplies no deduplication key」，与 R39-03 已落地的 `${projectId ?? "-"}:${deduplicationKey ?? notificationKey}`（`service.ts:81`）漂移；方案 A 后还会再漂移一次 | P2（文档一致性） |
| R40-02 | newbie-modules | ADR-063:90 写「新增静默 CRUD」，而本轮 R39-04 已把「被引用静默」的 Delete 改为 409；方向与 ADR-063:55（`silenceId` 用于反查）一致，但字面需增补一句 | P2 |
| R40-03 | nightwatch-backend | R39-02 落地后，MEMBER 将失去 `NotificationDeliveryRule` / `NotificationSilence` / `NotificationCenterSetting` 的**读**权限；设置页三张卡必须同批隐藏，否则成员看到 403 空卡（前端回归面） | P2（方案完整性） |

## 5. 误报剔除

| 候选 | 处置 |
| --- | --- |
| 「方案 A 重新引入 `recoveryOf`」 | **推翻**：`recoveryOf` 是指向 firing key 的方言字段（ADR-062:143、`:168` 删除）；`alertKey` 是告警生命周期键，恢复仍沿用同一 fingerprint 复用裁决，语义不同。 |
| 「R39-02 违背 ADR-063『静默按 matcher 全局生效』」 | **推翻**：ADR-063 只定义静默的求值语义，未规定 CRUD 的授权主体；拆分权限不改变匹配作用域。 |

## 6. 已核验通过的不变量

1. ADR-063 的静默语义（无 `isActive`、时间窗生效、`silenceId` 可反查、实时段顺序）与 R39-04 的「已引用不可删」方向一致（`ADR-063:36`、`:54-56`、`:90`）。
2. ADR-062 的目标（恢复跟随裁决、可解释投递）未被方案改动；方案只改配对键的来源。
3. 覆盖门禁的现有语义确为「路由原子 ⊆ 非 All 命名组供给」（`permission-groups.ts:340-350`），新命名组不会让门禁变红。

## 7. 覆盖率清单

- 审：ADR-062 全文、ADR-063 全文、ADR-043 全文、seed 相关行、模块 schema 160-200、模块 service 告警段、前端权限门三件套。
- 未审：方案尚未实现，无运行时行为；其他模块；migrations；宿主前端设置页其余卡片。

## 8. 结论与优先级

1. **必须先写两份 ADR**，否则两处「决策文本 vs 实现」冲突成立：ADR-062:86 的「数据模型保证」、ADR-043:19/42 的 MEMBER 绑定集合。
2. schema 注释（R40-01）随契约改动同批更新。
3. 前端门禁改用 `useCanSee("/notifications/operations")`，不新增 hook（更正 C8）。
4. 与 ADR-063 无矛盾；仅建议增补删除语义一句（R40-02）。

## 9. 台账指针

本报告新增 R40-01 / R40-02 已写入 `newbie-modules/.trae/documents/findings.md` 的 round40 段；R40-03 与 ADR-043 修订属宿主侧，记入 `nightwatch-backend/.trae/documents/findings.md` round40 段。
