/**
 * QSign API 公共模块
 * 封装所有与 qsign 服务器交互的通用逻辑
 */
"use strict";

const _axios = require("axios");
const http = require("http");
const https = require("https");

const API_WAIT_TIME = 45000;
const MAX_RETRY = 3;

const axios = _axios.create({
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: API_WAIT_TIME,
    headers: {
        'User-Agent': "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.5249.199 Safari/537.36 OICQ/1.26 ILPP/2",
        'Content-Type': "application/x-www-form-urlencoded"
    }
});

/**
 * 构建 qsign API URL
 * @param {string} baseAddr 基础地址
 * @param {string} endpoint 端点路径
 * @returns {string}
 */
function buildUrl(baseAddr, endpoint) {
    let url = baseAddr;
    if (url[url.length - 1] !== '/') {
        url += '/';
    }
    return url + endpoint;
}

/**
 * 获取 qsign API 公共参数
 * @this {import("./ref").Client}
 * @param {object} [extraParams] 额外参数
 * @returns {object}
 */
function getCommonParams(extraParams = {}) {
    return {
        ver: this.apk.ver,
        android_id: this.device.android_id,
        androidId: this.device.android_id,
        qimei36: this.device.qimei36 || this.device.qimei16 || this.device.android_id,
        guid: this.device.guid.toString('hex'),
        uin: this.uin,
        key: this.config.sign_api_key,
        qua: this.apk.qua,
        ...extraParams,
    };
}

/**
 * 发送 qsign GET 请求
 * @param {string} url 
 * @param {object} params 
 * @returns {Promise<object>}
 */
async function qsignGet(url, params) {
    const { data } = await axios.get(url, { params })
        .catch((e) => ({ data: { code: -1, msg: e ? e.message : 'failed to connect to qsign api' } }));
    return data;
}

/**
 * 发送 qsign POST 请求
 * @param {string} url 
 * @param {object} body 
 * @returns {Promise<object>}
 */
async function qsignPost(url, body) {
    const { data } = await axios.post(url, body)
        .catch((e) => ({ data: { code: -1, msg: e ? e.message : 'failed to connect to qsign api' } }));
    return data;
}

/**
 * 执行带重试的 qsign API 调用
 * @param {function} apiFn 实际 API 调用函数
 * @param {string} apiName API 名称（用于日志）
 * @param {object} options 选项
 * @param {boolean} [options.throwOnError=false] 是否在失败时抛出错误
 * @param {boolean} [options.handleNotRegistered=false] 是否处理 "not registered" 错误
 * @param {function} [options.onNotRegistered] 处理 "not registered" 的回调
 * @param {number} [options.retry=0] 当前重试次数
 * @returns {Promise<object>}
 */
async function executeWithRetry(apiFn, apiName, options = {}) {
    const {
        throwOnError = false,
        handleNotRegistered = false,
        onNotRegistered = null,
        retry = 0,
        logger = console,
    } = options;

    const data = await apiFn();

    if (data.code !== 0) {
        // 处理 "not registered" 错误
        if (handleNotRegistered && data.code === 1 && String(data.msg).includes('not registered')) {
            if (retry >= MAX_RETRY) {
                data.msg = 'not registered after max retries. Original message: ' + data.msg;
                const errorMsg = `[qsign][${apiName}] ${data.msg}(${data.code})`;
                if (throwOnError) {
                    throw new Error(errorMsg);
                }
                logger.warn(errorMsg);
                return data;
            }
            if (onNotRegistered) {
                await onNotRegistered();
            }
            await sleep(100);
            return executeWithRetry(apiFn, apiName, { ...options, retry: retry + 1 });
        }

        // 重试逻辑
        if (retry < MAX_RETRY) {
            logger.warn(`[qsign][${apiName}] ${data.msg}(${data.code}), retry in 1s...`);
            await sleep(1000);
            return executeWithRetry(apiFn, apiName, { ...options, retry: retry + 1 });
        }

        // 最终失败处理
        data.msg = data.msg || 'unknown error';
        const errorMsg = `[qsign][${apiName}] ${data.msg}(${data.code})`;
        if (throwOnError) {
            throw new Error(errorMsg);
        }
        logger.warn(errorMsg);
    }

    return data;
}

/**
 * 延迟函数
 * @param {number} time 毫秒
 * @returns {Promise<void>}
 */
function sleep(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

module.exports = {
    buildUrl,
    getCommonParams,
    qsignGet,
    qsignPost,
    executeWithRetry,
    sleep,
};
