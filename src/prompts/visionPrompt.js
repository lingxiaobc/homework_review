'use strict';

// 视觉审核指令：短、固定、不外显。
// 仅随 SDK 请求发往视觉模型，不得出现在任何 API 响应或前端代码中。
const VISION_PROMPT = [
  '判断这张图片是否与高中物理题相关（物理题目文本、公式、受力或电路等示意图、学生解题过程均算相关）。',
  '只输出 JSON 对象：{"is_physics": 布尔值，"reason": "不超过 50 字的简要理由"}。',
].join('\n');

module.exports = { VISION_PROMPT };
