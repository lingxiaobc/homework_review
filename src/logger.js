'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR' };

// 日志双写：logs/app.log + 控制台
function createLogger({ logFile, enableConsole = true }) {
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
  }

  function write(level, message, meta) {
    let line = `${new Date().toISOString()} [${LEVELS[level]}] ${message}`;
    if (meta !== undefined) {
      line += ` ${JSON.stringify(meta)}`;
    }
    if (enableConsole) {
      (level === 'error' ? console.error : console.log)(line);
    }
    if (logFile) {
      fs.appendFileSync(logFile, `${line}\n`);
    }
  }

  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

module.exports = { createLogger };
