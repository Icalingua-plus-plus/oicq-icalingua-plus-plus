"use strict";
const https = require("https");
const pb = require("../algo/pb");
const jce = require("../algo/jce");
const { uinAutoCheck } = require("../common");

/**
 * @this {import("./ref").Client}
 * @param {number} user_id 
 * @param {number} times 1~20
 * @returns {import("./ref").ProtocolResponse}
 */
async function sendLike(user_id, times = 1) {
    [user_id] = uinAutoCheck(user_id);
    times = parseInt(times);
    if (!(times > 0 && times <= 20))
        times = 1;
    let ReqFavorite;
    if (this.fl.get(user_id)) {
        ReqFavorite = jce.encodeStruct([
            jce.encodeNested([
                this.uin, 1, this.seq_id + 1, 1, 0, Buffer.from("0C180001060131160131", "hex")
            ]),
            user_id, 0, 1, times
        ]);
    } else {
        ReqFavorite = jce.encodeStruct([
            jce.encodeNested([
                this.uin, 1, this.seq_id + 1, 1, 0, Buffer.from("0C180001060131160135", "hex")
            ]),
            user_id, 0, 5, times
        ]);
    }
    const extra = {
        req_id: this.seq_id + 1,
        service: "VisitorSvc",
        method: "ReqFavorite",
    };
    const body = jce.encodeWrapper({ ReqFavorite }, extra);
    const blob = await this.sendUni("VisitorSvc.ReqFavorite", body);
    const rsp = jce.decode(blob);
    return { result: rsp[0][3], emsg: rsp[0][4] };
}

/**
 * 设置在线状态
 * @this {import("./ref").Client}
 * @param {number} status 
 * @returns {import("./ref").ProtocolResponse}
 */
async function setStatus(status) {
    status = parseInt(status);
    if (![11, 31, 41, 50, 60, 70].includes(status))
        throw new Error("bad status");
    let sub = 0;
    if (status > 1000) {
        sub = status, status = 11;
    }
    const SvcReqRegister = jce.encodeStruct([
        this.uin,
        7, 0, "", status, 0, 0, 0, 0, 0, 248,
        this.device.version.sdk, 0, "", 0, null, this.device.guid, 2052, 0, this.device.model, this.device.model,
        this.device.version.release, 1, 473, 0, null, 0, 0, "", 0, "",
        "", "", null, 1, null, 0, null, sub, 0
    ]);
    const extra = {
        req_id: this.seq_id + 1,
        service: "PushService",
        method: "SvcReqRegister",
    };
    const body = jce.encodeWrapper({ SvcReqRegister }, extra);
    const blob = await this.sendUni("StatSvc.SetStatusFromClient", body);
    const rsp = jce.decode(blob);
    let result = -1;
    if (rsp[9]) {
        result = 0;
        this.online_status = status;
    }
    return { result };
}

/**
 * @this {import("./ref").Client}
 * @param {number} user_id 
 * @returns {import("./ref").ProtocolResponse}
 */
async function getLevelInfo(user_id = this.uin) {
    [user_id] = uinAutoCheck(user_id);
    const cookie = this.cookies["vip.qq.com"];
    const url = `https://club.vip.qq.com/api/vip/getQQLevelInfo?requestBody={"iUin":${user_id}}`;
    try {
        let data = await new Promise((resolve, reject) => {
            https.get(url, { headers: { cookie } }, (res) => {
                if (res.statusCode !== 200) {
                    return reject("statusCode: " + res.statusCode);
                }
                res.setEncoding("utf-8");
                let data = "";
                res.on("data", chunk => data += chunk);
                res.on("end", () => {
                    try {
                        data = JSON.parse(data);
                        if (data.ret !== 0) {
                            return reject(data.msg);
                        }
                        resolve(data.data.mRes);
                    } catch {
                        reject("response error");
                    }

                });
            }).on("error", (e) => reject(e.message));
        });
        return { result: 0, data };
    } catch (e) {
        return { result: -1, emsg: e };
    }
}

/**
 * 获取漫游表情
 * @this {import("../ref").Client}
 * @returns {import("../ref").ProtocolResponse}
 */
