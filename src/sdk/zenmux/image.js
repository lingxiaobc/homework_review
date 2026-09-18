'use strict';

const { ZenMuxError } = require('./client');

// 生图 API：POST /images/edits（图片编辑，multipart/form-data，携带学生作业原图）
// 实测参数组合（2026-09-18，docs/zenmux-protocol-notes.md）：
// - 字段：model、prompt、image（文件：Blob 携带 MIME 与文件名）、size、input_fidelity（固定 "high"，实测被接受）；
// - size 仅三档：1536x1024（横）/ 1024x1024（方）/ 1024x1536（竖），
//   按原图像素探测映射（探测失败回退 1024x1024），1536x1024 实测被接受且输出同尺寸；
// - 同步返回 data[0].b64_json（响应顶层新增 usage 字段可忽略），实测耗时约 82s —— 超时须 >= 120s。

// 原图像素尺寸探测（零依赖）：
// - PNG：IHDR 块固定位于文件头，第 16 字节起大端 4 字节宽 + 4 字节高；
// - JPEG：扫描 marker 段，读 SOF 帧头（0xC0-0xCF，排除 DHT/JPG/DAC）中的高宽。
function detectImageSize(buffer) {
  try {
    if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        // 非段标记（SOI/EOI/RSTn）直接跳过
        if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd9)) {
          offset += 2;
          continue;
        }
        const segLen = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + segLen;
      }
    }
  } catch {
    // 探测失败走回退 size
  }
  return null;
}

// edits 接口 size 三档映射：宽>高→横、高>宽→竖、相等（或探测失败）→方
function pickEditSize(buffer) {
  const size = detectImageSize(buffer);
  if (!size || !size.width || !size.height) {
    return '1024x1024';
  }
  if (size.width > size.height) {
    return '1536x1024';
  }
  if (size.width < size.height) {
    return '1024x1536';
  }
  return '1024x1024';
}

function createImageApi(client, { model, timeoutMs }) {
  return {
    modelId: model,

    /**
     * @param {string} prompt 生图提示词
     * @param {{buffer: Buffer, mimeType: string, fileName: string}} originalImage 学生作业原图
     * @returns {Promise<{b64_json: string, requestId: string|null}>}
     */
    async generateImage(prompt, originalImage) {
      // multipart 透传给 fetch（不手动设 Content-Type，由 fetch 自动生成 boundary）
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append(
        'image',
        new Blob([originalImage.buffer], { type: originalImage.mimeType }),
        originalImage.fileName
      );
      form.append('size', pickEditSize(originalImage.buffer));
      form.append('input_fidelity', 'high');

      const { data, requestId } = await client.request('/images/edits', {
        body: form,
        timeoutMs,
      });

      const b64_json = data && data.data && data.data[0] ? data.data[0].b64_json : undefined;
      if (!b64_json) {
        throw new ZenMuxError({
          code: 'IMAGE_PARSE_ERROR',
          type: 'protocol',
          message: '生图响应缺少 data[0].b64_json',
          requestId,
        });
      }

      return { b64_json, requestId };
    },
  };
}

module.exports = { createImageApi };
