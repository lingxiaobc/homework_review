'use strict';

// 生图批改提示词：在学生原图上进行批改标注
const GRADING_PROMPT = [
  '请作为高中物理老师的标注助手，严格依据提供的批改建议，在学生作业原图上添加标记。不得自行重新判题或新增批改结论。要求：',
  '1. 保留原图题目与学生作答，不重写、不替换、不补全难辨认的笔迹。',
  '2. 仅圈出批改建议指定的错误位置，并添加指定附注。',
  '3. 正确题按建议打勾；字迹难辨认的指定区域标注“？”及温和提示，不打勾、不圈错。',
  '4. 批改字迹清晰工整，使用简体中文，标注不得遮挡学生原始作答的关键内容。',
].join('\n');

// 提示词版本号：每次生图调用写入 generation_attempts.prompt_version
const PROMPT_VERSION = 'grading-v1.0.1';

module.exports = { GRADING_PROMPT, PROMPT_VERSION };
