# dsh-feishu

[English](README.md) | 中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**飞书 / Lark** 深度接入插件。

它给 agent 八个工具，直接操作真实飞书租户，并附带一个可视化设置页：

| 工具 | 作用 |
|---|---|
| `feishu_bitable` | 新建**多维表格**（一次调用建库 + 建表 + 建字段）；列出表与字段；批量增删改查记录 |
| `feishu_dashboard` | 在多维表格里建**仪表盘和图表**（柱状图／条形图／折线图／饼图／环形图／面积图／组合图／散点图／漏斗图／词云／雷达图／排行榜／指标卡／NPS／文本，共 15 种），可指定位置，并读回图表算好的数据 |
| `feishu_query` | 跑**分组聚合查询**（维度分组 + sum/avg/min/max/count/distinct_count + 筛选 + 排序 + Top N），聚合在服务端完成 |
| `feishu_doc` | 新建文档；把 **Markdown 转成原生块**追加；追加原始块；读纯文本；把本地 md/docx/xlsx/pptx/pdf **导入**成云文档 |
| `feishu_sheet` | 新建电子表格；加 sheet；按 A1 区域读 / 写 / 追加 |
| `feishu_drive` | 浏览目录、建文件夹、上传下载、移动、删除、批量取元数据 |
| `feishu_wiki` | 知识库空间与节点；把 wiki token 解析成真正的文档 token；建节点 |
| `feishu_message` | 发文本 / 卡片 / 富文本 / 文件 / 图片；回复；自定义机器人 webhook |
| `feishu_auth` | 诊断授权、生成授权链接、手工换 code、刷新、登出 |
| `feishu_api` | 任意 open-apis 路径的逃生舱（日历、任务、审批等） |

新内容会落在**用户自己的云空间**，因为工具默认以「已授权用户」身份行事；没有用户授权时会退回应用身份，**并在结果里给出警告**，不会把文档悄悄塞进用户看不见的地方。

---

## 快速开始

### 1. 新建飞书应用

