'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');
const { createApp } = require('../src/app');
const { basicAuthHeader, createFakeSdk, makeServiceEnv, tinyPngBuffer, sleep } = require('./helpers');

// extraConfig 可注入 accessPassword 等字段；不传则与原行为一致（不启用访问口令校验）
async function startServer(env, sdk, extraConfig = {}) {
  const { app } = createApp({
    config: { publicDir: path.join(env.dir, 'public'), ...extraConfig },
    db: env.db,
    storage: env.storage,
    sdk,
    logger: env.logger,
  });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'REJECTED']);

async function waitTerminal(base, batchId) {
  for (let i = 0; i < 100; i += 1) {
    const res = await fetch(`${base}/api/batches/${batchId}`);
    const batch = await res.json();
    if (batch.images.every((image) => TERMINAL.has(image.status))) {
      return batch;
    }
    await sleep(20);
  }
  throw new Error('批次未在限时内到达终态');
}

test('API 全链路：上传批次 → 轮询 → 原图/结果图 → 状态守卫', async () => {
  const sdk = createFakeSdk({ requestId: 'req_api_1' });
  const env = makeServiceEnv(sdk, 'api');
  const { server, base } = await startServer(env, sdk);
  test.after(() => server.close());

  // ① 上传：multipart/form-data 字段 images（多文件）
  const form = new FormData();
  form.append('images', new Blob([tinyPngBuffer()], { type: 'image/png' }), 'p1.png');
  form.append('images', new Blob([tinyPngBuffer()], { type: 'image/jpeg' }), 'p2.jpg');
  let res = await fetch(`${base}/api/batches`, { method: 'POST', body: form });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.ok(created.batch_id);
  assert.equal(created.images.length, 2);
  for (const image of created.images) {
    assert.equal(image.status, 'UPLOADED');
    assert.ok(image.image_id);
  }

  // ② 自动异步流水线至终态：全部 SUCCEEDED
  const batch = await waitTerminal(base, created.batch_id);
  for (const image of batch.images) {
    assert.equal(image.status, 'SUCCEEDED');
    assert.equal(image.validation_status, 'PASSED');
    assert.equal(image.has_result, true);
    assert.equal(image.error_message, null);
  }
  assert.ok(batch.created_at);

  // ③ 原图与结果图
  const firstId = batch.images[0].image_id;
  res = await fetch(`${base}/api/images/${firstId}/raw`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/(png|jpeg)/);

  res = await fetch(`${base}/api/images/${firstId}/result`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/png/);

  // ④ 单图详情含最近一次 attempt
  res = await fetch(`${base}/api/images/${firstId}`);
  const detail = await res.json();
  assert.equal(detail.status, 'SUCCEEDED');
  assert.equal(detail.latest_attempt.provider_request_id, 'req_api_1');
  assert.equal(detail.latest_attempt.prompt_version, 'grading-v1');

  // ⑤ 状态守卫：非 FAILED 图片重试 → 409 INVALID_STATE
  res = await fetch(`${base}/api/images/${firstId}/retry`, { method: 'POST' });
  assert.equal(res.status, 409);
  const conflict = await res.json();
  assert.equal(conflict.error.code, 'INVALID_STATE');
});

