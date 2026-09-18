# ZenMux 平台协议核实纪要（A-01 产物）

- 核查日期：2026-09-18
- 核查方式：联网搜索 + 官方文档站（zenmux.ai/docs）抓取 + 公开 Models API 实测（GET /api/v1/models，只读、无需密钥）
- 用途：学生作业批改系统接入前置事实核查（对应 PT-homework-grading-mvp 行动 A-01）

## 核心结论

ZenMux 是 OpenAI 兼容的大模型聚合网关，官网 https://zenmux.ai，API base URL 为 `https://zenmux.ai/api/v1`（主域名路径，非 api.zenmux.ai 子域名）。鉴权使用 `Authorization: Bearer <API_KEY>`。系统两个模型 ID `openai/gpt-image-2.5-sunburst` 与 `bytedance/doubao-seed-2.0-lite` 均已查到官方模型页面，其中 doubao-seed-2.0-lite 已通过公开 Models API 实测确认支持图像输入。

## 逐项结论

### 1. API 基址
- Base URL：`https://zenmux.ai/api/v1`
- 实测确认：`GET https://zenmux.ai/api/v1/models` 公开可访问，返回标准 OpenAI 格式 `{"object":"list","data":[...]}`
- 来源：https://zenmux.ai/docs/guide/advanced/openai-image-generation.html 、https://zenmux.ai/docs/api/openai/openai-list-models.html

### 2. 鉴权
- `Authorization: Bearer $ZENMUX_API_KEY`（官方 curl 示例原文；环境变量惯例名 ZENMUX_API_KEY）
- 来源：https://zenmux.ai/docs/guide/advanced/openai-image-generation.html

### 3. OpenAI 兼容端点
| 端点 | 用途 |
| --- | --- |
| POST /chat/completions | 对话补全（视觉模型走此端点） |
| POST /responses | OpenAI Responses API |
| POST /images/generations | 文生图 |
| POST /images/edits | 图片编辑（multipart/form-data） |
| GET /models | 模型列表 |

另兼容 Anthropic 协议 /v1/messages 与 Google Gemini/Vertex 协议。本系统采用 OpenAI 协议。

### 4. 视觉理解模型调用
- 走 `/chat/completions`，`content` 数组用 `type: "image_url"` 传入，同时支持远程 URL 与 base64 data URL（`data:image/jpeg;base64,...`），支持多图。
- `bytedance/doubao-seed-2.0-lite` 经 Models API 实测：`input_modalities: ["text","image","video"]`，`output_modalities: ["text"]`，`capabilities.reasoning: true`，`context_length: 256000`。
- 来源：https://zenmux.ai/docs/guide/advanced/multimodal.html

### 5. 结构化输出
- 平台级已确认：官方 Structured Outputs 页面声明支持 `response_format`（`json_object` / `json_schema`），来源 https://zenmux.ai/docs/guide/advanced/structured-output.html
- 【未确认】`doubao-seed-2.0-lite` 模型级是否支持（Models API capabilities 未暴露该标志）→ 由 A-02 实测；降级方案：提示词约束 JSON 输出。

### 6. 生图模型调用
- 端点：`POST /images/generations`（非 chat 附带输出）；另有 `/images/edits` 可做参考图编辑。
- 同步返回，无异步任务轮询（可选 `stream: true` 流式）。
- GPT Image 系参数：`model`、`prompt`（最长 32000 字符）、`size`（如 1024x1024、1024x1536）、`quality`（low/medium/high/auto）、`output_format`（png/jpeg/webp）、`background`、`n`、`stream`/`partial_images`。
- 响应：GPT Image 系默认返回 `data[].b64_json`，无需传 `response_format`。
- 【中等置信】size/quality 枚举来自第三方接入商文档与 OpenAI 官方指南交叉印证 → A-02 以一次真实调用验证。
- 来源：https://zenmux.ai/docs/guide/advanced/openai-image-generation.html 、https://zenmux.ai/docs/api/openai/generate-an-image.html

### 7. 模型 ID 可查性
- `openai/gpt-image-2.5-sunburst`：官方页面 https://zenmux.ai/openai/gpt-image-2.5-sunburst （GPT Image 2.5 系列"精准向"档位，2026-09-08 上线 ZenMux）
- `bytedance/doubao-seed-2.0-lite`：官方页面 https://zenmux.ai/bytedance/doubao-seed-2.0-lite ；Models API 实测在列（256K 上下文、text/image/video 输入）
- 来源：https://zenmux.ai/models + 公开 Models API 实测

### 8. 错误响应
- 已确认：每响应附带 `x-request-id` 响应头；控制台 Request Logs 可按 Request ID 检索；官方错误码参考页 https://zenmux.ai/docs/guide/advanced/error-codes.html
- 【未确认】错误 JSON 体内部完整字段（error.type/code/message 确切结构）→ 由 A-02 以一次无效凭据请求实测确认（无费用）。

## 待 A-02 实测确认清单
1. `doubao-seed-2.0-lite` 的 `response_format`（json_object/json_schema）支持性；不支持则降级提示词约束 JSON。
2. `gpt-image-2.5-sunburst` 的最小可用参数组合（size/quality/output_format）与 b64_json 返回。
3. 错误 JSON 体结构（以无效凭据触发 401 实测）。

## A-02 实测结论（2026-09-18，真实调用确认，实现以此为准）

1. **response_format：已确认支持。** json_object 与 json_schema strict 均被接受（HTTP 200）。json_schema strict 可强制精确键名与类型（实测生效）；json_object 单独使用时键名会漂移，必须配合提示词显式钉死键名。**SDK 首选 json_schema strict。**
2. **生图最小可用参数：`{model, prompt, size:"1024x1024", n:1}` 一次成功**，无需 quality/output_format/response_format。同步返回 `data[].b64_json`（无 URL 字段）。实测耗时约 48s——前端必须异步轮询。响应顶层字段：created, background, data, output_format, quality, size, usage。
3. **错误 JSON 体结构：`{"error":{"code":"403","type":"access_denied","message":"...(request_id:...)"}}`。** 无效凭据返回 **403（非 401）**——错误处理不能只判 401。request_id 内嵌于 message 文本。
4. **请求 ID 响应头修正：网关端点实际头名为 `X-ZenMux-RequestId`**（成功与失败响应均携带；文档示例中的 x-request-id 名称不准确）。`provider_request_id` 应取此头。
5. GET /models 走门户路由（不校验密钥、request-id 为数字串格式），不可用于鉴权探测。
6. 视觉链路闭环验证：生图模型生成的物理题图片 → 视觉模型正确判定 is_physics=true 且 reason 与图片内容吻合。
