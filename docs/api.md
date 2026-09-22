# REST API 契约（学生作业批改系统 V1.0.1）

- Base URL：`http://localhost:3000`（端口由 env `PORT` 配置，默认 3000）
- 所有 `/api/*` 接口的请求与响应体均为 JSON（上传接口为 multipart/form-data 除外）
- 静态前端托管于 `/`（`public/` 目录）

## 登录与认证

配置 `HOMEWORK_ACCESS_PASSWORD` 时，业务API及原图/结果图要求有效网页会话或正确的HTTP Basic密码。用户名任意或为空。未认证API返回401，不发送浏览器Basic挑战；首页跳转相对路径 `login.html`。未配置密码保持本地免认证行为。

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| `POST /api/auth/login` | JSON：`password`，可选 `username`（不校验） | 200 `{"authenticated":true}`，设置 HttpOnly、SameSite=Strict 会话Cookie；错误密码401 |
| `GET /api/auth/session` | 无 | 200 `{"authenticated":true或false,"password_required":true或false}` |
| `POST /api/auth/logout` | 无 | 200 `{"authenticated":false}`，撤销当前网页会话并清Cookie |

会话有效期12小时，服务重启失效。退出不撤销客户端继续主动发送的Basic凭据。登录JSON上限8KB；非法JSON或超限返回400。浏览器跨站写请求返回403。反向代理须保留原Host（含端口），HTTPS部署设置 `HOMEWORK_COOKIE_SECURE=true`。会话和图片响应使用 `Cache-Control: no-store`。

## 统一错误格式