test('API 校验与错误格式：非法格式 400、缺字段 400、404 统一 JSON', async () => {
  const sdk = createFakeSdk();
  const env = makeServiceEnv(sdk, 'apierr');
  const { server, base } = await startServer(env, sdk);
  test.after(() => server.close());

  // 非 png/jpeg 文件被拒
  const badForm = new FormData();
  badForm.append('images', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'note.txt');
  let res = await fetch(`${base}/api/batches`, { method: 'POST', body: badForm });
  assert.equal(res.status, 400);
  let body = await res.json();
  assert.equal(body.error.code, 'VALIDATION_ERROR');

  // 无 images 文件字段被拒
  const emptyForm = new FormData();
  emptyForm.append('other', new Blob([Buffer.from('x')], { type: 'image/png' }), 'x.png');
  res = await fetch(`${base}/api/batches`, { method: 'POST', body: emptyForm });
  assert.equal(res.status, 400);
  body = await res.json();
  assert.equal(body.error.code, 'VALIDATION_ERROR');

  // 不存在的批次/图片/接口 → 404 统一错误 JSON
  res = await fetch(`${base}/api/batches/no-such-batch`);
  assert.equal(res.status, 404);
  body = await res.json();
  assert.equal(body.error.code, 'NOT_FOUND');

  res = await fetch(`${base}/api/images/no-such-image`);
  assert.equal(res.status, 404);

  res = await fetch(`${base}/api/images/no-such-image/result`);
  assert.equal(res.status, 404);

  res = await fetch(`${base}/api/no-such-endpoint`);
  assert.equal(res.status, 404);
  body = await res.json();
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('非 multipart 请求返回 400 VALIDATION_ERROR', async () => {
  const sdk = createFakeSdk();
  const env = makeServiceEnv(sdk, 'apimime');
  const { server, base } = await startServer(env, sdk);
  test.after(() => server.close());

  const res = await fetch(`${base}/api/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ images: ['x.png'] }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('API 重试链路：FAILED 图片经 retry 接口恢复至 SUCCEEDED', async () => {
  const imageError = new Error('首次生成失败');
  imageError.code = '500';
  imageError.type = 'server_error';
  const sdk = createFakeSdk({ imageError });
  const env = makeServiceEnv(sdk, 'apiretry');
  const { server, base } = await startServer(env, sdk);
  test.after(() => server.close());

  const form = new FormData();
  form.append('images', new Blob([tinyPngBuffer()], { type: 'image/png' }), 'p.png');
  let res = await fetch(`${base}/api/batches`, { method: 'POST', body: form });
  const created = await res.json();
  const [first] = created.images;

  let batch = await waitTerminal(base, created.batch_id);
  assert.equal(batch.images[0].status, 'FAILED');
  assert.match(batch.images[0].error_message, /首次生成失败/);

  // 恢复 fake 成功后重试
  sdk.state.imageError = null;
  res = await fetch(`${base}/api/images/${first.image_id}/retry`, { method: 'POST' });
  assert.equal(res.status, 202);
  const retried = await res.json();
  assert.equal(retried.status, 'GENERATING');

  batch = await waitTerminal(base, created.batch_id);
  assert.equal(batch.images[0].status, 'SUCCEEDED');

  // attempt_no 递增至 2
  const detail = await (await fetch(`${base}/api/images/${first.image_id}`)).json();
  assert.equal(detail.latest_attempt.attempt_no, 2);
  assert.equal(detail.latest_attempt.status, 'SUCCEEDED');
});

test('访问口令校验：配置 accessPassword 后全部请求要求 HTTP Basic', async () => {
  const sdk = createFakeSdk();
  const env = makeServiceEnv(sdk, 'apiauth');
  // 测试服务的静态目录（makeServiceEnv 不含 public/），补一个首页文件供 ③ 校验 200
  fs.mkdirSync(path.join(env.dir, 'public'));
  fs.writeFileSync(path.join(env.dir, 'public', 'index.html'), '<!DOCTYPE html><html><body>ok</body></html>');
  const { server, base } = await startServer(env, sdk, { accessPassword: 'test-pass-123' });
  test.after(() => server.close());

  // ① 无凭据请求 / → 401 且响应头含 WWW-Authenticate，错误体为统一 JSON
  let res = await fetch(`${base}/`);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('www-authenticate'), 'Basic realm="homework-grading"');
  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.equal(body.error.message, '访问口令错误');

  // API 路由同样受保护
  res = await fetch(`${base}/api/batches/no-such-batch`);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('www-authenticate'), 'Basic realm="homework-grading"');

  // ② 错误密码 → 401（用户名不限）
  res = await fetch(`${base}/`, { headers: { authorization: basicAuthHeader('any', 'wrong-pass') } });
  assert.equal(res.status, 401);

  // 长度不等或格式不合法的凭据同样拒绝
  res = await fetch(`${base}/`, { headers: { authorization: 'Basic not-base64!!!' } });
  assert.equal(res.status, 401);

  // ③ 正确凭据（用户名任意）→ 200
  res = await fetch(`${base}/`, { headers: { authorization: basicAuthHeader('any', 'test-pass-123') } });
  assert.equal(res.status, 200);
});
