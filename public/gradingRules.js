(function (root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.GradingRules = rules;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const REUPLOAD_PREFIX = '【重新上传】';
  function validateVerdict(value) {
    if (!value || Array.isArray(value) || typeof value !== 'object' ||
        Object.keys(value).length !== 2 || typeof value.is_physics !== 'boolean' ||
        typeof value.grading_advice !== 'string' || !value.grading_advice.trim()) {
      throw new Error('审核输出必须包含且仅包含 is_physics 布尔值和非空 grading_advice 字符串');
    }
    const advice = value.grading_advice.trim();
    if (advice.startsWith(REUPLOAD_PREFIX) && !advice.slice(REUPLOAD_PREFIX.length).trim()) {
      throw new Error('重新上传标记后必须说明原因');
    }
    return { is_physics: value.is_physics, grading_advice: advice };
  }
  function rejection(value) {
    const advice = typeof value.grading_advice === 'string' ? value.grading_advice.trim() : '';
    if (advice.startsWith(REUPLOAD_PREFIX)) {
      return { kind: 'quality', label: '请重新拍摄', message: advice.slice(REUPLOAD_PREFIX.length).trim() };
    }
    if (value.is_physics === false) {
      return { kind: 'subject', label: '非物理题', message: '该图片不是高中物理题，请上传物理作业图片。' };
    }
    return null;
  }
  function rejectionMessage(value) {
    return rejection(value)?.message || '该图片未通过旧版审核，请重新上传。';
  }
  return { REUPLOAD_PREFIX, validateVerdict, rejection, rejectionMessage };
});
