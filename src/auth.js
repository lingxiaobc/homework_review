'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');

const COOKIE = 'homework_session';
const TTL_MS = 12 * 60 * 60 * 1000;

function passwordEquals(provided, expected) {
  if (typeof provided !== 'string') return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function installAuth(app, config) {
  const sessions = new Map(); // 重启失效，不保存密码或用户名。
  const ttl = config.sessionTtlMs ?? TTL_MS;
  const cookieOptions = (req) => ({ httpOnly: true, sameSite: 'strict', secure: Boolean(config.secureCookies || req.secure), path: '/' });
  const tokenOf = (req) => {
    const part = (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(`${COOKIE}=`));
    return part ? part.slice(COOKIE.length + 1) : '';
  };
  const clearExpired = () => {
    for (const [token, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(token);
  };
  const authenticated = (req) => {
    if (!config.accessPassword) return true;
    clearExpired();
    if (sessions.has(tokenOf(req))) return true;
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) return false;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator >= 0 && passwordEquals(decoded.slice(separator + 1), config.accessPassword);
  };
  const deny = (res) => res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '访问口令错误或登录已过期' } });
  const sameOrigin = (req, res, next) => {
    const origin = req.get('origin');
    let invalid = req.get('sec-fetch-site') === 'cross-site';
    if (origin) {
      try { invalid ||= new URL(origin).host !== req.get('host'); } catch { invalid = true; }
    }
    if (invalid) return res.status(403).json({ error: { code: 'FORBIDDEN', message: '请从本网站提交请求' } });
    next();
  };
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/auth/session', (req, res) => {
    res.json({ authenticated: authenticated(req), password_required: Boolean(config.accessPassword) });
  });
  app.post('/api/auth/login', sameOrigin, express.json({ limit: '8kb' }), (req, res) => {
    if (config.accessPassword && !passwordEquals(req.body?.password, config.accessPassword)) return deny(res);
    clearExpired();
    sessions.delete(tokenOf(req));
    // 有界会话存储；达到上限时淘汰最早会话。
    if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + ttl);
    res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: ttl });
    res.json({ authenticated: true });
  });
  app.post('/api/auth/logout', sameOrigin, (req, res) => {
    sessions.delete(tokenOf(req));
    res.clearCookie(COOKIE, cookieOptions(req));
    res.json({ authenticated: false });
  });
  // 登录页不依赖认证；仅放行列出的页面资源。
  for (const name of ['login.html', 'login.js', 'style.css']) {
    app.get(`/${name}`, (req, res) => res.sendFile(path.join(config.publicDir, name)));
  }
  app.use((req, res, next) => {
    if (authenticated(req)) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return sameOrigin(req, res, next);
      return next();
    }
    // 相对重定向兼容反代子路径，API不发Basic挑战，避免浏览器弹窗。
    if ((req.path === '/' || req.path === '/index.html') && req.method === 'GET') return res.redirect('login.html');
    return deny(res);
  });
}

module.exports = { installAuth };
