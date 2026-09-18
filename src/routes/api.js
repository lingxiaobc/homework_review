'use strict';

const express = require('express');
const { parseMultipartFiles } = require('./multipart');

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg']);

function errorBody(code, message) {
  return { error: { code, message } };
}

function createApiRouter({ service, storage }) {
  const router = express.Router();

  // POST /api/batches：multipart/form-data，字段 images（多文件，png/jpeg）
  router.post('/batches', async (req, res, next) => {
    try {
      const allFiles = await parseMultipartFiles(req);
      const files = allFiles.filter((f) => f.fieldname === 'images');
      if (files.length === 0) {
        return res
          .status(400)
          .json(errorBody('VALIDATION_ERROR', '请求须为 multipart/form-data 且包含 images 文件字段'));
      }
      for (const file of files) {
        if (!ALLOWED_MIME.has(file.mime)) {
          return res
            .status(400)
            .json(errorBody('VALIDATION_ERROR', `仅支持 png/jpeg 格式：${file.filename || '未命名文件'}`));
        }
      }

      const prepared = files.map((file) => ({
        filename: file.filename,
        buffer: file.buffer,
        ext: file.mime === 'image/png' ? 'png' : 'jpg',
      }));
      const { batch_id, image_ids } = service.createBatch(prepared);

      res.status(201).json({
        batch_id,
        images: image_ids.map((imageId) => ({ image_id: imageId, status: 'UPLOADED' })),
      });

      // 响应发出后自动异步开始校验 + 生成流水线
      service.startBatchProcessing(image_ids);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/batches/:id：批次详情（含图片状态列表）
  router.get('/batches/:id', (req, res) => {
    const batch = service.getBatch(req.params.id);
    const images = service.listBatchImages(batch.batch_id).map(service.describeImage);
    res.json({ batch_id: batch.batch_id, created_at: batch.created_at, images });
  });

  // GET /api/images/:id：单图详情
  router.get('/images/:id', (req, res) => {
    res.json(service.getImageDetail(req.params.id));
  });

  // GET /api/images/:id/raw：原图文件
  router.get('/images/:id/raw', (req, res) => {
    const image = service.getImageDetail(req.params.id);
    const absPath = storage.resolveKey(image.raw_image_key);
    if (!storage.exists(image.raw_image_key)) {
      return res.status(404).json(errorBody('NOT_FOUND', '原图文件不存在'));
    }
    res.type(image.raw_image_key.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.sendFile(absPath);
  });

  // GET /api/images/:id/result：批改结果图（仅 SUCCEEDED 有）
  router.get('/images/:id/result', (req, res) => {
    const image = service.getImageDetail(req.params.id);
    if (image.status !== 'SUCCEEDED' || !image.result_image_key) {
      return res.status(404).json(errorBody('NOT_FOUND', '批改结果图不存在或尚未生成'));
    }
    if (!storage.exists(image.result_image_key)) {
      return res.status(404).json(errorBody('NOT_FOUND', '批改结果图文件不存在'));
    }
    res.type('image/png');
    res.sendFile(storage.resolveKey(image.result_image_key));
  });

  // POST /api/images/:id/retry：FAILED 图片重试（异步执行，立即返回 GENERATING）
  router.post('/images/:id/retry', (req, res, next) => {
    try {
      service.startRetry(req.params.id);
      res.status(202).json({ image_id: req.params.id, status: 'GENERATING' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createApiRouter, errorBody };