async function getRoamingStamp(no_cache = false) {
    if (!this.roaming_stamp)
        this.roaming_stamp = [];
    if (!this.roaming_stamp.length || no_cache) {
        const body = pb.encode({
            1: {
                1: 109,
                2: this.device.version.release,
                3: this.apk.ver
            },
            2: this.uin,
            3: 1,
        });
        const blob = await this.sendUni("Faceroam.OpReq", body);
        const rsp = pb.decode(blob);
        const result = rsp[1];
        if (result !== 0) {
            return { result, emsg: String(rsp[2]) };
        }
        if (rsp[4][1]) {
            const bid = String(rsp[4][3]);
            const faces = Array.isArray(rsp[4][1]) ? rsp[4][1] : [rsp[4][1]];
            this.roaming_stamp = faces.map(x => `https://p.qpic.cn/${bid}/${this.uin}/${x}/0`);
        }
    }
    return {
        result: 0,
        data: this.roaming_stamp,
    };
}

/**
 * 获取已登录的设备
 * @this {import("./ref").Client}
 * @returns {import("./ref").ProtocolResponse}
 */
async function getDevLoginInfo() {
    let start = 0, limit = 20;
    const devices = [];
    while (true) {
        try {
            const SvcReqGetDevLoginInfo = jce.encodeStruct([
                this.device.guid, this.apk.id, 1, 0, start, limit, 3
            ]);
            const extra = {
                req_id: this.seq_id + 1,
                service: "StatSvc",
                method: "SvcReqGetDevLoginInfo",
            };
            const body = jce.encodeWrapper({ SvcReqGetDevLoginInfo }, extra);
            const blob = await this.sendUni("StatSvc.GetDevLoginInfo", body);
            const rsp = jce.decode(blob);
            const result = rsp[0];
            if (result !== 0) {
                return { result, emsg: rsp[1] };
            }
            for (let i = 4; i <= 6; i++) {
                for (const device of rsp[i]) {
                    devices.push({
                        subid: device[0],
                        guid: device[1].toString("hex"),
                        time: device[2],
                        location: String(device[4]),
                        name: String(device[5]),
                        model: String(device[6]),
                        flag: device[7][0].toString("hex") + "-" + device[0],
                        self: Buffer.from(device[1]).equals(this.device.guid),
                        online: i === 4,
                    });
                }
            }
            break;
            const total = rsp[3];
            start += limit;
            if (start + limit > total) limit = total - start;
            if (start >= total) break;
        } catch (e) {
            this.logger.debug(e);
            this.logger.warn("获取设备登录信息失败");
            return { result: -1, emsg: e };
        }
    }
    return { result: 0, data: devices };
}

/**
 * 踢出已登录的设备
 * @this {import("./ref").Client}
 * @param {string} flag
 * @returns {import("./ref").ProtocolResponse}
 */
async function delDevLoginInfo(flag) {
    try {
        if (!flag) return { result: -1, emsg: "flag is required" };
        const flags = flag.split("-");
        const sendDelDevLoginInfo = async (subid, type) => {
            const SvcReqDelLoginInfo = jce.encodeStruct([
                this.device.guid, this.apk.id, [jce.encodeNested([Buffer.from(flags[0], 'hex')])], type, 0, subid
            ]);
            const extra = {
                req_id: this.seq_id + 1,
                service: "StatSvc",
                method: "SvcReqDelLoginInfo",
            };
            const body = jce.encodeWrapper({ SvcReqDelLoginInfo }, extra);
            const blob = await this.sendUni("StatSvc.DelDevLoginInfo", body);
            const rsp = jce.decode(blob);
            return { result: rsp[0], emsg: rsp[1] };
        };
        const del1 = await sendDelDevLoginInfo(Number(flags[1]), 2);
        if (del1.result !== 0) return del1;
        const del2 = await sendDelDevLoginInfo(0, 1);
        if (del2.result !== 0) return del2;
    } catch (e) {
        this.logger.debug(e);
        this.logger.warn("踢出已登录设备失败");
        return { result: -1, emsg: e };
    }
    return { result: 0 };
}

module.exports = {
    setStatus, sendLike, getLevelInfo, getRoamingStamp, getDevLoginInfo, delDevLoginInfo
};
