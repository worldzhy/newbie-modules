# ADR-073: HTTP 接口严格 RESTful——路径与语义方法层的生态契约

状态：已采纳
日期：2026-11-16
归属：框架层（registry 全部模块的路由 + 宿主应用层 + newbie/fewbie starter 模板）
关联：`worldzhy-knowledge/memory/user_profile.md`「HTTP 接口严格 RESTful」；devbie-standards-lint B-20；ADR-071（security-evaluation material 读契约）、ADR-072（security-evaluation subject 写契约）
决策记录：2026-11-16 用户「将严格 RESTFul 风格作为规范」。同一轮拍板三点：(1) 适用范围为跨仓全局；(2) 严格度只到「路径与语义方法」层，不强制 201 + `Location`、204、动作端点资源化；(3) 存量立即全量重构。frontend-monitor 与 task-management 的命名分叉经第二轮确认：单条资源 id 进路径、增删端点用标准资源 + 路径参数、task-management 用查询参数。

## 背景

生态内 HTTP 路由长期混用两套口径：

1. **第三方历史风格**：`frontend-monitor` 整体沿用了外部监控产品的 `getXxx` / `addXxx` / `delXxx` / `customDeleteData` 路径，35 条端点全部 camelCase 且以动词开头。
2. **随手添加的动作路径**：`syncWatch`、`signedUploadUrl`、`signedDownloadUrl`、`getSignedDownloadUrl`、`initMultipartUpload` 等。
3. **方法与语义错位**：`GET /aws-s3/files/sync`、`GET /ec2-instances/fetch`、`GET /auth/refresh-access-token` 都会写库或轮换凭证；`POST /jdy/voucher-list` 承载纯查询；`POST /custom/deleteSystem` 承载删除。

这些端点被 `apits` 生成为前端 `@/api` 客户端，是跨仓 wire 契约。不先定契约就改名，会让「路径规范」变成逐模块即兴发挥，且下一次新增端点继续分叉。

## 候选方案

- **A 维持现状**：各模块按历史风格继续，新端点就近模仿。排除：同一生态内两套命名并存，前端与 SDK 的调用形态无法预测。
- **B 全量 REST**：在路径与方法之外，同时强制创建返回 201 + `Location`、删除返回 204、动作端点资源化（`login` → `POST /sessions`、`upload` → `POST /file-uploads`）。排除：收益主要在协议纯度，但会同时改动响应码、前端成功判定、SDK 上报协议与大量审计断言，风险与收益不匹配。
- **C 只收敛路径与语义方法**：统一路径形态与方法语义，不强制状态码与动作端点资源化。选中。

## 决策

选 **C**。以下五条为强制项，适用于 registry 模块、宿主应用层与 starter 模板。

### D1. 路径形态

- 路径常量段一律 kebab-case 小写；禁止 camelCase、下划线、尾斜杠；方法级路径不带前导 `/`。
- 资源集合用复数（`files`、`custom-filters`、`subjects`）；特性命名空间可用单数（`jdy`、`copilot`、`pvuvip`、`custom`），与 U-02 一致。
- 从属关系用路径嵌套，最多两级；路径参数名 camelCase（`:fileId`、`:projectId`）。
- 过滤、排序、分页、时间范围一律 query 参数。

### D2. 方法语义

| 方法 | 允许的语义 |
| --- | --- |
| GET | 只读，无副作用 |
| POST | 创建资源，或提交非幂等操作（批量删除、LLM 对话、上传分片） |
| PUT | 全量替换 |
| PATCH | 局部更新 |
| DELETE | 删除 |

GET 不得触发写库、缓存刷新、凭证轮换、登出、发送。查询不得由 POST 承载。

### D3. 单条资源 id 进路径

`pages/details?id=` → `GET /pages/:pageId`；`system/getSystemForId?appKey=` → `GET /system/sites/:appKey`。query 只保留过滤与范围条件。

### D4. 增删端点用标准资源

`addCustomFilter` / `delCustomFilter` → `POST|DELETE /custom/filters[/:filterId]`；`addUser` / `deleteUser` → `POST|DELETE /system/users[/:userToken]`；`deleteSystem` → `DELETE /system/sites?type=…`（appKey 仍取自请求上下文）。DELETE 目标进路径，不放在 body。

SDK 上报同样收敛为标准资源：`POST /frontend-monitor/report` → `POST /frontend-monitor/reports`（2026-11-16 第二轮拍板：`frontend-monitor-sdk` 全链路跟随；breaking，需同时更新 SDK 版本、宿主 env/镜像参数、安装凭据展示与审计白名单）。

### D5. 豁免

按协议形态保留，并在代码旁注明来源：

