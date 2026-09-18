'use strict';

const { ZenMuxError } = require('./client');

// 生图 API：POST /images/generations
// 实测最小可用参数组合：{ model, prompt, size: "1024x1024", n: 1 }，
// 同步返回 data[0].b64_json（无 URL 字段），耗时约 48s —— 超时须 >= 120s。
function createImageApi(client, { model, timeoutMs }) {
  return {
    modelId: model,

    /**
     * @param {string} prompt 生图提示词
     * @returns {Promise<{b64_json: string, requestId: string|null}>}
     */
    async generateImage(prompt) {
      const { data, requestId } = await client.request('/images/generations', {
        body: { model, prompt, size: '1024x1024', n: 1 },
        timeoutMs,
      });

      const b64_json = data && data.data && data.data[0] ? data.data[0].b64_json : undefined;
      if (!b64_json) {
        throw new ZenMuxError({
          code: 'IMAGE_PARSE_ERROR',
          type: 'protocol',
          message: '生图响应缺少 data[0].b64_json',
          requestId,
        });
      }

      return { b64_json, requestId };
    },
  };
}

module.exports = { createImageApi };
