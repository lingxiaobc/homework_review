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

app.listen(config.port, () => {
  logger.info(`学生作业批改系统已启动：http://localhost:${config.port}`);
});