- OAuth / SSO 重定向：`GET /auth/login-by-lark|google`、`.../redirect`。
- 第三方 Webhook / 回调按对方协议形态保留。
- 探针：`/health`、`/ping`。
- 动作端点不强制资源化（本轮）：`initialize-folders`、`repository-check`、`provision-*`、`trigger`、`publish`、`test-push`、`rebind`、`verify`、`rotate-external-id`、`bootstrap`、`get-or-create`、`command`、`upload*`、`create-multipart` 等。
- 带复杂条件体的批量删除：`POST /frontend-monitor/remove/data`（`CustomDeleteFilter` 无法表达为路径或简单 query）。

## 迁移清单

### aws-cloudwatch（ec2 / rds 对称）

| 现状 | 目标 |
| --- | --- |
| `GET /ec2-instances/fetch` | `POST /ec2-instances/sync` |
| `PATCH /ec2-instances/syncWatch` | `PATCH /ec2-instances/watch-statuses` |
| `PATCH /ec2-instances/watch/:ec2InstanceId` | `PATCH /ec2-instances/:ec2InstanceId/watch` |

### aws-s3

| 现状 | 目标 |
| --- | --- |
| `GET /aws-s3/files/sync` | `POST /aws-s3/files/sync` |
| `POST /aws-s3/files/signedUploadUrl` | `POST /aws-s3/files/signed-upload-urls` |
| `GET /aws-s3/files/signedDownloadUrl?fileId=` | `GET /aws-s3/files/:fileId/signed-download-url` |

### tencent-cos

| 现状 | 目标 |
| --- | --- |
| `POST /tencent-cos/getSignedDownloadUrl` | `GET /tencent-cos/signed-download-urls?key=` |
| `POST /tencent-cos/delete` | `DELETE /tencent-cos/files/:fileId` |
| `POST /tencent-cos/initMultipartUpload` | `POST /tencent-cos/create-multipart` |
| `POST /tencent-cos/uploadPart` | `POST /tencent-cos/upload-part` |
| `POST /tencent-cos/completeMultipartUpload` | `POST /tencent-cos/complete-multipart` |

### account

| 现状 | 目标 |
| --- | --- |
| `GET /auth/refresh-access-token` | `POST /auth/refresh-access-token` |

### frontend-monitor

| 现状 | 目标 |
| --- | --- |
| `GET /pvuvip/getPvUvIpSurveyToday` | `GET /pvuvip/surveys/today` |
| `GET /pvuvip/getPvUvIpSurveyOne` | `GET /pvuvip/surveys` |
| `GET /pvuvip/getHistoryPvUvIplist` | `GET /pvuvip/history` |
| `GET /pvuvip/getPvUvIpList` | `GET /pvuvip/series` |
| `GET /pvuvip/getPvUvIpOne` | `GET /pvuvip/points` |
| `GET /pages/getAveragePageList` | `GET /pages/averages` |
| `GET /pages/getRealTimeAveragePageList` | `GET /pages/realtime-averages` |
| `GET /pages/getOnePageList` | `GET /pages/visits` |
| `GET /pages/getPageDetails?id=` | `GET /pages/:pageId` |
| `GET /error/getAverageErrorList` | `GET /error/averages` |
| `GET /error/getOneErrorList` | `GET /error/ones` |
| `GET /error/getMarkUserErrorList` | `GET /error/mark-users` |
| `GET /ajax/getPageAjaxsAvg` | `GET /ajax/page-averages` |
| `GET /ajax/getAverageAjaxList` | `GET /ajax/averages` |
| `GET /ajax/getOneAjaxList` | `GET /ajax/ones` |
| `GET /ajax/getMarkUserAjaxList` | `GET /ajax/mark-users` |
| `GET /resource/getResourceForType` | `GET /resource/types` |
| `GET /resource/getAverageResourceList` | `GET /resource/averages` |
| `GET /resource/getOneResourceAvg` | `GET /resource/average` |
| `GET /resource/getOneResourceList` | `GET /resource/ones` |
| `GET /resource/getOneResourceDetail?id=` | `GET /resource/:resourceId` |
| `GET /analysis/getAnalysislist` | `GET /analysis/users` |
| `GET /analysis/getAnalysisOneList` | `GET /analysis/tracks` |
| `GET /analysis/getTopDatas` | `GET /analysis/top-data` |
| `GET /analysis/getProvinceCount` | `GET /analysis/province-counts` |
| `GET /environment/getDataGroupBy` | `GET /environment/groups` |
| `GET /environment/getEnvironmentForPage?markPage=` | `GET /environment/pages/:markPage` |
| `GET /custom/getCustomFilterList` | `GET /custom/filters` |
| `POST /custom/addCustomFilter` | `POST /custom/filters` |
| `POST /custom/delCustomFilter` | `DELETE /custom/filters/:filterId` |
| `GET /custom/getAverageCustomList` | `GET /custom/averages` |
| `POST /system/update` | `PATCH /system/sites` |
| `GET /system/getSysForUserId` | `GET /system/sites` |
| `GET /system/getSystemForId?appKey=` | `GET /system/sites/:appKey` |
| `GET /system/list` | `GET /system/web-sites` |
| `POST /system/addUser` | `POST /system/users` |
| `POST /system/deleteUser` | `DELETE /system/users/:userToken` |
| `POST /system/deleteSystem` | `DELETE /system/sites?type=…` |
| `POST /remove/customDeleteData` | `POST /remove/data` |
| `POST /frontend-monitor/report` | `POST /frontend-monitor/reports` |

