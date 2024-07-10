/**
 * 扩展Client类
 */
"use strict";

const { randomBytes } = require("crypto");
const { Client } = require("./client");
const tea = require("./algo/tea");
const pb = require("./algo/pb");
const { timestamp, uin2code, BUF16, BUF0, log } = require("./common");
const { TimeoutError } = require("./exception");
const { parseC2CMsg } = require("./message/parser");
const Writer = require("./wtlogin/writer");
const _axios = require("axios").default;
const http = require("http");
const https = require("https");
const axios = _axios.create({
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
});

/**
 * seqid递增并返回
 */
Client.prototype.nextSeq = function() {
    if (++this.seq_id >= 0x8000)
        this.seq_id = 1145 + Math.round(Math.random() * 1419);
    return this.seq_id;
};

const ERROR_TIMEOUT = new TimeoutError("package timeout");
const API_WAIT_TIME = 45000;

/**
 * 发送一个包并返回响应包
 */
Client.prototype.send = function (packet, timeout = 5, seq_id = this.seq_id) {
    ++this.stat.sent_pkt_cnt;
    return new Promise((resolve, reject) => {
        this._socket.write(packet, () => {
            const id = setTimeout(() => {
                this.handlers.delete(seq_id);
                ++this.stat.lost_pkt_cnt;
                reject(ERROR_TIMEOUT);
            }, timeout * 1000);
            this.handlers.set(seq_id, (data) => {
                clearTimeout(id);
                this.handlers.delete(seq_id);
                resolve(data);
            });
        });
    });
};

/**
 * 发送一个uni包
 * 除login包之外都是uni包，以0x0b开头
 * login包以0x0a开头
 */
Client.prototype.writeUni = async function (cmd, body, seq = 0) {
    ++this.stat.sent_pkt_cnt;
    const packet = this.needSignCmd.includes(cmd) ?
        await this._buildUniPacketWithHeadSign(cmd, body, seq) : this._buildUniPacket(cmd, body, seq);
    this._socket.write(packet);
};

/**
 * 发送一个uni包并返回响应包
 */
Client.prototype.sendUni = async function (cmd, body, timeout = 5) {
    const seq = this.nextSeq();
    const packet = this.needSignCmd.includes(cmd) ?
        await this._buildUniPacketWithHeadSign(cmd, body, seq) : this._buildUniPacket(cmd, body, seq);
    return this.send(packet, timeout, seq);
};

/**
 * 发送一个oidb包并返回响应包
 * 是uni包的一个封装
 */
Client.prototype.sendOidb = function (cmd, body) {
    const sp = cmd //OidbSvc.0x568_22
        .replace("OidbSvc.", "")
        .replace("oidb_", "")
        .split("_");
    const type1 = parseInt(sp[0], 16),
        type2 = parseInt(sp[1]);
    body = pb.encode({
        1: type1,
        2: isNaN(type2) ? 1 : type2,
        3: 0,
        4: body,
        6: "android " + this.apk.ver,
    });
    return this.sendUni(cmd, body);
};

/**
 * 发送一个OidbSvcTrpcTcp包并返回响应数据
 * 是uni包的一个封装
 */
Client.prototype.sendOidbSvcTrpcTcp = async function (cmd, body) {
	const sp = cmd //OidbSvcTrpcTcp.0xf5b_1
		.replace("OidbSvcTrpcTcp.", "")
		.split("_");
	const type1 = parseInt(sp[0], 16), type2 = parseInt(sp[1]);
    body = pb.encode({
        1: type1,
        2: isNaN(type2) ? 1 : type2,
        4: body,
        12: 1,
    });
    const payload = await this.sendUni(cmd, body);
    const rsp = pb.decode(payload);
    if (rsp[3] === 0) return rsp[4];
    throw new Error(`${rsp[5]} (${rsp[3]})`);
};

/**
 * 构造一个带头部签名的uni包
 * @param {string} cmd
 * @param {Buffer} body
 * @param {number} seq
 */
Client.prototype._buildUniPacketWithHeadSign = async function (cmd, body, seq = 0) {
    seq = seq ? seq : this.nextSeq();
    const sign = await this.getSign(cmd, Buffer.from(body));
    return this._buildUniPacket(cmd, body, seq, sign);
}

