'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Database = require('better-sqlite3');
const { openDatabase, SCHEMA_SQL } = require('../src/db/database');
const { createVisionApi } = require('../src/sdk/zenmux/vision');
const { createApp } = require('../src/app');
const { createFakeSdk, makeServiceEnv, tinyPngBuffer, basicAuthHeader } = require('./helpers');
const rules = require('../public/gradingRules');

function imageFor(env) {
  return env.service.createBatch([{ filename: 'a.png', buffer: tinyPngBuffer(), ext: 'png' }]).image_ids[0];
}
function dispose(t, env) { t.after(() => env.db.close()); }

test('SDK两字段协议：严格拒绝缺字段、额外字段、错误类型、空建议与缺少打回原因', async () => {
  let content;
  let sent;
  const sdk = createVisionApi({ async request(url, opts) { sent = opts.body; return { data: { choices: [{ message: { content } }] } }; } }, { model: 'fake', timeoutMs: 1 });
  for (const invalid of [null, [], {}, { is_physics: true, reason: '旧协议' },
    { is_physics: 'true', grading_advice: '正常' }, { is_physics: true, grading_advice: ' ' },
    { is_physics: true, grading_advice: '【重新上传】 ' },
    { is_physics: true, grading_advice: '正常', extra: 1 }]) {
    content = JSON.stringify(invalid);
    await assert.rejects(sdk.validateImage('data:image/png;base64,x'), { code: 'VISION_SCHEMA_ERROR' });
  }
  content = 'not json';
  await assert.rejects(sdk.validateImage('x'), { code: 'VISION_PARSE_ERROR' });
  content = JSON.stringify({ is_physics: true, grading_advice: ' 第1题打勾 ' });
  assert.deepEqual(await sdk.validateImage('x'), { is_physics: true, grading_advice: '第1题打勾' });
  assert.deepEqual(sent.response_format.json_schema.schema.required, ['is_physics', 'grading_advice']);
});

for (const is_physics of [true, false]) {
  test(`质量前缀优先：${is_physics}＋前缀拒绝，保存结果且零生图`, async (t) => {
    const sdk = createFakeSdk({ visionResult: { is_physics, grading_advice: '  【重新上传】有反光，请重新拍摄  ' } });
    const env = makeServiceEnv(sdk, 'quality'); dispose(t, env);
    const id = imageFor(env);
    await env.service.processImage(id);
    const detail = env.service.getImageDetail(id);
    assert.equal(detail.status, 'REJECTED');
    assert.equal(detail.validation_status, 'REJECTED');
    assert.equal(detail.is_physics, is_physics);
    assert.equal(detail.grading_advice, '【重新上传】有反光，请重新拍摄');
    assert.equal(sdk.calls.image.length, 0);
    assert.equal(detail.latest_attempt, null);
    assert.equal(rules.rejection(detail).kind, 'quality');
    assert.throws(() => env.service.startRetry(id), { code: 'INVALID_STATE' });
  });
}

test('正文关键词不拒绝，生图收到保存建议，失败重试不重复审核', async (t) => {
  const advice = '第1题正确打勾。第2题字迹潦草难辨认，标注“？字迹有点潦草哦”，不要把字迹称为图片模糊。';
  const sdk = createFakeSdk({ visionResult: { is_physics: true, grading_advice: advice }, imageError: new Error('test failure') });
  const env = makeServiceEnv(sdk, 'reuse'); dispose(t, env);
  const id = imageFor(env);
  await env.service.processImage(id);
  assert.equal(env.service.getImageDetail(id).status, 'FAILED');
  sdk.state.imageError = null;
  sdk.state.visionResult = { is_physics: false, grading_advice: '不应读取这条新结果' };
  await env.service.retryImage(id);
  assert.equal(sdk.calls.vision.length, 1);
  assert.equal(sdk.calls.image.length, 2);
  assert.equal(sdk.calls.image[0], sdk.calls.image[1]);
  assert.ok(sdk.calls.image[1].includes(advice));
  assert.equal(env.service.getImageDetail(id).status, 'SUCCEEDED');
});

test('审核失败及旧记录重试必须重新审核，重复点击不重复启动', async (t) => {
  const sdk = createFakeSdk({ visionResult: { is_physics: true, grading_advice: '' } });
  const env = makeServiceEnv(sdk, 'retry-vision'); dispose(t, env);
  const id = imageFor(env);
  await env.service.processImage(id);
  assert.equal(env.service.getImageDetail(id).status, 'FAILED');
  assert.equal(sdk.calls.image.length, 0);
  let release;
  sdk.vision.validateImage = () => new Promise((resolve) => { release = resolve; });
  assert.equal(env.service.startRetry(id), 'VALIDATING');
  assert.throws(() => env.service.startRetry(id), { code: 'INVALID_STATE' });
  release({ is_physics: true, grading_advice: '第1题打勾' });
  await new Promise((r) => setImmediate(r));
  assert.equal(env.service.getImageDetail(id).status, 'SUCCEEDED');
  const old = imageFor(env);
  env.db.prepare("UPDATE images SET status='FAILED', validation_status='PASSED' WHERE image_id=?").run(old);
  sdk.vision.validateImage = async () => ({ is_physics: false, grading_advice: '非物理题' });
  await env.service.retryImage(old);
  assert.equal(env.service.getImageDetail(old).status, 'REJECTED');
});

