'use strict';

const crypto = require('crypto');
const { validateVerdict, rejection } = require('../../public/gradingRules');

// 三层共用状态机（与 schema.sql CHECK 枚举一致）：
// - 图片级 status：UPLOADED → VALIDATING →（视觉判定 PASSED → READY → GENERATING → SUCCEEDED | FAILED；
//   判定 REJECTED → REJECTED）
// - validation_status：PENDING → PASSED | REJECTED | FAILED
// - attempt status：PROCESSING → SUCCEEDED | FAILED
//
// 编排为进程内异步（无消息队列）：上传落库后 startBatchProcessing 触发逐图流水线。

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.code = 'NOT_FOUND';
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.code = 'INVALID_STATE';
  }
}

function uuid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

function extToMime(rawKey) {
  const ext = rawKey.split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function createGradingService({ db, storage, sdk, logger, gradingPrompt, promptVersion }) {
  const stmts = {
    getBatch: db.prepare('SELECT * FROM batches WHERE batch_id = ?'),
    getImage: db.prepare('SELECT * FROM images WHERE image_id = ?'),
    listBatchImages: db.prepare('SELECT * FROM images WHERE batch_id = ? ORDER BY created_at, image_id'),
    insertBatch: db.prepare('INSERT INTO batches (batch_id, created_at) VALUES (?, ?)'),
    insertImage: db.prepare(
      'INSERT INTO images (image_id, batch_id, raw_image_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ),
    setStatus: db.prepare('UPDATE images SET status = ?, updated_at = ? WHERE image_id = ?'),
    setValidation: db.prepare('UPDATE images SET validation_status = ?, updated_at = ? WHERE image_id = ?'),
    saveVerdict: db.prepare('UPDATE images SET is_physics = ?, grading_advice = ?, validation_status = ?, status = ?, updated_at = ? WHERE image_id = ?'),
    finishSuccess: db.prepare(
      'UPDATE images SET status = ?, result_image_key = ?, updated_at = ? WHERE image_id = ?'
    ),
    nextAttemptNo: db.prepare(
      'SELECT COALESCE(MAX(attempt_no), 0) + 1 AS no FROM generation_attempts WHERE image_id = ?'
    ),
    latestAttempt: db.prepare(
      'SELECT * FROM generation_attempts WHERE image_id = ? ORDER BY attempt_no DESC LIMIT 1'
    ),
    insertAttempt: db.prepare(
      `INSERT INTO generation_attempts
        (attempt_id, image_id, attempt_no, model_id, prompt_version, status, started_at)
       VALUES (?, ?, ?, ?, ?, 'PROCESSING', ?)`
    ),
    completeAttempt: db.prepare(
      `UPDATE generation_attempts
       SET status = 'SUCCEEDED', finished_at = ?, latency_ms = ?, provider_request_id = ?
       WHERE attempt_id = ?`
    ),
    failAttempt: db.prepare(
      `UPDATE generation_attempts
       SET status = 'FAILED', finished_at = ?, latency_ms = ?, erroe_code = ?, error_type = ?, error_message = ?
       WHERE attempt_id = ?`
    ),
  };

  function getImageOrThrow(imageId) {
    const image = stmts.getImage.get(imageId);
    if (!image) {
      throw new NotFoundError(`图片不存在：${imageId}`);
    }
    return image;
  }

  function transition(imageId, status) {
    stmts.setStatus.run(status, nowIso(), imageId);
  }

  function toDataUrl(image) {
    const buffer = storage.readRaw(image.raw_image_key);
    return `data:${extToMime(image.raw_image_key)};base64,${buffer.toString('base64')}`;
  }

  function errorProps(err) {
    return {
      erroe_code: err && err.code !== undefined ? String(err.code) : 'UNKNOWN',
      error_type: (err && err.type) || 'unknown',
      error_message: (err && err.message) || String(err),
      request_id: err && err.requestId !== undefined ? err.requestId : null,
    };
  }

  // 校验 + 生成全链路：UPLOADED → VALIDATING →（REJECTED | READY → GENERATING → SUCCEEDED | FAILED）
  async function processImage(imageId, retry = false) {
    const image = stmts.getImage.get(imageId);
    if (!image || image.status !== (retry ? 'FAILED' : 'UPLOADED')) {
      return; // 已处理或不存在，幂等跳过
    }

    let verdict;
    try {
      transition(imageId, 'VALIDATING');
      stmts.setValidation.run('PENDING', nowIso(), imageId);
      verdict = validateVerdict(await sdk.vision.validateImage(toDataUrl(image)));
      const rejected = rejection(verdict);
      stmts.saveVerdict.run(verdict.is_physics ? 1 : 0, verdict.grading_advice,
        rejected ? 'REJECTED' : 'PASSED', rejected ? 'REJECTED' : 'READY', nowIso(), imageId);
    } catch (err) {
      const props = errorProps(err);
      stmts.setValidation.run('FAILED', nowIso(), imageId);
      transition(imageId, 'FAILED');
      logger.error('视觉校验失败，图片标记为 FAILED', { image_id: imageId, ...props });
      return;
    }

    if (rejection(verdict)) {
      logger.warn('视觉审核拒绝', { image_id: imageId, kind: rejection(verdict).kind });
      return;
    }

    await runGeneration(imageId);
  }

  function hasGenerationAdvice(image) {
    if (image.validation_status !== 'PASSED' || image.is_physics !== 1) return false;
    try {
      return !rejection(validateVerdict({ is_physics: true, grading_advice: image.grading_advice }));
    } catch { return false; }
  }

  // 生成阶段：READY / FAILED（重试）→ GENERATING → SUCCEEDED | FAILED
  async function runGeneration(imageId) {
    if (!hasGenerationAdvice(getImageOrThrow(imageId))) {
      throw new ConflictError('缺少有效批改建议，不能进入生图');
    }
    transition(imageId, 'GENERATING');

    const attemptId = uuid();
    let attemptNo;
    let attemptCreated = false;
    const startedAtMs = Date.now();
    try {
      attemptNo = stmts.nextAttemptNo.get(imageId).no;
      stmts.insertAttempt.run(attemptId, imageId, attemptNo, sdk.image.modelId, promptVersion, nowIso());
      attemptCreated = true;
      // /images/edits 需携带学生作业原图（存储中的原图文件）
      const image = getImageOrThrow(imageId);
      const originalImage = {
        buffer: storage.readRaw(image.raw_image_key),
        mimeType: extToMime(image.raw_image_key),
        fileName: image.raw_image_key.split('/').pop(),
      };
      const prompt = `${gradingPrompt}\n\n以下是已审核并保存的批改建议，仅按此标注：\n${image.grading_advice}`;
      const { b64_json, requestId } = await sdk.image.generateImage(prompt, originalImage);
      const resultKey = storage.saveResultImage(imageId, Buffer.from(b64_json, 'base64'));
      const latencyMs = Date.now() - startedAtMs;
      stmts.completeAttempt.run(nowIso(), latencyMs, requestId ?? null, attemptId);
      stmts.finishSuccess.run('SUCCEEDED', resultKey, nowIso(), imageId);
      logger.info('批改结果图生成成功', {
        image_id: imageId,
        attempt_no: attemptNo,
        latency_ms: latencyMs,
        request_id: requestId ?? null,
      });
    } catch (err) {
      const latencyMs = Date.now() - startedAtMs;
      const props = errorProps(err);
      transition(imageId, 'FAILED');
      if (attemptCreated) stmts.failAttempt.run(nowIso(), latencyMs, props.erroe_code, props.error_type, props.error_message, attemptId);
      logger.error('批改结果图生成失败', { image_id: imageId, attempt_no: attemptNo, latency_ms: latencyMs, ...props });
    }
  }

  // ---- 对外操作 ----

  // 建批次 + 图片记录（原图已由路由层校验 png/jpeg），返回批次与图片 ID
  function createBatch(files) {
    const batchId = uuid();
    const ts = nowIso();
    const imageIds = [];

    const insertAll = db.transaction(() => {
      stmts.insertBatch.run(batchId, ts);
      for (const file of files) {
        const imageId = uuid();
        const key = storage.saveRawImage(batchId, imageId, file.buffer, file.ext);
        stmts.insertImage.run(imageId, batchId, key, ts, ts);
        imageIds.push(imageId);
      }
    });
    insertAll();

    logger.info('批次已创建', { batch_id: batchId, image_count: imageIds.length });
    return { batch_id: batchId, image_ids: imageIds };
  }

  function getBatch(batchId) {
    const batch = stmts.getBatch.get(batchId);
    if (!batch) {
      throw new NotFoundError(`批次不存在：${batchId}`);
    }
    return batch;
  }

  function listBatchImages(batchId) {
    return stmts.listBatchImages.all(batchId);
  }

  // 失败信息：生图失败取最近一次失败尝试的 error_message；
  // 校验阶段失败（无 attempt 记录）返回静态说明。
  function resolveErrorMessage(image, latestAttempt) {
    if (image.status !== 'FAILED') {
      return null;
    }
    if (image.validation_status === 'FAILED') {
      return '视觉校验失败：模型调用未成功';
    }
    if (latestAttempt && latestAttempt.status === 'FAILED') {
      return latestAttempt.error_message;
    }
    return null;
  }

  // 列表/卡片视图序列化（附带失败信息，供前端失败卡片展示）
  function describeImage(image) {
    const attempt = stmts.latestAttempt.get(image.image_id);
    return {
      image_id: image.image_id,
      batch_id: image.batch_id,
      status: image.status,
      validation_status: image.validation_status,
      is_physics: image.is_physics == null ? null : image.is_physics === 1,
      grading_advice: image.grading_advice,
      has_result: Boolean(image.result_image_key),
      error_message: resolveErrorMessage(image, attempt),
      created_at: image.created_at,
      updated_at: image.updated_at,
    };
  }

  // 单图详情
  function getImageDetail(imageId) {
    const image = getImageOrThrow(imageId);
    const latestAttempt = stmts.latestAttempt.get(imageId) || null;
    return {
      image_id: image.image_id,
      batch_id: image.batch_id,
      raw_image_key: image.raw_image_key,
      is_physics: image.is_physics == null ? null : image.is_physics === 1,
      grading_advice: image.grading_advice,
      status: image.status,
      validation_status: image.validation_status,
      result_image_key: image.result_image_key,
      error_message: resolveErrorMessage(image, latestAttempt),
      created_at: image.created_at,
      updated_at: image.updated_at,
      latest_attempt: latestAttempt,
    };
  }

  // FAILED 重试：状态回 GENERATING，新建 attempt（attempt_no 递增，UNIQUE(image_id, attempt_no) 生效）
  function assertRetryable(image) {
    if (image.status !== 'FAILED') {
      throw new ConflictError(`仅 FAILED 状态的图片可重试，当前状态：${image.status}`);
    }
  }

  // 完整等待重试结束（测试与内部使用）
  async function retryImage(imageId) {
    const image = getImageOrThrow(imageId);
    assertRetryable(image);
    if (hasGenerationAdvice(image)) await runGeneration(imageId);
    else await processImage(imageId, true);
  }

  // 启动重试但不等待完成：同步校验状态后立即返回（路由层据此返回 202），
  // 生成在后台异步执行。
  function startRetry(imageId) {
    const image = getImageOrThrow(imageId);
    assertRetryable(image);
    const status = hasGenerationAdvice(image) ? 'GENERATING' : 'VALIDATING';
    const work = status === 'GENERATING' ? runGeneration(imageId) : processImage(imageId, true);
    work.catch((err) => handlePipelineError(imageId, err));
    return status;
  }

  // 上传响应发出后，异步启动每张图的校验+生成流水线（进程内，无消息队列）
  function startBatchProcessing(imageIds) {
    for (const imageId of imageIds) {
      processImage(imageId).catch((err) => handlePipelineError(imageId, err));
    }
  }

  function handlePipelineError(imageId, err) {
    // 数据库完全不可写时也不能让第二次异常成为未处理的Promise。
    try { transition(imageId, 'FAILED'); }
    catch (stateError) { logger.error('无法保存失败状态', { image_id: imageId, ...errorProps(stateError) }); }
    logger.error('图片处理流水线异常退出', { image_id: imageId, ...errorProps(err) });
  }

  return {
    NotFoundError,
    ConflictError,
    createBatch,
    getBatch,
    listBatchImages,
    describeImage,
    getImageDetail,
    retryImage,
    startRetry,
    processImage,
    startBatchProcessing,
  };
}

module.exports = { createGradingService };