所有 `/api/*` 错误响应均为：

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "批次不存在：xxx"
  }
}
```

| code | HTTP 状态 | 含义 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | 请求格式或参数不合法（非 multipart、缺 images 字段、非 png/jpeg 文件） |
| `NOT_FOUND` | 404 | 批次/图片/结果图/接口不存在 |
| `INVALID_STATE` | 409 | 状态机不允许该操作（如非 FAILED 图片调用重试） |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |
| `UNAUTHORIZED` | 401 | 密码错误、未登录或会话已过期 |
| `FORBIDDEN` | 403 | 非同源的浏览器写请求 |

---

## POST /api/batches — 创建批次并开始批改

上传一张或多张作业图片，创建一个批次；服务端保存原图后，自动异步执行
「视觉校验 → 生图批改」流水线（进程内异步，无消息队列）。

**请求**：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `images` | file（可多个） | 是 | png / jpeg 图片文件 |

**限额**：单次最多 20 个文件，单个文件最大 10MB；超限返回 400 `VALIDATION_ERROR`。

**响应** `201 Created`：

```json
{
  "batch_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "images": [
    { "image_id": "0b9e6b1e-6f5a-4a7d-9d1f-6c1c2b3a4d5e", "status": "UPLOADED" },
    { "image_id": "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f", "status": "UPLOADED" }
  ]
}
```

**错误**：400 `VALIDATION_ERROR`（非 multipart、无 images 字段、含非 png/jpeg 文件）。

---

## GET /api/batches/:id — 批次详情

**响应** `200 OK`：

```json
{
  "batch_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "created_at": "2026-09-18T08:00:00.000Z",
  "images": [
    {
      "image_id": "0b9e6b1e-6f5a-4a7d-9d1f-6c1c2b3a4d5e",
      "batch_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "status": "GENERATING",
      "validation_status": "PASSED",
      "is_physics": true,
      "grading_advice": "第1题正确，在答案旁打勾。",
      "has_result": false,
      "error_message": null,
      "created_at": "2026-09-18T08:00:00.000Z",
      "updated_at": "2026-09-18T08:00:50.000Z"
    }
  ]
}
```

字段说明：

- `status`（图片级状态机）：`UPLOADED` / `VALIDATING` / `READY` / `GENERATING` / `SUCCEEDED` / `FAILED` / `REJECTED`
- `validation_status`：`PENDING` / `PASSED` / `REJECTED` / `FAILED`
- `error_message`：最近一次失败尝试的错误信息；无失败时为 `null`
- `has_result`：批改结果图是否已生成
- `is_physics`：新增，boolean或null；null表示尚未有效审核或历史未记录，不是false。
- `grading_advice`：新增，string或null；整张图的建议或拒绝原因，保留 `【重新上传】` 前缀。单图详情返回相同字段。
- `validation_status=PASSED` 表示允许生图；质量和非物理拒绝均为REJECTED。

前后端分流顺序一致：先看建议首尾去空白后是否以 `【重新上传】` 开头，再看 `is_physics`。有前缀时显示质量原因并要求重新拍摄；无前缀且false提示非物理题；无前缀且true生成标注。历史拒绝缺少新字段时显示“该图片未通过旧版审核，请重新上传”。所有模型文本以纯文本展示。

**错误**：404 `NOT_FOUND`。

---

## GET /api/images/:id — 单图详情

**响应** `200 OK`：

```json
{
  "image_id": "0b9e6b1e-6f5a-4a7d-9d1f-6c1c2b3a4d5e",
  "batch_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "raw_image_key": "data/uploads/<batch_id>/<image_id>.png",
  "status": "FAILED",
  "validation_status": "PASSED",
  "is_physics": true,
  "grading_advice": "第1题正确，在答案旁打勾。",
  "result_image_key": null,
  "error_message": "ZenMux 请求超时（180000ms）：/images/edits",
  "created_at": "2026-09-18T08:00:00.000Z",
  "updated_at": "2026-09-18T08:03:30.000Z",
  "latest_attempt": {
    "attempt_id": "5f2a-…",
    "image_id": "0b9e6b1e-6f5a-4a7d-9d1f-6c1c2b3a4d5e",
    "attempt_no": 1,
    "model_id": "openai/gpt-image-2.5-sunburst",
    "prompt_version": "grading-v1.0.1",
    "status": "FAILED",
    "provider_request_id": null,
    "started_at": "2026-09-18T08:00:50.000Z",
    "finished_at": "2026-09-18T08:03:30.000Z",
    "latency_ms": 160012,
    "erroe_code": "TIMEOUT",
    "error_type": "timeout",
    "error_message": "ZenMux 请求超时（180000ms）：/images/edits"
  }
}
```

说明：`latest_attempt` 为最近一次生成尝试记录（无尝试时为 `null`）；
`erroe_code` 为设计文档原文拼写，按设计保留。

**错误**：404 `NOT_FOUND`。

---

## GET /api/images/:id/raw — 原图文件

**响应** `200 OK`：图片二进制（`Content-Type: image/png` 或 `image/jpeg`）。

**错误**：404 `NOT_FOUND`（图片不存在或原图文件丢失）。

---

## GET /api/images/:id/result — 批改结果图

仅 `SUCCEEDED` 状态的图片有结果图。

**响应** `200 OK`：PNG 图片二进制（`Content-Type: image/png`）。

**错误**：404 `NOT_FOUND`（图片不存在、尚未生成成功或文件丢失）。

---

## POST /api/images/:id/retry — 失败重试

仅 `FAILED` 状态可重试：有效审核为PASSED、is_physics=true、建议非空且无打回前缀时进入 `GENERATING`，复用建议并新增生成尝试；否则进入 `VALIDATING` 重新审核（含旧版缺建议记录）。响应status为实际启动阶段。重复在途请求返回409。

`REJECTED` 不调用此接口，用户重新拍摄或更换图片后通过上传接口建立新记录。

**请求**：无请求体。

**响应** `202 Accepted`：

```json
{
  "image_id": "0b9e6b1e-6f5a-4a7d-9d1f-6c1c2b3a4d5e",
  "status": "GENERATING"
}
```

**错误**：

- 404 `NOT_FOUND`：图片不存在
- 409 `INVALID_STATE`：图片当前状态不是 `FAILED`

---

## 图片状态机（供前端参考）

```
UPLOADED → VALIDATING ─┬─（质量或非物理拒绝）→ REJECTED（重新上传）
                       ├─（调用/协议/保存失败）→ FAILED（retry → VALIDATING）
                       └─（通过且建议已保存）→ READY → GENERATING ─┬─→ SUCCEEDED
                                                                 └─→ FAILED（retry复用建议 → GENERATING）
```

前端轮询 `GET /api/batches/:id`，当批次内所有图片到达
`SUCCEEDED` / `FAILED` / `REJECTED` 终态后即可停止轮询。
