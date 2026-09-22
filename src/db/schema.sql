-- 学生作业批改系统 V1.0.0 数据库结构
-- 幂等建表：全部使用 CREATE TABLE IF NOT EXISTS
-- 枚举一律用 CHECK 约束落库；时间为业务时间语义（ISO 8601 字符串）

-- 批次表：一次上传 = 一个批次。
-- 批次与图片为 1:N，由 images.batch_id 表达，本表不存图片 ID 列表。
CREATE TABLE IF NOT EXISTS batches (
  batch_id   TEXT PRIMARY KEY, -- uuid
  created_at TEXT NOT NULL     -- ISO 8601 业务时间
);

-- 图片表：一张学生作业原图及其批改状态
CREATE TABLE IF NOT EXISTS images (
  image_id          TEXT PRIMARY KEY, -- uuid
  batch_id          TEXT NOT NULL REFERENCES batches(batch_id),
  raw_image_key     TEXT NOT NULL,    -- 原图对象存储 key（相对路径）
  validation_status TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (validation_status IN ('PENDING', 'PASSED', 'REJECTED', 'FAILED')),
  status            TEXT NOT NULL DEFAULT 'UPLOADED'
                    CHECK (status IN ('UPLOADED', 'VALIDATING', 'READY', 'GENERATING', 'SUCCEEDED', 'FAILED', 'REJECTED')),
  result_image_key  TEXT,             -- 批改结果图 key，成功后写入；可为 NULL
  is_physics        INTEGER CHECK (is_physics IN (0, 1)),
  grading_advice    TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_batch_id ON images(batch_id);

-- 生成尝试表：每次生图调用记录一次尝试
-- 注意：erroe_code 为设计文档原文拼写（按设计要求保留，不作更正），成功时为 NULL。
CREATE TABLE IF NOT EXISTS generation_attempts (
  attempt_id          TEXT PRIMARY KEY, -- uuid
  image_id            TEXT NOT NULL REFERENCES images(image_id),
  attempt_no          INTEGER NOT NULL,
  model_id            TEXT NOT NULL,
  prompt_version      TEXT NOT NULL,
  status              TEXT NOT NULL
                      CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED')),
  provider_request_id TEXT,             -- 取自响应头 X-ZenMux-RequestId；可为 NULL
  started_at          TEXT NOT NULL,
  finished_at         TEXT,             -- 成功/失败结束时写入
  latency_ms          INTEGER,
  erroe_code          TEXT,             -- 设计文档原文拼写（error_code 之误），按设计保留；成功时为 NULL
  error_type          TEXT,
  error_message       TEXT,
  UNIQUE (image_id, attempt_no)
);
