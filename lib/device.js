/**
 * 设备文件和协议
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { md5 } = require("./common");

/**
 * @param {number} uin 
 */
function _genIMEI(uin) {
    let imei = uin % 2 ? "86" : "35";
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(uin);
    let a = buf.readUInt16BE();
    let b = Buffer.concat([Buffer.alloc(1), buf.slice(1)]).readUInt32BE();
    if (a > 9999) {
        a = parseInt(a / 10);
    } else if (a < 1000) {
        a = String(uin).substr(0, 4);
    }
    while (b > 9999999) {
        b = b >>> 1;
    }
    if (b < 1000000) {
        b = String(uin).substr(0, 4) + String(uin).substr(0, 3);
    }
    imei += a + "0" + b;
    function calcSP(imei) {
        let sum = 0;
        for (let i = 0; i < imei.length; ++i) {
            if (i % 2) {
                let j = imei[i] * 2;
                sum += j % 10 + Math.floor(j / 10);
            } else {
                sum += parseInt(imei[i]);
            }
        }
        return (100 - sum) % 10;
    }
    return imei + calcSP(imei);
}

/**
 * @param {string} filepath 
 * @param {number} uin 
 */
function _genDevice(filepath, uin) {
    const imei = _genIMEI(uin);
    const hash = md5(String(uin));
    const hex = hash.toString("hex");
    const uuid = hex.substr(0, 8) + "-" + hex.substr(8, 4) + "-" + hex.substr(12, 4) + "-" + hex.substr(16, 4) + "-" + hex.substr(20);
    const device = `{
    "--begin--":    "该设备文件由账号作为seed自动生成，账号不变则生成的文件总是相同。",
    "--version--":  2,
    "product":      "MRS4S",
    "device":       "HIM188MOE",
    "board":        "MIRAI-YYDS",
    "brand":        "OICQX",
    "model":        "Konata 2020",
    "wifi_ssid":    "TP-LINK-${uin.toString(16)}",
    "bootloader":   "U-boot",
    "android_ver":  "OICQX.${hash.readUInt16BE()}${hash[2]}.${hash[3]}${String(uin)[0]}",
    "boot_id":      "${uuid}",
    "proc_version": "Linux version 4.19.71-${hash.readUInt16BE(4)} (konata@takayama.github.com)",
    "mac_address":  "02:00:00:00:00:00",
    "ip_address":   "10.0.${hash[10]}.${hash[11]}",
    "imei":         "${imei}",
    "android_id":   "${md5(imei).toString("hex").slice(0, 16)}",
    "incremental":  "${hash.readUInt32BE(12)}",
    "--end--":      "修改后可能需要重新验证设备。"
}`;
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    fs.writeFileSync(filepath, device, { mode: 0o600 });
    return JSON.parse(device);
}

/**
 * @param {string} filepath 
 * @param {number} uin 
 * @returns {import("./ref").Device}
 */
function getDeviceInfo(filepath, uin) {
    var d;
    try {
        d = JSON.parse(fs.readFileSync(filepath, { encoding: "utf-8" }));
    } catch {
        d = _genDevice(filepath, uin);
    }
    if (!d['--version--']) d['--version--'] = 1;
    switch (d['--version--']) {
        case 1:
            d['--version--'] = 2;
            d.android_ver = d.android_id;
            d.android_id = d.imei;
            fs.writeFileSync(filepath, JSON.stringify(d, null, 4), { mode: 0o600 });
        case 2:
            break;
        default:
            console.error("Unknown device device version.");
    }
    const device = {
        display: d.android_ver,
        product: d.product,
        device: d.device,
        board: d.board,
        brand: d.brand,
        model: d.model,
        bootloader: d.bootloader,
        fingerprint: `${d.brand}/${d.product}/${d.device}:10/${d.android_ver}/${d.incremental}:user/release-keys`,
        boot_id: d.boot_id,
        proc_version: d.proc_version,
        baseband: "",
        sim: "T-Mobile",
        os_type: "android",
        mac_address: d.mac_address,
        ip_address: d.ip_address,
        wifi_bssid: d.mac_address,
        wifi_ssid: d.wifi_ssid,
        imei: d.imei,
        android_id: d.android_id,
        apn: "wifi",
        version: {
            incremental: d.incremental,
            release: "10",
            codename: "REL",
            sdk: 29
        }
    };
    device.imsi = crypto.randomBytes(16);
    device.tgtgt = crypto.randomBytes(16);
    device.guid = md5(Buffer.concat([Buffer.from(device.android_id), Buffer.from(device.mac_address)]));
    device.qimei16 = "";
    device.qimei36 = "";
    device.mtime = Math.floor(fs.statSync(filepath).mtimeMs || Date.now());
    return device;
}

