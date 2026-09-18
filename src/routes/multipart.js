'use strict';

const busboy = require('busboy');

// 解析 multipart/form-data 请求体，返回文件列表：
// [{ fieldname, filename, mime, buffer }]
function parseMultipartFiles(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({ headers: req.headers });
    } catch (err) {
      const error = new Error('请求必须是 multipart/form-data 编码');
      error.code = 'VALIDATION_ERROR';
      return reject(error);
    }

    const files = [];
    bb.on('file', (fieldname, stream, info) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
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
    bb.on('error', reject);
    bb.on('close', () => resolve(files));

    req.pipe(bb);
  });
}

module.exports = { parseMultipartFiles };