test('保存审核结果失败不会生图，状态进入FAILED', async (t) => {
  const sdk = createFakeSdk(); const env = makeServiceEnv(sdk, 'write-fail'); dispose(t, env);
  const id = imageFor(env);
  env.db.exec("CREATE TRIGGER fail_advice BEFORE UPDATE OF grading_advice ON images BEGIN SELECT RAISE(ABORT, 'write failed'); END");
  await env.service.processImage(id);
  const detail = env.service.getImageDetail(id);
  assert.equal(detail.status, 'FAILED');
  assert.equal(detail.is_physics, null);
  assert.equal(detail.grading_advice, null);
  assert.equal(sdk.calls.image.length, 0);
});

test('初次审核状态写入异常转为FAILED，不永久停在VALIDATING', async (t) => {
  const sdk = createFakeSdk(); const env = makeServiceEnv(sdk, 'stage-fail'); dispose(t, env);
  const id = imageFor(env);
  env.db.exec("CREATE TRIGGER fail_pending BEFORE UPDATE OF validation_status ON images WHEN NEW.validation_status='PENDING' BEGIN SELECT RAISE(ABORT, 'stage failed'); END");
  env.service.startBatchProcessing([id]);
  await new Promise((r) => setImmediate(r));
  assert.equal(env.service.getImageDetail(id).status, 'FAILED');
  assert.equal(sdk.calls.image.length, 0);
});

test('真实旧表增量迁移：历史成功记录保留、空值不转false、重复打开安全', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grading-migration-'));
  const file = path.join(dir, 'legacy.db');
  const old = new Database(file);
  old.exec(SCHEMA_SQL.replace(/^.*is_physics.*\r?\n/m, '').replace(/^.*grading_advice.*\r?\n/m, ''));
  old.exec("INSERT INTO batches VALUES ('b', 'old'); INSERT INTO images (image_id,batch_id,raw_image_key,result_image_key,status,created_at,updated_at) VALUES ('i','b','raw.png','result.png','SUCCEEDED','old','old')");
  old.close();
  for (let i = 0; i < 2; i++) {
    const db = openDatabase(file);
    const row = db.prepare('SELECT * FROM images').get();
    assert.equal(row.status, 'SUCCEEDED'); assert.equal(row.result_image_key, 'result.png');
    assert.equal(row.is_physics, null); assert.equal(row.grading_advice, null);
    assert.throws(() => db.exec('UPDATE images SET is_physics=2'), /CHECK/);
    db.close();
  }
});

async function authServer(t, config = {}) {
  const env = makeServiceEnv(createFakeSdk(), 'auth-v101');
  const { app } = createApp({ config: { publicDir: path.resolve('public'), accessPassword: 'test-only-password', ...config }, ...env, sdk: createFakeSdk() });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); env.db.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function login(base, username, password = 'test-only-password') {
  return fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
}

test('网页登录：任意/空用户名、错误密码、会话资源保护、退出撤销与Basic兼容', async (t) => {
  const base = await authServer(t);
  for (const url of ['/login.html', '/login.js', '/style.css']) assert.equal((await fetch(base + url)).status, 200);
  for (const url of ['/api/batches/missing', '/api/images/missing/raw', '/api/images/missing/result', '/app.js']) assert.equal((await fetch(base + url)).status, 401);
  assert.equal((await login(base, 'any', 'wrong')).status, 401);
  for (const username of ['', '任意用户名', 'different']) {
    const res = await login(base, username);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie'), /HttpOnly/);
    assert.match(res.headers.get('set-cookie'), /SameSite=Strict/);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/', { headers: { cookie } })).status, 200);
    assert.equal((await fetch(base + '/api/images/missing/raw', { headers: { cookie } })).status, 404);
    assert.equal((await fetch(base + '/api/auth/session', { headers: { cookie } }).then((r) => r.json())).authenticated, true);
    assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie } })).status, 200);
    assert.equal((await fetch(base + '/api/batches/missing', { headers: { cookie } })).status, 401);
  }
  assert.equal((await fetch(base + '/api/batches/missing', { headers: { authorization: basicAuthHeader('any', 'test-only-password') } })).status, 404);
  assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers: { origin: 'https://other.example' } })).status, 403);
  const proxiedStatus = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/auth/login', {
      method: 'POST', headers: { host: 'school.example:8443', origin: 'https://school.example:8443', 'Content-Type': 'application/json' },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(JSON.stringify({ password: 'test-only-password' }));
  });
  assert.equal(proxiedStatus, 200);
});

test('会话到期、服务重启失效、Secure cookie配置和无密码模式', async (t) => {
  const base = await authServer(t, { sessionTtlMs: 20, secureCookies: true });
  const res = await login(base, '');
  assert.match(res.headers.get('set-cookie'), /Secure/);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  await new Promise((r) => setTimeout(r, 35));
  assert.equal((await fetch(base + '/api/batches/missing', { headers: { cookie } })).status, 401);
  const nextBase = await authServer(t);
  assert.equal((await fetch(nextBase + '/api/batches/missing', { headers: { cookie } })).status, 401);
  const openBase = await authServer(t, { accessPassword: '' });
  const session = await fetch(openBase + '/api/auth/session').then((r) => r.json());
  assert.deepEqual(session, { authenticated: true, password_required: false });
});

test('前端共享分流：旧数据fallback和非物理提示不读取HTML', () => {
  assert.equal(rules.rejectionMessage({ is_physics: null, grading_advice: null }), '该图片未通过旧版审核，请重新上传。');
  assert.equal(rules.rejection({ is_physics: false, grading_advice: '普通文字' }).kind, 'subject');
  assert.equal(rules.rejection({ is_physics: true, grading_advice: '潦草，标问号，不是模糊打回' }), null);
});