const DEFAULT_ANDROID_APK_INFO = {//android phone
    id: "com.tencent.mobileqq",
    name: "A8.9.50.f5a7d351",
    version: "8.9.50.10650",
    ver: "8.9.50",
    sign: Buffer.from([166, 183, 69, 191, 36, 162, 194, 119, 82, 119, 22, 246, 243, 110, 182, 141]),
    buildtime: 1676531414,
    appid: 16,
    subid: 537155551,
    bitmap: 150470524,
    sigmap: 16724722,
    sdkver: "6.0.0.2535",
    ssover: 19,
    qua: "V1_AND_SQ_8.9.50_3898_YYB_D",
}

/**
 * @type {{[k: number]: import("./ref").ApkInfo}}
 */
const apk = {
    //android phone
    1: {
        ...DEFAULT_ANDROID_APK_INFO
    },

    //android watch
    3: {
        id: "com.tencent.qqlite",
        name: "A2.0.8",
        version: "2.0.8",
        ver: "2.0.8",
        sign: Buffer.from([166, 183, 69, 191, 36, 162, 194, 119, 82, 119, 22, 246, 243, 110, 182, 141]),
        buildtime: 1559564731,
        appid: 16,
        subid: 537065138,
        bitmap: 16252796,
        sigmap: 16724722,
        sdkver: "6.0.0.2365",
        ssover: 5,
    },

    //mac
    4: {
        id: "com.tencent.minihd.qq",
        name: "A5.9.3.3468",
        version: "5.9.3.3468",
        ver: "5.9.3",
        sign: Buffer.from([170, 57, 120, 244, 31, 217, 111, 249, 145, 74, 102, 158, 24, 100, 116, 199]),
        buildtime: 1637427966,
        appid: 16,
        subid: 537128930,
        bitmap: 150470524,
        sigmap: 1970400,
        sdkver: "6.0.0.2487",
        ssover: 12,
    },

    //fix login by old android phone
    6: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.8.88.7083",
        version: "8.8.88.7083",
        ver: "8.8.88",
        buildtime: 1648004515,
        subid: 537118044,
        sdkver: "6.0.0.2497",
        ssover: 18,
    },
    
    //android phone 8.9.33
    7: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.33.2045045f",
        version: "8.9.33.10335",
        ver: "8.9.33",
        buildtime: 1673599898,
        subid: 537151682,
        sdkver: "6.0.0.2534",
        qua: "V1_AND_SQ_8.9.33_3772_YYB_D",
    },

    //TIM 3.5.1
    10: {
        id: "com.tencent.tim",
        name: "A3.5.1.db08e878",
        version: "3.5.1.3168",
        ver: "3.5.1",
        sign: Buffer.from([119, 94, 105, 109, 9, 133, 104, 114, 253, 216, 171, 79, 63, 6, 177, 224]),
        buildtime: 1630062176,
        appid: 16,
        subid: 537150355,
        bitmap: 150470524,
        sigmap: 16724722,
        sdkver: "6.0.0.2484",
        ssover: 18,
        qua: "V1_AND_SQ_8.3.9_351_TIM_D",
    },

    //android phone 8.9.58
    11: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.58.2cddee21",
        version: "8.9.58.11175",
        ver: "8.9.58",
        buildtime: 1684467300,
        subid: 537163194,
        sigmap: 34869472,
        sdkver: "6.0.0.2545",
        ssover: 20,
        qua: "V1_AND_SQ_8.9.58_4108_YYB_D",
    },

    //android phone 8.9.63
    13: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.63.5156de84",
        version: "8.9.63.11390",
        ver: "8.9.63",
        buildtime: 1685069178,
        subid: 537164840,
        sdkver: "6.0.0.2546",
        ssover: 20,
        qua: "V1_AND_SQ_8.9.63_4194_YYB_D",
    },
    //android phone 8.9.68
    15: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.68.e757227e",
        version: "8.9.68.11565",
        ver: "8.9.68",
        buildtime: 1687254022,
        subid: 537168313,
        sdkver: "6.0.0.2549",
        ssover: 20,
        qua: "V1_AND_SQ_8.9.68_4264_YYB_D",
    },

    //android phone 8.9.70
    17: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.70.b4332bd3",
        version: "8.9.70.11730",
        ver: "8.9.70",
        buildtime: 1688720082,
        subid: 537169928,
        sdkver: "6.0.0.2551",
        ssover: 20,
        qua: "V1_AND_SQ_8.9.70_4330_YYB_D",
    },

    //android phone 8.9.73
    19: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.73.11945",
        version: "8.9.73.11945",
        ver: "8.9.73",
        buildtime: 1690371091,
        subid: 537171689,
        sdkver: "6.0.0.2553",
        ssover: 20,
        qua: "V1_AND_SQ_8.9.73_4416_YYB_D",
    },

    //android phone 8.9.75
    21: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.75.354d41fc",
        version: "8.9.75.12110",
        ver: "8.9.75",
        buildtime: 1691565978,
        subid: 537173381,
        sdkver: "6.0.0.2554",
        ssover: 20,
        qua: "V1_AND_SQ_8.9.75_4482_YYB_D",
    },

    //android phone 8.9.71
    23: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.71.9fd08ae5",
        version: "8.9.71.11735",
        ver: "8.9.71",
        buildtime: 1688720082,
        subid: 537170024,
        sdkver: "6.0.0.2551",
        ssover: 20,
        qua: "V1_AND_SQ_8.9.71_4332_YYB_D",
    },

    //android phone 8.9.76
    25: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.76.c71a1fa8",
        version: "8.9.76.12115",
        ver: "8.9.76",
        buildtime: 1691565978,
        subid: 537173477,
        sdkver: "6.0.0.2554",
        ssover: 20,
        qua: "V1_AND_SQ_8.9.76_4484_YYB_D",
    },

    //android phone 8.9.78
    27: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.78.d5d9d71d",
        version: "8.9.78.12275",
        ver: "8.9.78",
        buildtime: 1691565978,
        subid: 537175315,
        sdkver: "6.0.0.2554",
        ssover: 20,
        qua: "V1_AND_SQ_8.9.78_4548_YYB_D",
    },

    //android phone 8.9.80
    29: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.80.57a42f50",
        version: "8.9.80.12440",
        ver: "8.9.80",
        buildtime: 1691565978,
        subid: 537176863,
        sdkver: "6.0.0.2554",
        ssover: 20,
        qua: 'V1_AND_SQ_8.9.80_4614_YYB_D',
    },

    //android phone 8.9.83
    31: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.83.c9a61e5e",
        version: "8.9.83.12605",
        ver: "8.9.83",
        buildtime: 1691565978,
        subid: 537178646,
        sdkver: "6.0.0.2554",
        ssover: 20,
        qua: 'V1_AND_SQ_8.9.83_4680_YYB_D',
    },

    //android phone 8.9.85
    33: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.85.3377f9bf",
        version: "8.9.85.12820",
        ver: "8.9.85",
        buildtime: 1697015435,
        subid: 537180568,
        sdkver: "6.0.0.2556",
        ssover: 21,
        qua: 'V1_AND_SQ_8.9.85_4766_YYB_D',
    },

    //android phone 8.9.88
    35: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.88.46a07457",
        version: "8.9.88.13035",
        ver: "8.9.88",
        buildtime: 1697015435,
        subid: 537182769,
        sdkver: "6.0.0.2556",
        ssover: 21,
        qua: 'V1_AND_SQ_8.9.88_4852_YYB_D',
    },

    //android phone 8.9.93
    37: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A8.9.93.bf80f08f",
        version: "8.9.93.13475",
        ver: "8.9.93",
        buildtime: 1697015435,
        subid: 537187398,
        sdkver: "6.0.0.2556",
        ssover: 21,
        qua: 'V1_AND_SQ_8.9.93_5028_YYB_D',
    },

    //android phone 9.0.0
    39: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A9.0.0.0ebb1ecb",
        version: "9.0.0.14110",
        ver: "9.0.0",
        buildtime: 1701164403,
        subid: 537194351,
        sdkver: "6.0.0.2557",
        ssover: 21,
        qua: 'V1_AND_SQ_9.0.0_5282_YYB_D',
    },

    //android phone 9.0.8
    41: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A9.0.8.10368491",
        version: "9.0.8.14755",
        ver: "9.0.8",
        buildtime: 1702888273,
        subid: 537200218,
        sdkver: "6.0.0.2558",
        ssover: 21,
        qua: 'V1_AND_SQ_9.0.8_5540_YYB_D',
    },

    //android phone 9.0.17
    43: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A9.0.17.6a4a36ca",
        version: "9.0.17.151855",
        ver: "9.0.17",
        buildtime: 1702888273,
        subid: 537204056,
        sdkver: "6.0.0.2558",
        ssover: 21,
        qua: 'V1_AND_SQ_9.0.17_5712_YYB_D',
    },

    //android phone 9.0.25
    45: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A9.0.25.63b29b33",
        version: "9.0.25.15760",
        ver: "9.0.25",
        buildtime: 1702888273,
        subid: 537210084,
        sdkver: "6.0.0.2558",
        ssover: 21,
        qua: 'V1_AND_SQ_9.0.25_5942_YYB_D',
    },

    //android phone 9.0.35
    47: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A9.0.35.52ab3f26",
        version: "9.0.35.16275",
        ver: "9.0.35",
        buildtime: 1710769234,
        subid: 537215475,
        sdkver: "6.0.0.2559",
        ssover: 21,
        qua: 'V1_AND_SQ_9.0.35_6150_YYB_D',
    },

    //android phone 9.0.50
    49: {
        ...DEFAULT_ANDROID_APK_INFO,
        name: "A9.0.50.a9d8c8dc",
        version: "9.0.50.16545",
        ver: "9.0.50",
        buildtime: 1710769234,
        subid: 537217916,
        sdkver: "6.0.0.2559",
        ssover: 21,
        qua: 'V1_AND_SQ_9.0.50_6258_YYB_D',
    },
};

