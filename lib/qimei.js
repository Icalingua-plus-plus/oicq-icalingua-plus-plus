/**
 * 获取 qimei
 */
"use strict";

const { randomBytes } = require("crypto");
const axios = require("axios").default;
const aes = require("./algo/aes");
const rsa = require("./algo/rsa");
const { md5 } = require("./common");

const secret = "ZdJqM15EeO2zWc08";
const rsaPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDEIxgwoutfwoJxcGQeedgP7FG9
qaIuS0qzfR8gWkrkTZKM2iWHn2ajQpBRZjMSoSf6+KJGvar2ORhBfpDXyVtZCKpq
LQ+FLkpncClKVIrBwv6PHyUvuCb0rIarmgDnzkfQAqVufEtR64iazGDKatvJ9y6B
9NMbHddGSAUmRTCrHQIDAQAB
-----END PUBLIC KEY-----`;

function dateFormat(fmt = "YYYY-mm-dd HH:MM:SS", date = new Date()) {
    let ret;
    const opt = {
        "Y+": date.getFullYear().toString(),
        "m+": (date.getMonth() + 1).toString(),
        "d+": date.getDate().toString(),
        "H+": date.getHours().toString(),
        "M+": date.getMinutes().toString(),
        "S+": date.getSeconds().toString()
    };
    for (let k in opt) {
        ret = new RegExp("(" + k + ")").exec(fmt);
        if (ret) {
            fmt = fmt.replace(ret[1], (ret[1].length == 1) ? (opt[k]) : (opt[k].padStart(ret[1].length, "0")))
        };
    };
    return fmt;
}

/**
 * 
 * @param {import("./ref").Device} info 
 * @param {import("./ref").ApkInfo} apk
 * @returns 
 */
function genRandomPayloadByDevice(info, apk) {
    const rangeRand = (max = 1, min = 0) => {
        if (max < min) [max, min] = [min, max]
        const diff = max - min
        return Math.floor(Math.random() * diff) + min
    };
    const reserved = {
        "harmony": "0",
        "clone": "0",
        "containe": "",
        "oz": "UhYmelwouA+V2nPWbOvLTgN2/m8jwGB+yUB5v9tysQg=",
        "oo": "Xecjt+9S1+f8Pz2VLSxgpw==",
        "kelong": "0",
        "uptimes": dateFormat(),
        "multiUser": "0",
        "bod": info.board,
        "brd": info.brand,
        "dv": info.device,
        "firstLevel": "",
        "manufact": info.brand,
        "name": info.model,
        "host": "se.infra",
        "kernel": info.fingerprint
    };
    let beaconId = "";
    const timeMonth = dateFormat().slice(0, 7) + "-01";
    const rand1 = rangeRand(900000, 100000)
    const rand2 = rangeRand(900000000, 100000000);
    for (let i = 1; i <= 40; i++) {
        if ([1, 2, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38].includes(i)) {
            beaconId += `k${i}:${timeMonth}${rand1}.${rand2}`;
        } else if (i === 3) {
            beaconId += "k3:0000000000000000";
        } else if (i === 4) {
            beaconId += `k4:${randomBytes(8).toString("hex")}`;
        } else {
            beaconId += `k${i}:${rangeRand(10000)}`;
        }
        beaconId += ";";
    }
    return {
        "androidId": '',
        "platformId": 1,
        "appKey": "0S200MNJT807V3GE",
        "appVersion": apk.version,
        "beaconIdSrc": beaconId,
        "brand": info.brand,
        "channelId": "2017",
        "cid": "",
        "imei": info.imei,
        "imsi": '',
        "mac": '',
        "model": info.model,
        "networkType": "unknown",
        "oaid": "",
        "osVersion": `Android ${info.version.release},level ${info.version.sdk}`,
        "qimei": "",
        "qimei36": "",
        "sdkVersion": "1.2.13.6",
        "targetSdkVersion": "26",
        "audit": "",
        "userId": "{}",
        "packageId": apk.id,
        "deviceType": info.display,
        "sdkName": "",
        "reserved": JSON.stringify(reserved),
    };
}

/**
 * 
 * @param {import("./ref").Client} client 
 * @returns {import("./ref").QimeiData}
 */
async function getQIMEI(client) {
    const k = randomBytes(8).toString("hex");
    const key = rsa.encryptPKCS1(k, rsaPublicKey);
    const time = new Date().getTime();
    const nonce = randomBytes(8).toString("hex");
    const payload = genRandomPayloadByDevice(client.device, client.apk);
    const str = JSON.stringify(payload);
    const params = aes.encrypt(str, k).toString('base64');

    const postData = {
        "key": key,
        "params": params,
        "time": time,
        "nonce": nonce,
        "sign": md5(key + params + time + nonce + secret).toString("hex"),
        "extra": "",
    }
    const { data } = await axios.post("https://snowflake.qq.com/ola/android", postData, {
        headers: {
            'User-Agent': `Dalvik/2.1.0 (Linux; U; Android ${client.device.version.release}; ${client.device.product} Build/${client.device.android_id.slice(0, 6)})`,
            'Content-Type': "application/json"
        }
    });
    if (data.code !== 0) {
        return {
            q16: "",
            q36: "",
        };
    }
    try {
        const { q16, q36 } = JSON.parse(aes.decrypt(data.data, k).toString())
        return {
            q16,
            q36,
        };
    } catch (e) {
        client.logger.error("获取 QIMEI 失败");
        client.logger.error(e);
        return {
            q16: "",
            q36: "",
        };
    }
}

module.exports = {
    getQIMEI
};