/**
 * 构造一个uni包
* @param {string} cmd 
* @param {Buffer} body 
* @param {number} seq
* @param {Buffer} signProtobuf
*/
Client.prototype._buildUniPacket = function (cmd, body, seq = 0, signProtobuf = BUF0) {
    seq = seq ? seq : this.nextSeq();
    this.logger.trace(`send:${cmd} seq:${seq}`);
    const type = cmd === "wtlogin.exchange_emp" ? 2 : 1;
 
    let len = cmd.length + 20;
    let sso = new Writer()
        .writeWithLength(cmd)
        .writeWithLength(this._wt.session_id)
        .writeWithLength(signProtobuf)
        .read();
    sso = new Writer().writeWithLength(sso).writeWithLength(body).read();
 
    const encrypted = tea.encrypt(sso, type === 1 ? this.sig.d2key : BUF16);
    const uin = String(this.uin);
    len = encrypted.length + uin.length + 18;
    const pkt = Buffer.allocUnsafe(len);
    pkt.writeUInt32BE(len, 0);
    pkt.writeUInt32BE(0x0B, 4);
    pkt.writeUInt8(type, 8);
    pkt.writeInt32BE(seq, 9);
    pkt.writeUInt8(0, 13);
    pkt.writeUInt32BE(uin.length + 4, 14);
    pkt.fill(uin, 18);
    pkt.fill(encrypted, uin.length + 18);
    return pkt;
}

/**
 * 构造事件共通属性
 */
Client.prototype.parseEventType = function (name = "") {
    const slice = name.split(".");
    const post_type = slice[0], sub_type = slice[2];
    const data = {
        self_id: this.uin,
        time: timestamp(),
        post_type: post_type,
    };
    const type_name = slice[0] + "_type";
    data[type_name] = slice[1];
    if (sub_type)
        data.sub_type = sub_type;
    return data;
};

/**
 * 触发事件
 */
Client.prototype.em = function (name = "", data = {}) {
    data = Object.assign(this.parseEventType(name), data);
    while (true) {
        this.emit(name, data);
        let i = name.lastIndexOf(".");
        if (i === -1)
            break;
        name = name.slice(0, i);
    }
};

/**
 * 用于消息去重和数据统计
 */
Client.prototype.msgExists = function (from, type, seq, time) {
    if (timestamp() + this.sig.time_diff - time >= 60 || time < this.stat.start_time)
        return true;
    const id = [from, type, seq].join("-");
    const set = this.seq_cache.get(time);
    if (!set) {
        this.seq_cache.set(time, new Set([id]));
        return false;
    } else {
        if (set.has(id))
            return true;
        else
            set.add(id);
        return false;
    }
};

/**
 * 构造私聊消息cookie
 */
Client.prototype.buildSyncCookie = function () {
    const time = timestamp();
    return pb.encode({
        1: time,
        2: time,
        3: this.const1,
        4: this.const2,
        5: randomBytes(4).readUInt32BE(),
        9: randomBytes(4).readUInt32BE(),
        11: randomBytes(4).readUInt32BE(),
        12: this.const3,
        13: time,
        14: 0,
    });
};

/**
 * 消息同步
 */
