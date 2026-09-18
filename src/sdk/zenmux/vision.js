'use strict';

const { ZenMuxError } = require('./client');
const { VISION_PROMPT } = require('../../prompts/visionPrompt');

// 视觉审核 API：POST /chat/completions
// content 数组 = [固定审核指令, {type:"image_url", image_url:{url}}]；
// response_format 用 json_schema strict 强制 {is_physics, reason}
// （实测可用；降级方案为 json_object + 提示词钉键名，见协议纪要 A-02）。
function createVisionApi(client, { model, timeoutMs }) {
  const RESPONSE_FORMAT = {
    type: 'json_schema',
    json_schema: {
      name: 'physics_relevance_check',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          is_physics: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['is_physics', 'reason'],
        additionalProperties: false,
      },
    },
  };

  return {
    modelId: model,

    /**
     * @param {string} dataUrl 图片 data URL（data:image/png;base64,...）
     * @returns {Promise<{is_physics: boolean, reason: string}>} 结构化判定结果
     */
    async validateImage(dataUrl) {
      const { data } = await client.request('/chat/completions', {
        body: {
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: VISION_PROMPT },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
          response_format: RESPONSE_FORMAT,
        },
        timeoutMs,
      });

      const content =
        data && data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content
          : undefined;

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new ZenMuxError({
          code: 'VISION_PARSE_ERROR',
          type: 'protocol',
          message: '视觉模型返回内容不是合法 JSON',
        });
      }

      return {
        is_physics: parsed.is_physics === true,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      };
    },
  };
}

module.exports = { createVisionApi };
