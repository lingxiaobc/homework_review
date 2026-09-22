'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

// 打开 SQLite 连接并执行幂等建表。每次调用返回独立连接。
function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  // CREATE TABLE IF NOT EXISTS 不会更新旧表，迁移只加列，不重跑历史任务。
  db.transaction(() => {
    const columns = new Set(db.prepare('PRAGMA table_info(images)').all().map((c) => c.name));
    if (!columns.has('is_physics')) db.exec('ALTER TABLE images ADD COLUMN is_physics INTEGER CHECK (is_physics IN (0, 1))');
    if (!columns.has('grading_advice')) db.exec('ALTER TABLE images ADD COLUMN grading_advice TEXT');
  })();
  return db;
}

module.exports = { openDatabase, SCHEMA_SQL };