Client.prototype.pbGetMsg = async function () {
    if (this.config.useNT) return true;
    if (!this.sync_cookie)
        this.sync_cookie = this.buildSyncCookie();
    let body = pb.encode({
        1: 0,
        2: this.sync_cookie,
        3: 0,
        4: 20,
        5: 3,
        6: 1,
        7: 1,
        9: 1,
    });
    try {
        const blob = await this.sendUni("MessageSvc.PbGetMsg", body);
        const rsp = pb.decode(blob);
        if (rsp[3])
            this.sync_cookie = rsp[3].toBuffer();
        if (rsp[1] > 0 || !rsp[5])
            return true;
        const items = [];
        if (!Array.isArray(rsp[5]))
            rsp[5] = [rsp[5]];
        for (let v of rsp[5]) {
            if (!v[4]) continue;
            if (!Array.isArray(v[4]))
                v[4] = [v[4]];
            for (let msg of v[4]) {
                const head = msg[1];
                const type = head[3];
                const item = { ...head };
                item[3] = 187;
                items.push(item);
                if (!this.sync_finished)
                    continue;
                let from_uin = head[1], to_uin = head[2];
                if (from_uin === this.uin && from_uin !== to_uin)
                    continue;
                if (![33, 38, 85, 141, 166, 167, 208, 529].includes(type))
                    continue;
                if (this.msgExists(from_uin, type, head[5], head[6]))
                    continue;

                //群员入群
                if (type === 33) {
                    (async () => {
                        const group_id = uin2code(from_uin);
                        const user_id = head[15];
                        const nickname = String(head[16]);
                        const ginfo = (await this.getGroupInfo(group_id)).data;
                        if (!ginfo) return;
                        if (user_id === this.uin) {
                            this.logger.info(`更新了群列表，新增了群：${group_id}`);
                            this.getGroupMemberList(group_id);
                        } else {
                            ginfo.member_count++;
                            ginfo.last_join_time = timestamp();
                            await this.getGroupMemberInfo(group_id, user_id);
                            try {
                                if (this.gml.get(group_id).size)
                                    ginfo.member_count = this.gml.get(group_id).size;
                            } catch { }
                            this.logger.info(`${user_id}(${nickname}) 加入了群 ${group_id}`);
                        }
                        this.em("notice.group.increase", {
                            group_id, user_id, nickname
                        });
                    })();
                }

                //被管理批准入群，建群
                else if (type === 85 || type === 38) {
                    (async () => {
                        const group_id = uin2code(from_uin);
                        const user_id = this.uin;
                        const nickname = this.nickname;
                        const ginfo = (await this.getGroupInfo(group_id)).data;
                        if (!ginfo) return;
                        if (user_id === this.uin) {
                            this.logger.info(`更新了群列表，新增了群：${group_id}`);
                            this.getGroupMemberList(group_id);
                        }
                        this.em("notice.group.increase", {
                            group_id, user_id, nickname
                        });
                    })();
                }

                //私聊消息
                else {
                    ++this.stat.recv_msg_cnt;
                    (async () => {
                        try {
                            const data = await parseC2CMsg.call(this, msg, true);
                            if (data && data.raw_message) {
                                data.reply = (message, auto_escape = false) => this.sendPrivateMsg(data.user_id, message, auto_escape);
                                this.logger.info(`recv from: [Private: ${data.user_id}(${data.sub_type})] ` + data.raw_message);
                                this.em("message.private." + data.sub_type, data);
                            }
                        } catch (e) {
                            this.logger.debug(e);
                        }
                    })();
                }
            }
        }

        if (items.length) {
            this.writeUni("MessageSvc.PbDeleteMsg", pb.encode({ 1: items }));
        }
        return true;
    } catch (e) {
        this.logger.debug("getMsg发生错误。");
        this.logger.debug(e);
        return false;
    }
};

function sleep(time) {
    return new Promise(resolve => setTimeout(resolve, time));
} 

/**
 * 注册qsign
 */
Client.prototype.registerQSign = async function(retry = 0) {
    if (!this.config.sign_api_addr) return BUF0;
    let url = this.config.sign_api_addr;
    if (url[url.length - 1] !== '/') {
        url += '/';
    }
    url += 'register';
    const params = {
        ver: this.apk.ver,
        android_id: this.device.android_id,
        qimei36: this.device.qimei36 || this.device.qimei16 || this.device.android_id,
        guid: this.device.guid.toString('hex'),
        uin: this.uin,
        key: this.config.sign_api_key,
    };
    const { data } = await axios.get(url,
        {
            params,
            timeout: API_WAIT_TIME,
            headers: {
                'User-Agent': "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.5249.199 Safari/537.36 OICQ/1.23 ILPP/2",
                'Content-Type': "application/x-www-form-urlencoded"
            }
        }
    ).catch((e) => ({ data: { code: -1, msg: e ? e.message : 'failed to connect to qsign api' } }));
    if (data.code !== 0) {
        if (retry < 3) {
            this.logger.warn(`[qsign][register] ${data.msg}(${data.code}), retry in 1s...`);
            await sleep(1000);
            return await this.registerQSign(retry + 1);
        }
        data.msg = data.msg || 'unknown error';
        throw new Error(`[qsign][register] ${data.msg}(${data.code})`);
    }
};

const unsendSso = [];
const signLock = new Set();

/**
 * 发送qsign给的sso包
 * @param {Array} callbackList
 */
Client.prototype.handleSsoCallback = async function(callbackList = []) {
    for (let packet of callbackList) {
        try {
            const cmd = String(packet.cmd);
            const body = Buffer.from(packet.body, 'hex');
            const callbackId = packet.callbackId ?? packet.callback_id;
            const payload = await this.sendUni(cmd, body);
            await this.submitSsoCallback(cmd, callbackId, payload);
        } catch (e) {
            this.logger.warn(`[qsign][sendSso] ${e.message || 'unknown error'}`);
            console.warn(e);
        }
    }
}

/**
 * 提交qsign给的sso包的返回包
 * @param {string} cmd
 * @param {number} callbackId
 * @param {Buffer} body
 */
