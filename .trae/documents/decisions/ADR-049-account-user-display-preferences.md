# ADR-049: account 模块承载通用用户显示偏好（language / theme / timezone）

状态：已采纳
日期：2026-11-06
归属：框架层（newbie-modules registry：`packages/modules/account/prisma/schema.prisma`、`account.dto.ts`、`account.controller.ts`）
关联：nightwatch-frontend ADR-003（宿主侧设置信息架构与消费行为）、nightwatch-frontend ADR-002（i18n 选型与 en/zh 平权）

## 背景

nightwatch 决定把界面语言、明暗主题、时区三项个人偏好升为账号级设置（见 frontend ADR-003）。框架层现状：

- `User` 已有 `timezone`（`String @default("America/Los_Angeles")`），但 `GET /account/me` 不返回它，前端无法回填；
- 没有任何语言 / 主题字段；
- `User` 已经是"用户画像 + 会话身份"的聚合（`firstName`、`gender`、`dateOfBirth` 与认证字段同表）。

需要先定框架侧的承载位置，因为这份契约会被所有 newbie 宿主复用；若放在宿主自有表，每个宿主都要重写偏好读写、鉴权与 DTO。

## 候选方案

### A. 宿主各自建表

每个宿主在 `src/application` 下自建 `UserPreference`。registry 零改动，但偏好读写、鉴权、DTO 在每个宿主重复一遍；`User.timezone` 成为无人读取的孤儿字段，必须一并删除——而删除本身仍是 registry 改动。净效果是把"加两列"变成"删一列 + 每个宿主加一张表"。

### B. 扩展 `User`（选定）

新增 `language`、`theme`，`timezone` 沿用；`GET /account/me` 回显、`PATCH /account/me` 写入。

### C. registry 内独立 `UserPreference` 模型

一张 `userId` 唯一的表承载偏好。可扩展性好，但每新增一个偏好就要改表结构，且把用户画像与用户身份拆成两个聚合，读当前用户需要额外 join。

## 决策

采纳 B。具体契约：

1. `User.language String?`：BCP-47 语言标记（nightwatch 用 `en` / `zh`）。**可空、无默认**——框架不替产品决定初始语言；未设置由宿主回落（nightwatch 回落到 `en`，与其 `defaultLocale` 一致）。
2. `User.theme UserTheme?`：枚举 `LIGHT | DARK | SYSTEM`。**可空、无默认**，未设置由宿主回落（nightwatch 用 `SYSTEM`）。枚举值不含任何宿主 UI 词汇（无品牌色、无布局名）。
3. `User.timezone` 由 `String @default("America/Los_Angeles")` 改为可空无默认。理由：`America/Los_Angeles` 是一次宿主遗留的默认值，框架层烘焙具体地区没有通用性论据；未设置时由宿主决定（nightwatch 用浏览器时区）。
4. `GetCurrentUserResponseDto` 增加 `language`、`theme`、`timezone`；`UpdateMeDto` 白名单增加 `language`、`theme`（`timezone` 已在白名单内）。校验只做形状：`language` 的长度与字符集、`theme` 的枚举成员；**语言成员校验留给宿主**（registry 不知道宿主支持哪些语言），未支持的值由宿主 i18n 层回落并在设置页提示。
5. 三项只允许本人修改（沿用 `/account/me` 的 `@RequireOwner()`）；管理员端 `PATCH /users/:id` 不新增这三项——偏好是本人的，不是管理员代设的配置。

决定性理由：语言与主题都是**通用词汇**，不含宿主业务概念；而该模块的边界本来就是"用户画像 + 会话身份"，把偏好并进去换来单存储、单接口、单鉴权，且不需要每个宿主重写一遍。这是模块准入准则（vendor- or domain-generic）允许的，也是复用取向成立的。

### 为什么 timezone 的默认值要改

若保留 `@default("America/Los_Angeles")`，同一份契约里会同时存在"两个可空偏好"和"一个被框架替用户选好的地区"，语义不一致。nightwatch 未上线且该字段无消费方，正是把它改成"未设置即未设置"的窗口；本改动随 ADR 一起装配，不产生迁移负担。

## 跨宿主 / 演进检验

| 维度 | 框架层（本 ADR） | 宿主层（nightwatch） |
|---|---|---|
| 字段 | `language`（BCP-47 标记）、`theme`（`LIGHT/DARK/SYSTEM`）、`timezone`（IANA 名称） | 不新增表 |
| 读写接口 | `/account/me` GET / PATCH，本人可用 | 设置页调用同一接口，不自建偏好端点 |
| 默认值 | 一律可空，由宿主回落 | 语言 `en`、主题 `SYSTEM`、时区浏览器时区 |
| 语言成员校验 | 只校验形状 | i18n 层校验是否在 `routing.locales`，未支持则回落 |
| 可移植性 | 任意宿主可装配；不需要偏好的宿主留 null 即可 | 当前只有 nightwatch；fewbie 前端骨架已有 i18n 与 `.dark` 变量，未来接入后端即可复用 |

未泄漏宿主概念：无项目、无应用、无 nightwatch 品牌词汇。风险点：`theme` 是 UI 概念，但语义固定为"明 / 暗 / 跟随系统"，换任何 Web 宿主仍成立。

## 影响

- registry 改动：schema 两列新增 + 一列去默认，DTO 回显与白名单，生成后的 client 类型。
- 装配顺序：`newbie modules apply` → `prisma db push`（未上线，直接对齐库）→ nightwatch-backend `npm run apits`。
- 顺序约束：registry 先落地，宿主再消费；宿主侧的结构与交互见 nightwatch-frontend ADR-003。
- 未覆盖：偏好修改不记审计（非安全敏感路径）；若未来语言要影响服务端生成内容（通知、周报本地化），另开 ADR。
