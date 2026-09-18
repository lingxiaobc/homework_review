'use strict';

// ZenMux 平台 HTTP 客户端（仅协议封装，不含业务逻辑）。
// 错误统一规范化为 { code, type, message, requestId }。
//
// 实测结论（docs/zenmux-protocol-notes.md A-02，实现以此为准）：
// - 无效凭据返回 403 access_denied（而非 401），错误体为
//   {"error":{"code","type","message"}}，request_id 内嵌于 message 文本；
// - 请求 ID 响应头实际名为 X-ZenMux-RequestId（成功与失败响应均携带），
//   用 fetch Headers.get 大小写不敏感特性获取。

class ZenMuxError extends Error {
  constructor({ code, type, message, requestId = null }) {
    super(message);
    this.name = 'ZenMuxError';
    this.code = String(code);
    this.type = type;
    this.requestId = requestId;
  }
}

function createZenMuxClient({ baseUrl, apiKey, defaultTimeoutMs = 60 * 1000 }) {
  const root = String(baseUrl || '').replace(/\/+$/, '');

  async function request(path, { method = 'POST', body, timeoutMs = defaultTimeoutMs } = {}) {
    if (!apiKey) {
      throw new ZenMuxError({
        code: 'MISSING_API_KEY',
        type: 'config_error',
        message: '未配置 ZENMUX_API_KEY 环境变量，无法调用 ZenMux API。请复制 .env.example 为 .env 并填入密钥。',
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${root}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ZenMuxError({
          code: 'TIMEOUT',
          type: 'timeout',
          message: `ZenMux 请求超时（${timeoutMs}ms）：${path}`,
        });
      }
      throw new ZenMuxError({
        code: 'NETWORK_ERROR',
        type: 'network',
        message: `ZenMux 网络请求失败：${err.message}`,
      });
    } finally {
      clearTimeout(timer);
    }

    // Headers.get 大小写不敏感，兼容 X-ZenMux-RequestId 实际头名
    const requestId = res.headers.get('X-ZenMux-RequestId');

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      // 非 JSON 响应体，保持 null
    }

    if (!res.ok) {
      const e = (payload && payload.error) || {};
      throw new ZenMuxError({
        code: e.code !== undefined ? e.code : `HTTP_${res.status}`,
        type: e.type || 'http_error',
        message: e.message || `ZenMux 请求失败（HTTP ${res.status}）`,
        requestId,
      });
    }

    return { status: res.status, requestId, data: payload };
  }

  return { request };
}

module.exports = { createZenMuxClient, ZenMuxError };
