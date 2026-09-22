'use strict';
// 可选浏览器检查：PLAYWRIGHT_MODULE 指向已安装的 playwright 包；仅使用临时库和fake SDK。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { createApp } = require('../src/app');
const { makeServiceEnv, createFakeSdk, tinyPngBuffer } = require('./helpers');

(async () => {
  const sdk = createFakeSdk();
  const env = makeServiceEnv(sdk, 'browser');
  const { app } = createApp({ config: { publicDir: path.resolve('public'), accessPassword: 'browser-test-only' }, ...env, sdk });
  const proxy = express();
  proxy.use('/apps/homework', app);
  const server = proxy.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const root = `http://127.0.0.1:${server.address().port}/apps/homework/`;
    await page.goto(root);
    await page.waitForURL('**/login.html');
    assert.equal(await page.locator('#password').getAttribute('type'), 'password');
    await page.locator('#password').fill('wrong');
    await page.locator('#login-submit').click();
    await page.locator('#login-error:not([hidden])').waitFor();
    fs.mkdirSync('.cache', { recursive: true });
    await page.screenshot({ path: '.cache/v101-login.png', fullPage: true });
    await page.locator('#username').fill('随便写也可以');
    await page.locator('#password').fill('browser-test-only');
    await page.locator('#login-submit').click();
    await page.waitForURL(root);
    await page.locator('.upload-hint').waitFor();
    await page.reload();
    await page.locator('#upload-btn').waitFor();

    async function upload(verdict) {
      sdk.state.visionResult = verdict;
      await page.locator('#file-input').setInputFiles({ name: 'work.png', mimeType: 'image/png', buffer: tinyPngBuffer() });
      await page.locator('#upload-btn').click();
    }
    await upload({ is_physics: true, grading_advice: '【重新上传】图片有反光，请重新拍摄。' });
    await page.locator('.badge-REJECTED').waitFor();
    assert.match(await page.locator('#modal-message').textContent(), /反光/);
    assert.equal(await page.locator('.badge-REJECTED').textContent(), '请重新拍摄');
    assert.equal(sdk.calls.image.length, 0);
    await page.locator('#modal-close').click();
    assert.equal(await page.locator('.card button').textContent(), '重新上传');
    await page.screenshot({ path: '.cache/v101-quality-mobile.png', fullPage: true });
    await upload({ is_physics: false, grading_advice: '风景照片' });
    await page.locator('.badge-REJECTED').waitFor();
    assert.match(await page.locator('#modal-message').textContent(), /不是高中物理题/);
    await page.locator('#modal-close').click();
    sdk.state.imageError = new Error('fake generation unavailable');
    const advice = '第一题正确打勾；第二题标？字迹有点潦草哦。<img src=x onerror=alert(1)>';
    await upload({ is_physics: true, grading_advice: advice });
    await page.locator('.badge-FAILED').waitFor();
    const visionCalls = sdk.calls.vision.length;
    sdk.state.imageError = null;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('.badge-SUCCEEDED').waitFor();
    assert.equal(sdk.calls.vision.length, visionCalls);
    await page.locator('summary').click();
    assert.equal(await page.locator('.card-advice').textContent(), advice);
    assert.equal(await page.locator('.card-advice img').count(), 0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: '.cache/v101-result-desktop.png', fullPage: true });
    await page.locator('.card-thumb').click();
    assert.equal(await page.locator('#lightbox').isVisible(), true);
    await page.locator('#lightbox-close').click();
    const cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    await page.locator('#logout-btn').click();
    await page.waitForURL('**/login.html');
    const status = await fetch(root + 'api/batches/missing', { headers: { cookie } });
    assert.equal(status.status, 401);
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed: login/error/refresh, subpath, quality and subject rejection, retry reuse, safe text, lightbox, logout; mobile and desktop screenshots saved in .cache.');
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
    env.db.close();
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