Client.prototype.submitSsoCallback = async function(cmd, callbackId, body, retry = 0) {
    let url = this.config.sign_api_addr;
    if (url[url.length - 1] !== '/') {
        url += '/';
    }
    url += 'submit';
    const params = {
        ver: this.apk.ver,
        android_id: this.device.android_id,
        androidId: this.device.android_id,
        qimei36: this.device.qimei36 || this.device.qimei16 || this.device.android_id,
        guid: this.device.guid.toString('hex'),
        uin: this.uin,
        buffer: body.toString('hex'),
        cmd: cmd,
        callback_id: callbackId,
        callbackId: callbackId,
        qua: this.apk.qua,
        key: this.config.sign_api_key
    };
    const { data } = await axios.get(url,
        {
            params,
            timeout: API_WAIT_TIME,
            headers: {
                'User-Agent': "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.5249.199 Safari/537.36 OICQ/1.23 ILPP/2",
                'Content-Type': "application/x-www-form-urlencoded"
            }
        }
    ).catch((e) => ({ data: { code: -1, msg: e ? e.message : 'failed to connect to qsign api' } }));
    if (data.code !== 0) {
        if (retry < 3) {
            this.logger.warn(`[qsign][submitSso] ${data.msg}(${data.code}), retry in 1s...`);
            await sleep(1000);
            return await this.submitSsoCallback(cmd, callbackId, body, retry + 1);
        }
        data.msg = data.msg || 'unknown error';
        this.logger.warn(`[qsign][submitSso] ${data.msg}(${data.code})`);
    }
}

/**
 * 刷新qsign的token
 */
Client.prototype.refreshQSignToken = async function(retry = 0) {
    if (!this.config.sign_api_addr) return;
    if (unsendSso.length > 0) {
        await this.handleSsoCallback(unsendSso.splice(0, unsendSso.length));
    }
    let url = this.config.sign_api_addr;
    if (url[url.length - 1] !== '/') {
        url += '/';
    }
    url += 'request_token';
    const params = {
        ver: this.apk.ver,
        uin: this.uin,
        android_id: this.device.android_id,
        androidId: this.device.android_id,
        qimei36: this.device.qimei36 || this.device.qimei16 || this.device.android_id,
        guid: this.device.guid.toString('hex'),
        qua: this.apk.qua,
    };
    const { data } = await axios.get(url,
        {
            params,
            timeout: API_WAIT_TIME,
            headers: {
                'User-Agent': "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.5249.199 Safari/537.36 OICQ/1.23 ILPP/2",
                'Content-Type': "application/x-www-form-urlencoded"
            }
        }
    ).catch((e) => ({ data: { code: -1, msg: e ? e.message : 'failed to connect to qsign api' } }));
    if (data.code !== 0) {
        if (data.code === 1 && String(data.msg).includes('not registered')) {
            try {
                await this.registerQSign();
            } catch (e) {
                this.logger.warn(`${e.message || '[qsign][register] unknown error'}`);
                console.warn(e);
            }
            await sleep(100);
            return await this.refreshQSignToken(retry);
        }
        if (retry < 3) {
            this.logger.warn(`[qsign][refreshToken] ${data.msg}(${data.code}), retry in 1s...`);
            await sleep(1000);
            return await this.refreshQSignToken(retry + 1);
        }
        data.msg = data.msg || 'unknown error';
        this.logger.warn(`[qsign][refreshToken] ${data.msg}(${data.code})`);
    }
    if (data.data){
        const pkts = data.data.ssoPacketList || data.data.requestCallback || data.data;
        if (Array.isArray(pkts)) {
            await this.handleSsoCallback(pkts);
        }
    } else {
        this.logger.warn(`[qsign][refreshToken] server return invalid response: ${JSON.stringify(data)}`);
    }
}

/**
 * 获取头部sign
 * @param {string} cmd
 * @param {Buffer} body
 * @param {number} retry 重试次数
 */
