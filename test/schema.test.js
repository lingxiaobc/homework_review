'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase, SCHEMA_SQL } = require('../src/db/database');

function makeDb(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `grading-schema-${label}-`));
  return openDatabase(path.join(dir, 'test.db'));
}

function insertBatch(db, batchId = 'batch-1') {
  db.prepare('INSERT INTO batches (batch_id, created_at) VALUES (?, ?)').run(batchId, '2026-09-18T00:00:00.000Z');
}

function insertImage(db, imageId = 'img-1', batchId = 'batch-1') {
  db.prepare(
    `INSERT INTO images (image_id, batch_id, raw_image_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(imageId, batchId, `data/uploads/${batchId}/${imageId}.png`, '2026-09-18T00:00:00.000Z', '2026-09-18T00:00:00.000Z');
}

test('建表 SQL 幂等：openDatabase 已执行一次，连续再执行两次不报错', () => {
  const db = makeDb('idempotent');
  db.exec(SCHEMA_SQL);
  db.exec(SCHEMA_SQL);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
  for (const expected of ['batches', 'images', 'generation_attempts']) {
    assert.ok(tables.includes(expected), `应存在表 ${expected}`);
  }
  // 无重复建表
  assert.equal(tables.filter((name) => name === 'images').length, 1);
});

test('batches 表：字段与主键生效', () => {
  const db = makeDb('batches');
  insertBatch(db, 'b-a');
  // 主键冲突被拒
  assert.throws(() => insertBatch(db, 'b-a'), /UNIQUE/);
  const row = db.prepare('SELECT batch_id, created_at FROM batches WHERE batch_id = ?').get('b-a');
  assert.equal(row.created_at, '2026-09-18T00:00:00.000Z');
});

test('images 表：默认值、可空 result_image_key 与 CHECK 枚举生效', () => {
  const db = makeDb('images');
  insertBatch(db);
  insertImage(db, 'img-ok');

  const row = db.prepare('SELECT * FROM images WHERE image_id = ?').get('img-ok');
  assert.equal(row.validation_status, 'PENDING');
  assert.equal(row.status, 'UPLOADED');
  assert.equal(row.result_image_key, null);

  // 非法 validation_status 枚举被拒
  assert.throws(
    () =>
      db.prepare('UPDATE images SET validation_status = ? WHERE image_id = ?').run('BOGUS', 'img-ok'),
    /CHECK/
  );
  // 非法 status 枚举被拒
  assert.throws(
    () => db.prepare('UPDATE images SET status = ? WHERE image_id = ?').run('BOGUS', 'img-ok'),
    /CHECK/
  );
  // 合法枚举全部可写
  for (const status of ['PASSED', 'REJECTED', 'FAILED']) {
    db.prepare('UPDATE images SET validation_status = ? WHERE image_id = ?').run(status, 'img-ok');
  }
  for (const status of ['VALIDATING', 'READY', 'GENERATING', 'SUCCEEDED', 'FAILED', 'REJECTED']) {
    db.prepare('UPDATE images SET status = ? WHERE image_id = ?').run(status, 'img-ok');
  }
});

test('images 表：外键约束生效（batch_id 必须存在于 batches）', () => {
  const db = makeDb('fk');
  assert.throws(() => insertImage(db, 'img-orphan', 'no-such-batch'), /FOREIGN KEY/);
});

test('generation_attempts 表：字段、CHECK 枚举与 UNIQUE(image_id, attempt_no) 生效', () => {
  const db = makeDb('attempts');
  insertBatch(db);
  insertImage(db, 'img-1');

  const insertAttempt = db.prepare(
    `INSERT INTO generation_attempts
       (attempt_id, image_id, attempt_no, model_id, prompt_version, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insertAttempt.run('att-1', 'img-1', 1, 'm-1', 'grading-v1', 'PROCESSING', '2026-09-18T00:00:00.000Z');

  // 非法 status 枚举被拒
  assert.throws(
    () => insertAttempt.run('att-x', 'img-1', 2, 'm-1', 'grading-v1', 'BOGUS', '2026-09-18T00:00:00.000Z'),
    /CHECK/
  );

  // UNIQUE(image_id, attempt_no)：重复 attempt_no 被拒
  assert.throws(
    () => insertAttempt.run('att-2', 'img-1', 1, 'm-1', 'grading-v1', 'PROCESSING', '2026-09-18T00:00:00.000Z'),
    /UNIQUE/
  );

  // 同图递增 attempt_no 可写；erroe_code 按设计原文拼写存在且成功时为 NULL
  insertAttempt.run('att-3', 'img-1', 2, 'm-1', 'grading-v1', 'PROCESSING', '2026-09-18T00:00:00.000Z');
  const columns = db.prepare('PRAGMA table_info(generation_attempts)').all().map((col) => col.name);
  for (const expected of [
    'attempt_id',
    'image_id',
    'attempt_no',
    'model_id',
    'prompt_version',
    'status',
    'provider_request_id',
    'started_at',
    'finished_at',
    'latency_ms',
    'erroe_code',
    'error_type',
    'error_message',
  ]) {
    assert.ok(columns.includes(expected), `应存在字段 ${expected}`);
  }
  const attempt = db.prepare('SELECT erroe_code, error_type FROM generation_attempts WHERE attempt_id = ?').get('att-1');
  assert.equal(attempt.erroe_code, null);
  assert.equal(attempt.error_type, null);

  // 外键：image_id 必须存在于 images
  assert.throws(
    () => insertAttempt.run('att-4', 'no-such-image', 1, 'm-1', 'grading-v1', 'PROCESSING', '2026-09-18T00:00:00.000Z'),
    /FOREIGN KEY/
  );
});
