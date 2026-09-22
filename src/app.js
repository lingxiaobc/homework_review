'use strict';

const { installAuth } = require('./auth');
const express = require('express');
const { createApiRouter, errorBody } = require('./routes/api');
const { createGradingService } = require('./services/gradingService');
const { GRADING_PROMPT, PROMPT_VERSION } = require('./prompts/imagePrompt');

// 组装 Express 应用。db / storage / sdk / logger 均可注入，便于测试替换为 fake 实现。
function createApp({ config, db, storage, sdk, logger }) {
  const service = createGradingService({
    db,
    storage,
    sdk,
    logger,
    gradingPrompt: GRADING_PROMPT,
    promptVersion: PROMPT_VERSION,
  });

  const app = express();
  app.disable('x-powered-by');

  // 网页会话与Basic兼容；未配置密码则保持本地免认证模式。
  installAuth(app, config);

  app.use('/api', createApiRouter({ service, storage }));
  app.use(express.static(config.publicDir));

  // 404：API 返回统一错误 JSON，页面请求返回文本
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json(errorBody('NOT_FOUND', '接口不存在'));
    }
    res.status(404).send('Not Found');
  });

  // 统一错误处理：错误 code（NOT_FOUND/INVALID_STATE/VALIDATION_ERROR）映射为 404/409/400，其余 500
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status =
      err && err.code === 'NOT_FOUND'
        ? 404
        : err && err.code === 'INVALID_STATE'
          ? 409
          : err && err.code === 'VALIDATION_ERROR'
            ? 400
            : err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')
              ? 400
              : 500;
    if (status >= 500) {
      logger.error('服务器内部错误', { method: req.method, path: req.originalUrl, message: err.message, stack: err.stack });
    }
    res.status(status).json(errorBody(status === 500 ? 'INTERNAL_ERROR' : (err.code || 'VALIDATION_ERROR'), status === 500 ? '服务器内部错误' : (status === 400 ? '请求格式或参数不合法' : err.message)));
  });

  return { app, service };
}

module.exports = { createApp };
