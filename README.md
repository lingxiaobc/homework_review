# 学生作业批改系统 V1.0.0 MVP

上传高中物理作业图片，AI 自动完成「视觉校验（是否物理题）→ 生图批改标注」，
并在前端实时展示批次进度、结果图与失败重试。

技术栈：Express + SQLite（better-sqlite3）+ 原生 HTML/CSS/JS 前端（无框架）。
外部平台：[ZenMux](https://zenmux.ai)（OpenAI 兼容聚合网关），协议细节见 `docs/zenmux-protocol-notes.md`。

## 安装

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
| `HOMEWORK_ACCESS_PASSWORD` | （空） | 访问口令（HTTP Basic），见下节「访问口令与部署」 |

## 访问口令与部署

**访问口令（`HOMEWORK_ACCESS_PASSWORD`）**

- 未设置或留空：不启用校验，所有请求直接放行，仅限本机使用；服务启动时日志会输出 WARN 提醒。
- 已设置：所有请求（页面、静态资源、全部 `/api`）均要求 HTTP Basic 认证。浏览器首次访问会弹出原生账号密码框，输入任意用户名与正确口令后，同域请求自动携带凭据；口令错误返回 401 与统一错误 JSON。
- 公网部署必须设置该变量；口令仅通过环境变量注入，不出现在前端代码中。

**反向代理路径前缀**

前端全部使用相对路径（`style.css`、`app.js`、`api/...`），因此应用可被 nginx 反代挂载到任意路径前缀下，
例如 `https://www.lenoxshawn.com/apps/homework/`。参考配置：

```nginx
location /apps/homework/ {
    proxy_pass http://127.0.0.1:3000/;   # 末尾 / 表示剥离 /apps/homework 前缀后转发
}
```

原理：页面位于 `/apps/homework/` 时，相对路径 `api/images/...` 解析为
`/apps/homework/api/images/...`，nginx 剥离前缀后转发给后端 `/api/images/...`，与现有路由完全兼容。

## 运行

```bash
npm start
# 学生作业批改系统已启动：http://localhost:3000
```

打开浏览器访问 <http://localhost:3000>：拖拽或选择图片上传（一次提交为一个批次），
页面每 2.5 秒轮询批次状态；非物理题弹窗提示、失败卡片可重试、完成卡片可放大/下载批改结果。

## 测试

```bash
npm test
```

测试使用 `/tmp` 下的独立临时数据库与存储目录，不真调外部 API（SDK 以依赖注入方式替换为 fake 实现），
不污染项目 `data/` 目录。覆盖：schema 幂等、三表字段与 CHECK 枚举、两条状态流转路径、
attempt 递增与 UNIQUE 约束、FAILED 重试，以及 REST API 全链路。

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
