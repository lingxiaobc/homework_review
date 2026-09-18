'use strict';

const crypto = require('crypto');
const express = require('express');
const { createApiRouter, errorBody } = require('./routes/api');
const { createGradingService } = require('./services/gradingService');
const { GRADING_PROMPT, PROMPT_VERSION } = require('./prompts/imagePrompt');

// 解析 Authorization: Basic base64(用户名:密码)；格式不合法返回 null
function parseBasicCredentials(header) {
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice('Basic '.length).trim(), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) return null;
  return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

// 仅比较密码段（用户名不限制）；长度不等直接拒绝，长度检查同时避免 timingSafeEqual 因长度不同抛错
function passwordEquals(provided, expected) {
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

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

  // 访问口令校验：配置 accessPassword 时，静态资源与全部 /api 请求均要求 HTTP Basic；
  // 未配置则放行（本地/测试模式）。位于静态资源与全部 /api 路由之前。
  if (config.accessPassword) {
    app.use((req, res, next) => {
      const credentials = parseBasicCredentials(req.headers.authorization);
      if (!credentials || !passwordEquals(credentials.password, config.accessPassword)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="homework-grading"');
        return res.status(401).json(errorBody('UNAUTHORIZED', '访问口令错误'));
      }
      return next();
    });
  }

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
            : 500;
    if (status >= 500) {
      logger.error('服务器内部错误', { method: req.method, path: req.originalUrl, message: err.message, stack: err.stack });
    }
    res.status(status).json(errorBody(status === 500 ? 'INTERNAL_ERROR' : err.code, status === 500 ? '服务器内部错误' : err.message));
  });

  return { app, service };
}

module.exports = { createApp };
