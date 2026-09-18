'use strict';

const busboy = require('busboy');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 单个文件 10MB
const MAX_FILES = 20; // 单次最多 20 个文件

// 解析 multipart/form-data 请求体，返回文件列表：
// [{ fieldname, filename, mime, buffer }]
function parseMultipartFiles(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
      });
    } catch (err) {
      const error = new Error('请求必须是 multipart/form-data 编码');
      error.code = 'VALIDATION_ERROR';
      return reject(error);
    }

    const files = [];
    let limitMessage = null;
    bb.on('file', (fieldname, stream, info) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('limit', () => {
        if (!limitMessage) {
          limitMessage = `单个文件超过 ${MAX_FILE_SIZE / (1024 * 1024)}MB 限制：${info.filename || '未命名文件'}`;
        }
      });
      stream.on('end', () => {
        files.push({
          fieldname,
          filename: info.filename,
          mime: info.mimeType,
          buffer: Buffer.concat(chunks),
        });
      });
      stream.on('error', reject);
    });
    bb.on('filesLimit', () => {
      if (!limitMessage) {
        limitMessage = `单次最多上传 ${MAX_FILES} 个文件`;
      }
    });
    bb.on('error', reject);
    bb.on('close', () => {
      if (limitMessage) {
        const error = new Error(limitMessage);
        error.code = 'VALIDATION_ERROR';
        return reject(error);
      }
      resolve(files);
    });

    req.pipe(bb);
  });
}

module.exports = { parseMultipartFiles };