所有目标路径前缀均为 `/frontend-monitor`。

### task-management

| 现状 | 目标 |
| --- | --- |
| `GET /task-spaces/by-project/:projectId` | `GET /task-spaces/project?projectId=…` |
| `GET /task-spaces/by-project/:projectId/tasks` | `GET /task-spaces/tasks?projectId=…` |
| `POST /task-spaces/by-project/:projectId/tasks` | `POST /task-spaces/tasks?projectId=…` |
| `GET /task-spaces/by-project/:projectId/members` | `GET /task-spaces/members?projectId=…` |

### 宿主应用层（nightwatch-backend）

| 现状 | 目标 |
| --- | --- |
| `POST /jdy/voucher-list` | `GET /jdy/vouchers?fromPeriod=&toPeriod=&sId=&dbId=` |

宿主其余端点（`copilot/chat`、`analysis/chat`、`initialize-*`、`provision-*`、`repository-check`、`security-*`）按 D5 豁免或已合规。

## 跨宿主 / 演进检验

| 维度 | registry 模块 | 宿主应用层 | 新宿主接入 |
| --- | --- | --- | --- |
| 路由所有权 | 模块自带 controller，路径随模块发布 | 宿主自有 controller 遵守同一契约 | 用 registry 即继承合规路径 |
| 前端消费 | apits 从 Swagger 生成，改路由即改生成函数 | 同左 | 无额外适配 |
| 豁免点 | OAuth 由模块内注释标注来源 | 无 | 同左 |
| 版本风险 | 改路由是 breaking wire change，靠 `newbie modules update` + apits 同步 | 同仓前后端同时改 | 无存量调用方 |

不引入宿主实体：`task-spaces?projectId=` 只把宿主 `projectId` 当过滤值，不把 Project 变成模块的父资源；换宿主只需换参数来源。

## 影响

- **registry**：上述 6 个模块的 controller/DTO 与方法装饰器同步调整；改的是路由与方法，业务服务签名不变。
- **宿主**：`npx newbie modules update <key>` 同步装配产物；`jdy` 的 `VoucherListRequestDto` 改为 query DTO；`npm run apits` 重生成 `src/api/_gen`，前端调用点切到 `@/api`。
- **前端**：`frontend-monitor` 与 `file` 相关按钮的调用函数名随生成代码变化；`refresh-access-token` 由页面加载时的 GET 改为 POST（拦截器/请求封装同步）。
- **SDK**：`@devbie/frontend-monitor-sdk` 的自滤清单与文档切到 `/frontend-monitor/reports`，发布 minor；已部署应用需更新 `api` 配置（旧路径 404）。
- **验证**：registry 侧 tsc + eslint + 既有测试；宿主侧干净重启后对改动端点做冒烟；认证链路（refresh-access-token）补行为级测试。
- **非目标**：不改响应信封 `{ code, error, data }`、不改状态码约定、不做动作端点资源化、不重命名业务 DTO 字段。

## 更新记录

- 2026-11-24 — 补齐 D1/D4 的存量遗漏：`POST /module-hub/report` → `POST /module-hub/reports`。module-hub 是 ADR-073 迁移清单之外的 registry 模块，其上报端点仍是单数，与 D1「资源集合用复数」及 D4 对 `/frontend-monitor/reports` 的处理同形。本次只改路径，请求/响应 DTO 与 `kind=full|ping` 语义不变。breaking wire change：registry 侧 controller + README + audit 白名单、宿主 `REPORT_PATHS.moduleHub` 与 apits 生成代码、`@devbie/newbie` reporter 文档、`@devbie/module-hub-cli` 的 `REPORT_SUFFIX` 同步；已部署实例必须同步更新 `MODULE_HUB_ENDPOINT`，旧路径 404。security-evaluation 的 `GET /security-evaluation/report` 是单例聚合读模型，保持单数。
