'use strict';

const crypto = require('node:crypto');
const originMono = process.hrtime.bigint();
const originUnix = BigInt(Date.now()) * 1000000n;
const functionToString = Function.prototype.call.bind(Function.prototype.toString);

exports.nowNs = () => originUnix + process.hrtime.bigint() - originMono;
exports.nowMs = () => Date.now();
exports.randomBytes = length => new Uint8Array(crypto.randomBytes(length));
exports.functionSource = value => functionToString(value);
