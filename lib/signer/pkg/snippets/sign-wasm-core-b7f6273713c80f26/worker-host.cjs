'use strict';
const { isMainThread } = require('node:worker_threads');
exports.isWorkerThread = () => !isMainThread;
