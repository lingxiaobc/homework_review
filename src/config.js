'use strict';

const path = require('path');

// 项目根目录（src/ 的上一级）。所有相对路径以其为基准，避免受启动 cwd 影响。
const ROOT_DIR = path.resolve(__dirname, '..');

module.exports = {
  rootDir: ROOT_DIR,
  port: Number.parseInt(process.env.PORT || '3000', 10),
  dbPath: path.join(ROOT_DIR, 'data', 'app.db'),
  logDir: path.join(ROOT_DIR, 'logs'),
  publicDir: path.join(ROOT_DIR, 'public'),
  zenmux: {
    apiKey: process.env.ZENMUX_API_KEY || '',
    baseUrl: process.env.ZENMUX_BASE_URL || 'https://zenmux.ai/api/v1',
    visionModel: process.env.ZENMUX_VISION_MODEL || 'bytedance/doubao-seed-2.0-lite',
    imageModel: process.env.ZENMUX_IMAGE_MODEL || 'openai/gpt-image-2.5-sunburst',
    // 视觉校验超时；生图实测约 48s，超时须 >= 120s（docs/zenmux-protocol-notes.md A-02 结论）
    visionTimeoutMs: 60 * 1000,
    imageTimeoutMs: 180 * 1000,
  },
};
