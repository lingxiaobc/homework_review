'use strict';

const { createZenMuxClient } = require('./client');
const { createVisionApi } = require('./vision');
const { createImageApi } = require('./image');

// 组装 ZenMux SDK 实例。业务代码只经此模块调用外部平台，
// 依赖注入时以 { vision: {validateImage}, image: {modelId, generateImage} } 形态传入。
function createZenMuxSdk(zenmuxConfig) {
  const client = createZenMuxClient({
    baseUrl: zenmuxConfig.baseUrl,
    apiKey: zenmuxConfig.apiKey,
    defaultTimeoutMs: zenmuxConfig.visionTimeoutMs,
  });

  return {
    vision: createVisionApi(client, {
      model: zenmuxConfig.visionModel,
      timeoutMs: zenmuxConfig.visionTimeoutMs,
    }),
    image: createImageApi(client, {
      model: zenmuxConfig.imageModel,
      timeoutMs: zenmuxConfig.imageTimeoutMs,
    }),
  };
}

module.exports = { createZenMuxSdk };
