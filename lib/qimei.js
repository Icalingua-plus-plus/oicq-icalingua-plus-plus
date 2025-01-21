/**
 * 获取 qimei
 */
"use strict";

const { randomBytes } = require("crypto");
const axios = require("axios");
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

class SeededRandom {
    constructor(seed) {
        this.seed = seed;
        this.state = md5(seed.toString()).toString("hex");
    }

    next() {
        this.state = md5(this.state + secret).toString("hex");
        return parseInt(this.state.substring(0, 8), 16) / 0xffffffff;
    }

    nextInt(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }
}

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
function genRandomPayloadByDevice(info, apk, platform) {
    const seededRandom = new SeededRandom(info.android_id);
    const rangeRand = (max = 1, min = 0) => {
        return seededRandom.nextInt(min, max);
    };
    const reserved = {
        "harmony": "0",
        "clone": "0",
        "containe": "",
        "oz": "",
        "oo": "",
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
        "kernel": info.proc_version
    };
    let beaconId = "";
    const timestamp = info.mtime || apk.buildtime * 1000 + rangeRand(10 * 24 * 60 * 60 * 1000, 0);
    const mtime1 = new Date(timestamp);
    const mtimeStr1 = dateFormat("YYYY-mm-ddHHMMSS", mtime1) + "." + info.imei.slice(2, 11);
    const mtime2 = new Date(timestamp - parseInt(info.imei.slice(2, 4)));
    const mtimeStr2 = dateFormat("YYYY-mm-ddHHMMSS", mtime2) + "." + info.imei.slice(5, 14);
    for (let i = 1; i <= 40; i++) {
        if ([1, 13, 14, 17, 18, 21, 33, 34, 37, 38].includes(i)) {
            beaconId += `k${i}:${dateFormat("YYYY-mm-ddHHMMSS", new Date(timestamp + rangeRand(60, 0)))}.${String(rangeRand(99, 0)).padStart(2, '0')}0000000`;
        } else if ([25, 26, 29, 30].includes(i)) {
            const fixed = ((i === 25 ? 10 : 11) + parseInt(info.imei.slice(5, 7))) % 100;
            const fixed_str = String(fixed).padStart(2, "0");
            beaconId += `k${i}:${dateFormat("YYYY-mm-ddHHMMSS")}.${fixed_str}0000000`;
        } else if (i === 2) {
            beaconId += `k2:${mtimeStr1}`;
        } else if (i === 3) {
            beaconId += "k3:0000000000000000";
        } else if (i === 4) {
            beaconId += `k4:${md5(info.android_id + info.imei).toString("hex").slice(0, 16)}`;
        } else if (i === 5) {
            beaconId += `k5:${rangeRand(10000000, 1000000)}`;
        } else if ([6, 7, 8].includes(i)) {
            beaconId += `k${i}:${rangeRand(1000000, 100000)}`;
        } else if (i === 9) {
            beaconId += `k9:${info.boot_id}`;
        } else if (i === 10) {
            continue;
        } else if (i === 19) {
            beaconId += `k19:${rangeRand(50000, 10000)}`;
        } else if (i === 22) {
            beaconId += `k22:${mtimeStr2}`;
        } else if ([16, 20, 28, 36].includes(i)) {
            beaconId += `k${i}:${rangeRand(100, 10)}`;
        } else if ([23, 27, 31].includes(i)) {
            beaconId += `k${i}:${rangeRand(10000, 1000)}`;
        } else {
            beaconId += `k${i}:${rangeRand(5, 0)}`;
        }
        beaconId += ";";
    }
    beaconId += "k10:1";
    return {
        "androidId": info.android_id,
        "platformId": 1,
        "appKey": "0S200MNJT807V3GE",
        "appVersion": apk.version,
        "beaconIdSrc": beaconId,
        "brand": info.brand,
        "channelId": "2017",
        "cid": "",
        "imei": "",
        "imsi": "",
        "mac": info.mac_address,
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
        "deviceType": [2, 8].includes(platform) ? "Pad" : "Phone",
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
    try {
        const k = randomBytes(8).toString("hex");
        const key = rsa.encryptPKCS1(k, rsaPublicKey);
        const time = new Date().getTime();
        const nonce = randomBytes(8).toString("hex");
        const payload = genRandomPayloadByDevice(client.device, client.apk, client.config.platform);
        const str = JSON.stringify(payload);
        const params = aes.encrypt(str, k).toString("base64");

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
                "User-Agent": `Dalvik/2.1.0 (Linux; U; Android ${client.device.version.release}; ${client.device.product} Build/${client.device.android_id.slice(0, 6)})`,
                "Content-Type": "application/json"
            }
        });
        if (data.code !== 0) {
            client.logger.error("获取 QIMEI 失败 Code: " + data.code);
            return {
                q16: "",
                q36: "",
            };
        }
        const { q16, q36 } = JSON.parse(aes.decrypt(data.data, k).toString())
        return {
            q16,
            q36,
        };
    } catch (e) {
        client.logger.error("获取 QIMEI 出错");
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