Client.prototype.getSign = async function(cmd, body, retry = 0) {
    if (!this.config.sign_api_addr || !this.apk.qua) return BUF0;
    const seq_id = this.seq_id;
    let signObj ={
        9: 1,
        12: this.device.qimei36 || this.device.qimei16 || this.device.android_id,
        14: 0,
        16: String(this.uin),
        18: 0,
        19: 1,
        20: 1,
        21: 0,
        24: {
            1: BUF0,
            2: BUF0,
            3: BUF0
        },
        28: 3
    };
    let url = this.config.sign_api_addr;
    if (url[url.length - 1] !== '/') {
        url += '/';
    }
    url += 'sign';
    while (signLock.size >= 1) {
        await sleep(100);
    }
    signLock.add(seq_id);
    const { data } = await axios.post(url,
        {
            ver: this.apk.ver,
            androidId: this.device.android_id,
            android_id: this.device.android_id,
            qimei36: this.device.qimei36 || this.device.qimei16 || this.device.android_id,
            guid: this.device.guid.toString('hex'),
            uin: this.uin,
            buffer: body.toString('hex'),
            cmd: cmd,
            seq: seq_id,
            qua: this.apk.qua,
            key: this.config.sign_api_key
        },
        {
            timeout: API_WAIT_TIME,
            headers: {
                'User-Agent': "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.5249.199 Safari/537.36 OICQ/1.23 ILPP/2",
                'Content-Type': "application/x-www-form-urlencoded"
            }
        }
    ).catch((e) => ({ data: { code: -1, msg: e ? e.message : 'failed to connect to qsign api' } }));
    signLock.delete(seq_id);
    if (data.code !== 0) {
        if (data.code === 1 && String(data.msg).includes('not registered')) {
            await this.registerQSign();
            await sleep(1000);
            return await this.getSign(cmd, body, retry);
        }
        if (retry < 3) {
            this.logger.warn(`[qsign][HeadSign] ${data.msg}(${data.code}), retry in 1s...`);
            await sleep(1000);
            return await this.getSign(cmd, body, retry + 1);
        }
        data.msg = data.msg || 'unknown error';
        throw new Error(`[qsign][HeadSign] ${data.msg}(${data.code})`);
    }
    if (!data.data.sign) {
        throw new Error(`[qsign][HeadSign] server return invalid response: ${JSON.stringify(data)}`);
    }
    if (data.data.requestCallback && data.data.requestCallback.length > 0) {
        // 成功上线register后再发送SSO包
        unsendSso.push.apply(unsendSso, data.data.requestCallback);
        this.once("internal.registered", async () => {
            await this.refreshQSignToken();
        });
    }
    signObj[24][1] = Buffer.from(data.data.sign, "hex");
    signObj[24][2] = Buffer.from(data.data.token, "hex");
    signObj[24][3] = Buffer.from(data.data.extra, "hex");
    return Buffer.from(pb.encode(signObj));
};

/**
 * 获取Tlv544
 * @param {string} cmd
 * @param {number} retry 重试次数
 */
Client.prototype.getT544 = async function(cmd, retry = 0) {
    if (!this.config.sign_api_addr || !this.apk.qua) return BUF0;
    if (this.config.force_algo_T544) return BUF0;
    let url = this.config.sign_api_addr;
    if (url[url.length - 1] !== '/') {
        url += '/';
    }
    url += 'energy';
    const params = {
        ver: this.apk.ver,
        androidId: this.device.android_id,
        android_id: this.device.android_id,
        qimei36: this.device.qimei36 || this.device.qimei16 || this.device.android_id,
        guid: this.device.guid.toString('hex'),
        uin: this.uin,
        data: cmd,
        key: this.config.sign_api_key,
        version: this.apk.sdkver
    };
    const { data } = await axios.get(url,
        {
            params,
            timeout: API_WAIT_TIME,
            headers: {
                'User-Agent': "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.5249.199 Safari/537.36 OICQ/1.23 ILPP/2",
                'Content-Type': "application/x-www-form-urlencoded"
            }
        }
    ).catch((e) => ({ data: { code: -1, msg: e ? e.message : 'failed to connect to qsign api' } }));
    if (data.code !== 0) {
        if (this.apk.ver === "8.9.50") return BUF0;
        if (data.code === 1 && String(data.msg).includes('not registered')) {
            await this.registerQSign();
            await sleep(1000);
            return await this.getT544(cmd, retry);
        }
        if (retry < 3) {
            this.logger.warn(`[qsign][T544] ${data.msg}(${data.code}), retry in 1s...`);
            await sleep(1000);
            return await this.getT544(cmd, retry + 1);
        }
        data.msg = data.msg || 'unknown error';
        throw new Error(`[qsign][T544] ${data.msg}(${data.code})`);
    }
    if (!data.data) {
        throw new Error(`[qsign][T544] server return invalid response: ${JSON.stringify(data)}`);
    }
    if (typeof(data.data) === 'string')
        return Buffer.from(data.data, 'hex');
    else if (typeof(data.data.sign) === 'string') {
        if (typeof(data.data.t553) === 'string') this.sig.t553 = Buffer.from(data.data.t553, 'hex');
        return Buffer.from(data.data.sign, 'hex');
    }
    else throw new Error(`[qsign][T544] server return invalid response: ${JSON.stringify(data)}`);
};
