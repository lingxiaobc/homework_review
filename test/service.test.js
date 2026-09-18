'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createFakeSdk, makeServiceEnv, tinyPngBuffer } = require('./helpers');

function getImageRow(env, imageId) {
  return env.db.prepare('SELECT * FROM images WHERE image_id = ?').get(imageId);
}

function getAttempts(env, imageId) {
  return env.db
    .prepare('SELECT * FROM generation_attempts WHERE image_id = ? ORDER BY attempt_no')
    .all(imageId);
}

test('状态流转（拒绝路径）：UPLOADED → VALIDATING → REJECTED，不产生 attempt', async () => {
  const sdk = createFakeSdk({ visionResult: { is_physics: false, reason: '是一张风景照' } });
  const env = makeServiceEnv(sdk, 'reject');

  const { batch_id, image_ids } = env.service.createBatch([{ filename: 'a.png', buffer: tinyPngBuffer(), ext: 'png' }]);
  assert.equal(getImageRow(env, image_ids[0]).status, 'UPLOADED');

  await env.service.processImage(image_ids[0]);

  const image = getImageRow(env, image_ids[0]);
  assert.equal(image.status, 'REJECTED');
  assert.equal(image.validation_status, 'REJECTED');
  assert.equal(image.result_image_key, null);
  assert.equal(getAttempts(env, image_ids[0]).length, 0);

  // 批次与图片落库关系（1:N 由 images.batch_id 表达）
  assert.equal(env.service.getBatch(batch_id).batch_id, batch_id);
  assert.equal(env.service.listBatchImages(batch_id).length, 1);

  // 视觉模型收到 data URL，且不含业务提示词外泄问题由 SDK 内部保证
  assert.match(sdk.calls.vision[0], /^data:image\/png;base64,/);

  // 校验拒绝已落日志
  const logText = fs.readFileSync(path.join(env.dir, 'logs', 'app.log'), 'utf8');
  assert.match(logText, /视觉审核拒绝/);
  assert.ok(logText.includes(image_ids[0]), '日志应包含 image_id');
});

test('状态流转（成功路径）：UPLOADED → VALIDATING → READY → GENERATING → SUCCEEDED', async () => {
  const sdk = createFakeSdk({ requestId: 'req_ok_1' });
  const env = makeServiceEnv(sdk, 'success');

  const { image_ids } = env.service.createBatch([{ filename: 'a.png', buffer: tinyPngBuffer(), ext: 'png' }]);
  await env.service.processImage(image_ids[0]);

  const image = getImageRow(env, image_ids[0]);
  assert.equal(image.status, 'SUCCEEDED');
  assert.equal(image.validation_status, 'PASSED');
  assert.ok(image.result_image_key, 'result_image_key 应已写入');
  assert.ok(fs.existsSync(path.join(env.dir, image.result_image_key)), '结果图文件应存在');

  const [attempt] = getAttempts(env, image_ids[0]);
  assert.equal(attempt.attempt_no, 1);
  assert.equal(attempt.status, 'SUCCEEDED');
  assert.equal(attempt.provider_request_id, 'req_ok_1');
  assert.equal(attempt.prompt_version, 'grading-v1');
  assert.equal(attempt.model_id, 'test-image-model');
  assert.equal(typeof attempt.latency_ms, 'number');
  assert.ok(attempt.finished_at);
  assert.equal(attempt.erroe_code, null);

  // 生图模型收到批改提示词
  assert.equal(sdk.calls.image.length, 1);
  assert.match(sdk.calls.image[0], /高中物理老师/);
});

test('attempt 失败记录：生图失败时 erroe_code/error_type/error_message 三要素落库，图片 FAILED', async () => {
  const imageError = new Error('上游模型过载');
  imageError.code = '503';
  imageError.type = 'server_error';
  imageError.requestId = 'req_fail_1';

  const sdk = createFakeSdk({ imageError });
  const env = makeServiceEnv(sdk, 'genfail');

  const { image_ids } = env.service.createBatch([{ filename: 'a.png', buffer: tinyPngBuffer(), ext: 'png' }]);
  await env.service.processImage(image_ids[0]);

  const image = getImageRow(env, image_ids[0]);
  assert.equal(image.status, 'FAILED');
  assert.equal(image.validation_status, 'PASSED');
  assert.equal(image.result_image_key, null);

  const [attempt] = getAttempts(env, image_ids[0]);
  assert.equal(attempt.status, 'FAILED');
  assert.equal(attempt.erroe_code, '503');
  assert.equal(attempt.error_type, 'server_error');
  assert.equal(attempt.error_message, '上游模型过载');
  assert.equal(attempt.provider_request_id, null);
  assert.ok(attempt.finished_at);

  const logText = fs.readFileSync(path.join(env.dir, 'logs', 'app.log'), 'utf8');
  assert.match(logText, /批改结果图生成失败/);
  assert.match(logText, /req_fail_1/);
});

