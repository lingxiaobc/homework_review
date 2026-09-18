'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { createStorage } = require('../src/services/storage');
const { createLogger } = require('../src/logger');
const { createGradingService } = require('../src/services/gradingService');
const { GRADING_PROMPT, PROMPT_VERSION } = require('../src/prompts/imagePrompt');

// 1x1 像素透明 PNG 的 base64
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function tinyPngBuffer() {
  return Buffer.from(TINY_PNG_B64, 'base64');
}

function makeTempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `grading-${label}-`));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeLogger(logFile) {
  return createLogger({ logFile, enableConsole: false });
}

// 构造 HTTP Basic Authorization 头（用户名任意，服务端只校验密码段）
function basicAuthHeader(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

// fake sdk：不真调外部 API，以依赖注入方式传入 gradingService。
// 可通过 sdk.state 在测试中途切换成功/失败行为。
function createFakeSdk(options = {}) {
  const calls = { vision: [], image: [] };
  const state = {
    visionResult: options.visionResult || { is_physics: true, reason: '测试物理题' },
    visionError: options.visionError || null,
    imageError: options.imageError || null,
    requestId: options.requestId || 'req_test_001',
    imageModelId: options.imageModelId || 'test-image-model',
  };

  return {
    calls,
    state,
    vision: {
      modelId: 'test-vision-model',
      async validateImage(dataUrl) {
        calls.vision.push(dataUrl);
        if (state.visionError) throw state.visionError;
        return state.visionResult;
      },
    },
    image: {
      modelId: state.imageModelId,
      async generateImage(prompt) {
        calls.image.push(prompt);
        if (state.imageError) throw state.imageError;
        return { b64_json: TINY_PNG_B64, requestId: state.requestId };
      },
    },
  };
}

// 独立临时库 + 临时存储目录（/tmp 下，不污染项目 data/）
function makeServiceEnv(sdk, label = 'svc') {
  const dir = makeTempDir(label);
  const db = openDatabase(path.join(dir, 'test.db'));
  const storage = createStorage({ rootDir: dir });
  const logger = makeLogger(path.join(dir, 'logs', 'app.log'));
  const service = createGradingService({
    db,
    storage,
    sdk,
    logger,
    gradingPrompt: GRADING_PROMPT,
    promptVersion: PROMPT_VERSION,
  });
  return { dir, db, storage, logger, service };
}

module.exports = {
  TINY_PNG_B64,
  tinyPngBuffer,
  makeTempDir,
  makeLogger,
  basicAuthHeader,
  makeServiceEnv,
  createFakeSdk,
  sleep,
};
