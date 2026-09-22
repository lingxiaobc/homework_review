# 学生作业批改系统 V1.0.1

上传高中物理作业图片，AI 自动完成「物理相关性审核与批改建议 → 按建议生图标注」，
并在前端实时展示批次进度、结果图与失败重试。

技术栈：Express + SQLite（better-sqlite3）+ 原生 HTML/CSS/JS 前端（无框架）。
外部平台：[ZenMux](https://zenmux.ai)（OpenAI 兼容聚合网关），协议细节见 `docs/zenmux-protocol-notes.md`。

## 安装

本版在 Node.js 22 验证。现有 better-sqlite3 11.x 在本机 Node 24 下缺少可用预编译包；建议使用 Node 22 安装和运行，不混用原生模块 ABI。

```bash
npm install
```

## 配置

```bash
cp .env.example .env
# 编辑 .env，填入真实 ZENMUX_API_KEY
```

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ZENMUX_API_KEY` | （无） | ZenMux 平台密钥，缺失时 SDK 调用报 `MISSING_API_KEY` 错误 |
| `ZENMUX_BASE_URL` | `https://zenmux.ai/api/v1` | ZenMux API 基址 |
| `ZENMUX_IMAGE_MODEL` | `openai/gpt-image-2.5-sunburst` | 生图模型 |
| `ZENMUX_VISION_MODEL` | `bytedance/doubao-seed-2.0-lite` | 视觉校验模型 |
| `PORT` | `3000` | 服务端口 |
| `HOMEWORK_ACCESS_PASSWORD` | （空） | 原访问密码；网页登录及 Basic 均只检查密码，用户名不限 |
| `HOMEWORK_COOKIE_SECURE` | `false` | HTTPS 反代部署时设为 `true`，让会话 Cookie 只通过 HTTPS 发送 |

## 访问口令与部署

**访问口令（`HOMEWORK_ACCESS_PASSWORD`）**

- 未设置或留空：不启用校验，所有请求直接放行，仅限本机使用；服务启动时日志会输出 WARN 提醒。
- 已设置：访问首页跳转到网页登录页。用户名选填且不限，输入正确原密码即可进入。服务端用 HttpOnly、SameSite=Strict Cookie 维持12小时会话，刷新保留；退出、过期或服务重启后会话失效。不存储用户名或密码，不建立用户表。
- 登录页、样式、登录脚本及认证接口按用途开放，业务 API 和原图、结果图始终检查认证；API 未认证返回401，不触发浏览器原生账号框。原有 Basic 请求保持兼容。
- 退出只撤销网页会话，不能撤销客户端仍主动发送的有效 Basic 凭据。旧浏览器缓存 Basic 时需清除认证状态或使用新浏览器会话。
- 公网部署必须设置该变量；口令仅通过环境变量注入，不出现在前端代码中。

**反向代理路径前缀**

前端全部使用相对路径（`style.css`、`app.js`、`api/...`），因此应用可被 nginx 反代挂载到任意路径前缀下，
例如 `https://www.lenoxshawn.com/apps/homework/`。参考配置：

```nginx
location /apps/homework/ {
    proxy_set_header Host $http_host;  # 必须保留浏览器Host（含端口），用于同源检查
    proxy_pass http://127.0.0.1:3000/;   # 末尾 / 表示剥离 /apps/homework 前缀后转发
}
```

原理：页面位于 `/apps/homework/` 时，相对路径 `api/images/...` 解析为
`/apps/homework/api/images/...`，nginx 剥离前缀后转发给后端 `/api/images/...`，与现有路由完全兼容。

HTTPS 由反代终止时配置 `HOMEWORK_COOKIE_SECURE=true`；应用不盲目信任客户端提交的 X-Forwarded-Host。Cookie Path 为 `/`，同一域名部署多个本系统实例时应使用不同子域名，避免会话Cookie重名覆盖。

## 运行

```bash
npm start
# 学生作业批改系统已启动：http://localhost:3000
```

打开浏览器访问 <http://localhost:3000>：拖拽或选择图片上传（一次提交为一个批次），
页面每 2.5 秒轮询批次状态；非物理题弹窗提示、失败卡片可重试、完成卡片可放大/下载批改结果。

V1.0.1 上传前提示保证清晰无反光。审核只输出 `is_physics` 与 `grading_advice`。建议以 `【重新上传】` 开头时优先提示重新拍摄，不调用生图；否则 false 提示非物理题，true 按建议标注。潦草难辨认处标问号与温和提示，不强行判错。建议正文包含“模糊”等词不会触发打回。

拒绝图片使用“重新上传”建立新记录；技术失败使用“重试”。审核失败重试先审核，生图失败复用已保存建议。卡片可展开查看批改建议。

首次打开旧数据库时自动增量添加两列，旧结果不覆盖、历史记录不补跑。部署前备份业务数据库；本次开发验证仅使用临时库，未迁移业务数据。

功能测试使用模拟模型，不能证明准确率提高。真实样本检查方法见 [docs/v101-manual-evaluation.md](docs/v101-manual-evaluation.md)。

## 测试

```bash
npm test
```

测试使用 `/tmp` 下的独立临时数据库与存储目录，不真调外部 API（SDK 以依赖注入方式替换为 fake 实现），
不污染项目 `data/` 目录。覆盖：schema 幂等、三表字段与 CHECK 枚举、两条状态流转路径、
attempt 递增与 UNIQUE 约束、FAILED 重试，以及 REST API 全链路。

V1.0.1另覆盖严格两字段协议、质量前缀优先、审核保存故障、重试复用、旧库迁移、会话到期和反代Host检查。
可选浏览器检查使用 `node test/browser-smoke.cjs`，需已安装 Playwright 和 Chrome；可通过 `PLAYWRIGHT_MODULE` 指定现有Playwright包路径。该检查同样只用fake SDK和临时数据库，覆盖子路径登录、移动端拒绝提示、重试、纯文本渲染、放大和退出。

## 接口概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/batches` | multipart/form-data（字段 `images`，多文件 png/jpeg），建批次并自动开始批改 |
| GET | `/api/batches/:id` | 批次详情（含图片状态列表，供轮询） |
| GET | `/api/images/:id` | 单图详情（含最近一次生成尝试记录） |
| GET | `/api/images/:id/raw` | 原图文件 |
| GET | `/api/images/:id/result` | 批改结果图（仅 SUCCEEDED 有） |
| POST | `/api/images/:id/retry` | FAILED 图片重试 |

统一错误格式与完整请求/响应示例见 [docs/api.md](docs/api.md)。

## 目录结构

```
├── public/               # 原生前端（index.html / style.css / app.js）
├── src/
│   ├── config.js         # env 集中读取
│   ├── logger.js         # logs/app.log + 控制台双写
│   ├── server.js         # 入口
│   ├── app.js            # Express 组装与统一错误处理
│   ├── db/               # schema.sql（幂等建表）与连接管理
│   ├── prompts/          # 视觉审核指令 / 生图批改提示词（不入数据库）
│   ├── routes/           # REST 路由与 multipart 解析
│   ├── sdk/zenmux/       # ZenMux 协议封装（业务代码只经此调用外部平台）
│   └── services/         # gradingService（三层状态机编排）、storage（本地文件存储）
├── data/                 # 运行期数据（SQLite 库、上传原图、结果图），已 gitignore
├── logs/                 # 运行日志，已 gitignore
└── docs/api.md           # REST API 契约
```
