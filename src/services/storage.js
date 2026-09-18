'use strict';

const fs = require('fs');
const path = require('path');

// 本地文件系统模拟对象存储：
// - 原图 key：data/uploads/<batch_id>/<image_id>.<ext>
// - 结果图 key：data/results/<image_id>.png
// key 即相对路径字符串，随 raw_image_key / result_image_key 落库。
function createStorage({ rootDir }) {
  function resolveKey(key) {
    const abs = path.join(rootDir, key);
    // 防御纵深：解析结果必须仍位于 rootDir 内，防止 key 携带 .. 越界
    const rel = path.relative(rootDir, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`非法的存储 key（越界）：${key}`);
    }
    return abs;
  }

  function write(key, buffer) {
    const abs = resolveKey(key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
    return key;
  }

  return {
    saveRawImage(batchId, imageId, buffer, ext) {
      return write(path.posix.join('data', 'uploads', batchId, `${imageId}.${ext}`), buffer);
    },

    saveResultImage(imageId, buffer) {
      return write(path.posix.join('data', 'results', `${imageId}.png`), buffer);
    },

    readRaw(key) {
      return fs.readFileSync(resolveKey(key));
    },

    exists(key) {
      return fs.existsSync(resolveKey(key));
    },

    resolveKey,
  };
}

module.exports = { createStorage };