test('视觉调用失败：validation_status = FAILED，图片 FAILED，不产生 attempt', async () => {
  const visionError = new Error('无效凭据');
  visionError.code = '403';
  visionError.type = 'access_denied';
  visionError.requestId = 'req_403';

  const sdk = createFakeSdk({ visionError });
  const env = makeServiceEnv(sdk, 'visfail');

  const { image_ids } = env.service.createBatch([{ filename: 'a.png', buffer: tinyPngBuffer(), ext: 'png' }]);
  await env.service.processImage(image_ids[0]);

  const image = getImageRow(env, image_ids[0]);
  assert.equal(image.status, 'FAILED');
  assert.equal(image.validation_status, 'FAILED');
  assert.equal(getAttempts(env, image_ids[0]).length, 0);

  // 校验阶段失败在卡片视图中给出静态失败说明（错误三要素只存在于生成尝试记录）
  assert.equal(env.service.describeImage(image).error_message, '视觉校验失败：模型调用未成功');
});

test('FAILED 重试：attempt_no 递增新建 attempt，UNIQUE(image_id, attempt_no) 生效', async () => {
  const imageError = new Error('第一次生成失败');
  imageError.code = '500';
  imageError.type = 'server_error';

  const sdk = createFakeSdk({ imageError });
  const env = makeServiceEnv(sdk, 'retry');

  const { image_ids } = env.service.createBatch([{ filename: 'a.png', buffer: tinyPngBuffer(), ext: 'png' }]);
  const imageId = image_ids[0];
  await env.service.processImage(imageId);
  assert.equal(getImageRow(env, imageId).status, 'FAILED');

  // 重试仍失败 → attempt_no = 2
  await env.service.retryImage(imageId);
  assert.equal(getImageRow(env, imageId).status, 'FAILED');
  assert.deepEqual(
    getAttempts(env, imageId).map((a) => [a.attempt_no, a.status]),
    [[1, 'FAILED'], [2, 'FAILED']]
  );

  // 恢复成功 → 重试后 SUCCEEDED，attempt_no = 3
  sdk.state.imageError = null;
  await env.service.retryImage(imageId);
  assert.equal(getImageRow(env, imageId).status, 'SUCCEEDED');
  const attempts = getAttempts(env, imageId);
  assert.equal(attempts.length, 3);
  assert.equal(attempts[2].attempt_no, 3);
  assert.equal(attempts[2].status, 'SUCCEEDED');
  assert.equal(attempts[2].erroe_code, null);
  assert.ok(getImageRow(env, imageId).result_image_key);
});

test('重试守卫：仅 FAILED 状态可重试，其余状态返回 INVALID_STATE', async () => {
  const sdk = createFakeSdk();
  const env = makeServiceEnv(sdk, 'guard');

  const { image_ids } = env.service.createBatch([{ filename: 'a.png', buffer: tinyPngBuffer(), ext: 'png' }]);
  await env.service.processImage(image_ids[0]); // → SUCCEEDED

  await assert.rejects(
    () => env.service.retryImage(image_ids[0]),
    (err) => err.code === 'INVALID_STATE'
  );
  await assert.rejects(
    () => env.service.retryImage('no-such-image'),
    (err) => err.code === 'NOT_FOUND'
  );
  // 重试未产生新 attempt
  assert.equal(getAttempts(env, image_ids[0]).length, 1);
});

test('processImage 幂等：非 UPLOADED 状态的图片不再触发流水线', async () => {
  const sdk = createFakeSdk();
  const env = makeServiceEnv(sdk, 'idempotent-flow');

  const { image_ids } = env.service.createBatch([{ filename: 'a.png', buffer: tinyPngBuffer(), ext: 'png' }]);
  await env.service.processImage(image_ids[0]);
  assert.equal(sdk.calls.vision.length, 1);

  await env.service.processImage(image_ids[0]); // 已是 SUCCEEDED，跳过
  await env.service.processImage('no-such-image'); // 不存在，跳过
  assert.equal(sdk.calls.vision.length, 1);
  assert.equal(getAttempts(env, image_ids[0]).length, 1);
});
