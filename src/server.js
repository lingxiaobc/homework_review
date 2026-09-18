'use strict';

const path = require('path');
const config = require('./config');
const { openDatabase } = require('./db/database');
const { createLogger } = require('./logger');
const { createStorage } = require('./services/storage');
const { createZenMuxSdk } = require('./sdk/zenmux');
const { createApp } = require('./app');

const logger = createLogger({ logFile: path.join(config.logDir, 'app.log') });
const db = openDatabase(config.dbPath);
const storage = createStorage({ rootDir: config.rootDir });
const sdk = createZenMuxSdk(config.zenmux);
const { app } = createApp({ config, db, storage, sdk, logger });

// 本地单用户 MVP：仅绑定回环地址
if (!config.accessPassword) {
  logger.warn('未设置 HOMEWORK_ACCESS_PASSWORD，访问口令校验未启用；公网部署必须配置');
}

app.listen(config.port, '127.0.0.1', () => {
  logger.info(`学生作业批改系统已启动：http://localhost:${config.port}`);
});