1. 登录 [飞书开放平台](https://open.feishu.cn/app)，创建**企业自建应用**
2. 「凭证与基础信息」→ 复制 **App ID** 与 **App Secret**
3. 「安全设置 → 重定向 URL」→ 添加（端口以设置页显示为准）：

   ```
   http://127.0.0.1:19387/api/feishu/oauth/callback
   ```

4. 「权限管理」→ 开通权限，然后**创建版本并发布**：

   | 权限 | 用途 |
   |---|---|
   | `offline_access` | **必加** —— 没有它拿不到 refresh_token，用户每两小时就要重新授权 |
   | `bitable:app` | 多维表格 |
   | `docx:document` | 文档 |
   | `drive:drive` | 云空间、导入、上传 |
   | `sheets:spreadsheet` | 电子表格 |
   | `wiki:wiki` | 知识库 |
   | `im:message`、`im:resource` | 消息与文件 / 图片发送 |
   | `contact:user.base:readonly` | 读取授权用户昵称 |

   > **最容易踩的坑**：只勾权限不**发版**，接口照样报 `99991672`。

### 2. 启用插件

见下面的[安装](#安装)，然后重启 DeepSeek Harness。

### 3. 在图形界面里配置

打开 **设置 → 飞书 / Feishu**，全部字段都可视化编辑，不需要手写 YAML：

- **应用凭据** —— App ID、App Secret（只写）、凭据引用名、品牌（飞书 / Lark）
- **默认落点与身份** —— 新内容默认落在哪个文件夹、工具默认用哪个身份
- **功能开关** —— 是否注册工具、是否挂载 HTTP 路由、是否显示悬浮面板、工具名前缀
- **授权** —— 申请的 scopes、要登记的重定向 URL
- **高级** —— 端点覆盖与分页上限

**保存只会重写本插件在 `cordis.patch.yml` 里的那一个条目**，宿主会热加载，大部分改动无需重启。App Secret **不会**写进配置文件，而是直接进凭据库，页面只显示"是否已配置"。

### 4. 授权

在设置页点「授权飞书」。**如果新标签没打开，点「复制授权链接」粘贴到浏览器**即可（桌面壳有权拦截 window.open）。授权完成后回到页面点「刷新状态」。

---

## 安装

插件由 Cordis profile loader 加载，必须能从 profile 的 `node_modules` 解析到。**建议用拷贝而不是软链接**：软链接的插件会从真实路径解析裸导入，从而错过 SDK。

```powershell
pwsh -File scripts/install.ps1
```

脚本会把包拷进 profile 的 `node_modules`，并在 `cordis.patch.yml` 里插入条目，同时安装配套 skill。

**必须重启 DeepSeek Harness**（宿主半边是进程内缓存的 Node 模块），之后配置就可以完全在设置页里做了。

### 为什么这个包不 import `@deepseek-ai/*`

第三方插件是从软链接或拷贝目录加载的，在那个位置裸导入 `@deepseek-ai/dsh-tools` 会解析到**另一个** DSH 副本，而不是正在运行的宿主。所以宿主半边只 import Node 内置模块，工具定义与配置校验都是手写的；测试套件用**真实的** SDK 校验器验证每一份 schema，保证不会和注册表契约漂移。

---

## 配置项

除 `appId` 外全部可选，且都可以在设置页里改。

| 字段 | 默认 | 说明 |
|---|---|---|
| `appId` | — | 飞书应用 App ID，必填 |
| `appSecretRef` | `FEISHU_APP_SECRET` | 凭据引用名，先查凭据库再查环境变量 |
| `brand` | `feishu` | `feishu`（open.feishu.cn）或 `lark`（open.larksuite.com） |
| `defaultFolderToken` | `''` | 新建内容的默认落点 |
| `defaultIdentity` | `auto` | `auto` / `user` / `app` |
| `toolPrefix` | `feishu_` | 工具名前缀 |
| `enableTools` / `enableOAuth` / `enableUi` / `registerSystemPrompt` | `true` | 功能开关 |
| `requestTimeoutMs` / `maxRetries` | `30000` / `2` | 超时与尝试次数 |
| `oauthScopes` | 推荐集合 | 授权时申请的 scopes |
| `patchFilePath` | 自动 | 设置页编辑的配置文件；**不允许从浏览器写入** |

环境变量兜底：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BRAND`、`FEISHU_FOLDER_TOKEN`、`FEISHU_USER_ACCESS_TOKEN`。

---

## 两代多维表格接口

插件**刻意同时使用**两代接口：

- **V1**（`/bitable/v1/apps/...`）：建库、表、字段、记录。它是公开文档化的接口，也是官方 Lark/飞书 SDK 里有的那套。
- **V3**（`/base/v3/bases/...`）：只用于 V1 完全没有的两件事 —— **仪表盘图表**和**服务端聚合**。注意资源名是 `bases` 不是 `apps`：两代路径不能互换，问错版本只会得到纯文本的 `404 page not found`，而不是业务错误码。

V3 比已发布的 SDK 还新，所以从 SDK 的类型定义里找不到它；这里的参数结构取自官方 [Lark CLI](https://github.com/larksuite/cli)，并已对着线上接口逐一验证。

| | V1 | V3 |
|---|---|---|
| 字段类型 | 数字（`1`=文本） | 字符串（`"text"`） |
| 记录形态 | 行对象 `{record_id, fields}` | **列式矩阵** `data` + `field_id_list` |
| 批量写 | `{records: [{fields}]}` | `record_id_list` / `by_filter` + `patch` |
| 聚合 | 无 | `POST .../data/query`，DSL 用**表名／字段名** |
| 图表 | 无 | `dashboards` + `dashboards/{id}/blocks` |

一个图表 block 完全由一个 `data_config` 描述，里面用**表名和字段名**、不用 ID：

```json
{
  "table_name": "订单表",
  "series": [{ "field_name": "金额", "rollup": "SUM" }],
  "group_by": [{ "field_name": "类别", "mode": "integrated", "sort": { "type": "value", "order": "desc" } }],
  "filter": { "conjunction": "and", "conditions": [{ "field_name": "状态", "operator": "is", "value": "已完成" }] }
}
```

统计行数用 `count_all: true` 代替 `series`；`text` 类型 block 用 `{"text": "…"}`（支持 Markdown）。聚合问答交给 `feishu_query`，这样"哪个大区卖得最多"是一次调用，而不是把整表翻一遍。

## 工作原理

```
lib/
  index.js        组合根：配置、身份、客户端、工具、路由
  config.js       归一化、品牌端点、默认值
  identity.js     应用凭据、tenant/app token、用户授权、OAuth、刷新
  http.js         单次请求：超时、有限重试、字节上限
  client.js       飞书协议层：信封拆解、鉴权、multipart、分页
  errors.js       失败整形与按错误码给出的修复提示
  local-file.js   按会话工作目录解析路径、上传下载
  activity.js     给面板用的定长内存记录
  entry-config.js 安全读写本插件自己的 loader 条目
  routes.js       /api/feishu/{status,activity,config,oauth/*}
  tools/          八个工具 + schema 校验与结果信封
  ui/client.js    浏览器半边：悬浮面板与设置页
```

**令牌托管**：App Secret 按引用解析、永不外泄；tenant/app token 按需签发、内存缓存、过期前 2 分钟重签、并发单飞；用户令牌是长期授权，以凭据记录 `dsh-feishu/user-token` 持久化（含 refresh_token），临近过期惰性刷新，被飞书拒绝时再自动重试一次。

**两个飞书域名别搞混**：tenant/app token 与业务接口在 `open.feishu.cn/open-apis`，OAuth 在 `accounts.feishu.cn/open-apis`。用错域名会返回纯文本 404。

**失败处理**：飞书业务错误是 HTTP 200 + 非 0 `code`。客户端把两种形态统一成 `FeishuError`，带上错误码、HTTP 状态、路径、`permission_violations` 和修复提示；令牌过期只自动重试一次。

---

## 开发

```bash
npm test          # 等价于 node test/run-tests.mjs
```

测试不需要 harness，用一个假飞书租户驱动真实的 `fetch`。其中两项**必须对着真实 DSH SDK** 校验：每个工具的**参数与输出 schema** 通过 `assertSupportedJsonSchema`；每个参数 schema 能通过 `jsonSchemaToTs` 渲染（保证 PTC 模式可用）。

SDK 不是本包依赖，测试会在常见 profile / 全局位置查找它；找不到就跳过那两项（CI 里就是如此）。可用 `DSH_TOOLS_PATH` 指定。

---

## 安全说明

- App Secret 按引用读取，从不经 HTTP 返回；状态接口只说"是否配置"和来源
- OAuth 路由仅回环地址、同源；回调校验自己签发的 `state`，不匹配直接拒绝
- 令牌不落日志；操作记录只存摘要与链接
- `feishu_api` 是设计上的完整逃生舱，只在信任 agent 使用该应用权限的环境里启用

## 卸载

```powershell
pwsh -File scripts/uninstall.ps1
```

然后重启 DeepSeek Harness。想连用户授权一起清掉，先跑 `feishu_auth` 的 `logout`。

---

## 许可证

[MIT](LICENSE) © 2026 Run Liu

飞书 / Lark 是各自权利人的商标。本项目是独立集成，与官方无隶属或背书关系。