//apad
apk[2] = { ...apk[1] };
apk[2].subid = 537155599;

//apad 8.9.33
apk[8] = { ...apk[7] };
apk[8].subid = 537151218;

//apad 8.9.58
apk[12] = { ...apk[11] };
apk[12].subid = 537163242;

//apad 8.9.63
apk[14] = { ...apk[13] };
apk[14].subid = 537164888;

//apad 8.9.68
apk[16] = { ...apk[15] };
apk[16].subid = 537168361;

//apad 8.9.70
apk[18] = { ...apk[17] };
apk[18].subid = 537169976;

//apad 8.9.73
apk[20] = { ...apk[19] };
apk[20].subid = 537171737;

//apad 8.9.75
apk[22] = { ...apk[21] };
apk[22].subid = 537173429;

//apad 8.9.71
apk[24] = { ...apk[23] };
apk[24].subid = 537170072;

//apad 8.9.76
apk[26] = { ...apk[25] };
apk[26].subid = 537173525;

//apad 8.9.78
apk[28] = { ...apk[27] };
apk[28].subid = 537175354;

//apad 8.9.80
apk[30] = { ...apk[29] };
apk[30].subid = 537176902;

//apad 8.9.83
apk[32] = { ...apk[31] };
apk[32].subid = 537178685;

//apad 8.9.85
apk[34] = { ...apk[33] };
apk[34].subid = 537180607;

//apad 8.9.88
apk[36] = { ...apk[35] };
apk[36].subid = 537182808;

//apad 8.9.93
apk[38] = { ...apk[37] };
apk[38].subid = 537187437;

//apad 9.0.0
apk[40] = { ...apk[39] };
apk[40].subid = 537194390;

//apad 9.0.8
apk[42] = { ...apk[41] };
apk[42].subid = 537200257;

//apad 9.0.17
apk[44] = { ...apk[43] };
apk[44].subid = 537204095;

//apad 9.0.25
apk[46] = { ...apk[45] };
apk[46].subid = 537210123;

//apad 9.0.35
apk[48] = { ...apk[47] };
apk[48].subid = 537215514;

//apad 9.0.50
apk[50] = { ...apk[49] };
apk[50].subid = 537217955;

//ipad
apk[5] = { ...apk[1] };
apk[5].subid = 537155074;
apk[5].sign = apk[4].sign;
apk[5].name = "A8.9.50.611";
apk[5].version = "8.9.50.611";

//ipad 8.9.33
apk[9] = { ...apk[7] };
apk[9].subid = 537151363;
apk[9].sign = apk[4].sign;
apk[9].name = "A8.9.33.614";
apk[9].version = "8.9.33.614";
/**
 * @param {number} platform 
 */
function getApkInfo(platform) {
    return apk[platform] ? apk[platform] : apk[1];
}

module.exports = {
    getDeviceInfo, getApkInfo
};
