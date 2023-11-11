/**
 * 密码登录流程
 * 
 * token -> ok(二次)               ok(设备安全,已验证的设备或在常用地自动通过)
 * token not exists ↘          ↗
 *                     password -> slider -> password (url verify) -> ok(假设备锁)
 * token (expired)  ↗          (可能跳过) ↘         ->           |-> device -> ok(真设备锁)
 *                                           sendSMS ->  smsLogin  -> ok(假设备锁)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");
const { WtLogin, readTlv } = require("./wt");
const Writer = require("./writer");
const { md5, NOOP, timestamp, BUF0 } = require("../common");
const tea = require("../algo/tea");
const Ecdh = require("./ecdh");
const Readable = require("stream").Readable;
const { getQIMEI } = require("../qimei");

WtLogin.prototype.passwordLogin = async function () {
    if (this.apk.qua && (!this.device.qimei16 || !this.device.qimei36)) {
        const qimei = await getQIMEI(this.c);
        // 缓存一下，理论上每次获取是一样的
        this.device.qimei16 = qimei.q16;
        this.device.qimei36 = qimei.q36;
        this.logger.info("获取到QIMEI: " + this.device.qimei16 + " " + this.device.qimei36);
    }
    if (this.apk.ssover > 12 && (!this.device.qimei16 || !this.device.qimei36))
        this.logger.warn("无法获取QIMEI，可能会导致登录失败");
    this.session_id = randomBytes(4);
    this.random_key = randomBytes(16);
    this.ecdh = new Ecdh;
    try {
        this.uid = String(await fs.promises.readFile(path.join(this.dir, "uid")) || "");
    } catch {
        this.uid = "";
    }
    try {
        this.t106 = await fs.promises.readFile(path.join(this.dir, "t106"));
        const token = await fs.promises.readFile(path.join(this.dir, "token"));
        const stream = Readable.from(token, { objectMode: false });
        const d2key = stream.read(stream.read(2).readUInt16BE());
        const d2 = stream.read(stream.read(2).readUInt16BE());
        const ticket = stream.read(stream.read(2).readUInt16BE());
        const sig = stream.read(stream.read(2).readUInt16BE());
        const srm = stream.read(stream.read(2).readUInt16BE());
        const tgt = stream.read(stream.read(2).readUInt16BE());
        this.sig.device_token = stream.read(stream.read(2).readUInt16BE());
        this.sig._ksid = stream.read(stream.read(2).readUInt16BE()) || BUF0;
        if (d2key.length && d2.length && ticket.length && sig.length && srm.length && tgt.length) {
            this.sig.ticket_key = ticket;
            this.sig.sig_key = sig;
            this.sig.srm_token = srm;
            this.sig.tgt = tgt;
            this.device.tgtgt = md5(d2key);
            this.token_flag = true;
            return await this.tokenLogin(d2);
        }
    } catch {
        this.token_flag = false;
    }
    if (!this.password_md5)
        return this.fetchQrcode();
    const t = this.tlvPacker;
    const tlvs = [
        t(0x18),
        t(0x1),
        t(0x106),
        t(0x116),
        t(0x100),
        t(0x107),
        //t(0x108)),
        t(0x142),
        t(0x144),
        t(0x145),
        t(0x147),
        t(0x154),
        t(0x141),
        t(0x8),
        t(0x511),
        t(0x187),
        t(0x188),
    ];
    if (!this.device.qimei16){
        tlvs.push(t(0x194)); // should have been removed
    }
    tlvs.push(t(0x191))
    if (!this.device.qimei16){
        tlvs.push(t(0x202)); // should have been removed
    }
        tlvs.push(t(0x177))
        tlvs.push(t(0x516))
        tlvs.push(t(0x521))
        tlvs.push(t(0x525));
    if (this.apk.ssover > 12) {
        let tlv544;
        try {
            tlv544 = await this.c.getT544("810_9");
        } catch (e) {
            const message = e.message || "[qsign][T544] 未知错误";
            this.logger.error(message);
            this.c.em("system.login.error", { code: -1, message: message });
            return;
        }
        tlvs.push(t(0x544, "810_9", tlv544));
    }
    if (this.device.qimei16) {
        tlvs.push(t(0x545, this.device.qimei16));
    }
    tlvs.push(t(0x548));
    if (this.sig.t553 && this.apk.buildtime >= 1691565978) tlvs.push(t(0x553));
    tlvs.push(t(0x542));

    const writer = new Writer()
        .writeU16(9)
        .writeU16(tlvs.length);
    for (const tlv of tlvs)
        writer.writeBytes(tlv);
    const body = writer.read();
    this.sendLogin("wtlogin.login", body);
}

WtLogin.prototype.sliderLogin = async function (ticket) {
    if (!this.t104)
        return this.logger.warn("未收到滑动验证码或已过期，你不能调用sliderLogin函数。");
    ticket = String(ticket).trim();
    const t = this.tlvPacker;
    const tlvs = [
        t(0x193, ticket),
        t(0x8),
        t(0x104),
        t(0x116),
    ];
    if (this.sig.t547.length) tlvs.push(t(0x547));
    if (this.apk.ssover > 12) {
        let tlv544;
        try {
            tlv544 = await this.c.getT544("810_2");
        } catch (e) {
            const message = e.message || "[qsign][T544] 未知错误";
            this.logger.error(message);
            this.c.em("system.login.error", { code: -1, message: message });
            return;
        }
        tlvs.push(t(0x544, "810_2", tlv544));
        if (this.sig.t553 && this.apk.buildtime >= 1691565978) tlvs.push(t(0x553));
    }

    const writer = new Writer()
        .writeU16(2)
        .writeU16(tlvs.length);
    for (const tlv of tlvs)
        writer.writeBytes(tlv);
    const body = writer.read();
    this.sendLogin("wtlogin.login", body);
}

WtLogin.prototype.deviceLogin = function () {
    const t = this.tlvPacker;
    const tlvs = [
        t(0x8),
        t(0x104),
        t(0x116),
        t(0x401),
    ];

    const writer = new Writer()
        .writeU16(20)
        .writeU16(tlvs.length);
    for (const tlv of tlvs)
        writer.writeBytes(tlv);
    const body = writer.read();
    this.sendLogin("wtlogin.login", body);
}

WtLogin.prototype.sendSMSCode = function () {
    if (!this.t104 || !this.t174)
        return this.logger.warn("未收到设备锁验证要求，你不能调用sendSMSCode函数。");
    const t = this.tlvPacker;
    const tlvs = [
        t(0x8),
        t(0x104),
        t(0x116),
        t(0x174),
        t(0x17a),
        t(0x197),
    ];

    const writer = new Writer()
        .writeU16(8)
        .writeU16(tlvs.length);
    for (const tlv of tlvs)
        writer.writeBytes(tlv);
    const body = writer.read();
    this.logger.mark(`已向手机 ${this.phone} 发送短信验证码，请查看并输入。`);
    this.sendLogin("wtlogin.login", body);
}

WtLogin.prototype.submitSMSCode = async function (code) {
    if (!this.t104 || !this.t174)
        return this.logger.warn("未发送短信验证码，你不能调用submitSMSCode函数。");
    code = String(code).trim();
    if (Buffer.byteLength(code) !== 6)
        code = "123456";
    const t = this.tlvPacker;
    const tlvs = [
        t(0x8),
        t(0x104),
        t(0x116),
        t(0x174),
        t(0x17c, code),
        t(0x401),
        t(0x198),
    ];
    if (this.apk.ssover > 12) {
        let tlv544;
        try {
            tlv544 = await this.c.getT544("810_7");
        } catch (e) {
            const message = e.message || "[qsign][T544] 未知错误";
            this.logger.error(message);
            this.c.em("system.login.error", { code: -1, message: message });
            return;
        }
        tlvs.push(t(0x544, "810_7", tlv544));
        if (this.sig.t553 && this.apk.buildtime >= 1691565978) tlvs.push(t(0x553));
    }

    let writer = new Writer()
        .writeU16(7)
        .writeU16(tlvs.length);
    for (const tlv of tlvs)
        writer.writeBytes(tlv);
    const body = writer.read();
    this.sendLogin("wtlogin.login", body);
}

WtLogin.prototype.tokenLogin = async function (d2) {
    const t = this.tlvPacker;
    const tlvs = [
        t(0x100),
        t(0x10a),
        t(0x116),
        t(0x108),
        t(0x144),
        //t(0x112),
        t(0x143, d2),
        t(0x142),
        t(0x154),
        t(0x18),
        t(0x141),
        t(0x8),
        t(0x147),
        t(0x177),
        t(0x187),
        t(0x188),
        t(0x194),
        t(0x511),
        t(0x202),
    ];
    if (this.apk.ssover > 12) {
        let tlv544;
        try {
            tlv544 = await this.c.getT544("810_a");
        } catch (e) {
            const message = e.message || "[qsign][T544] 未知错误";
            this.logger.error(message);
            this.c.em("system.login.error", { code: -1, message: message });
            return;
        }
        tlvs.push(t(0x544, "810_a", tlv544));
        if (this.sig.t553 && this.apk.buildtime >= 1691565978) tlvs.push(t(0x553));
    }
    const writer = new Writer()
        .writeU16(11)
        .writeU16(tlvs.length);
    for (const tlv of tlvs)
        writer.writeBytes(tlv);
    const body = writer.read();
    this.sendLogin("wtlogin.exchange_emp", body);
}

WtLogin.prototype.refreshD2 = async function () {
    if (!this.c.isOnline() || timestamp() - this.sig.emp_time < 14000)
        return
    this.device.tgtgt = md5(this.sig.d2key);
    const t = this.tlvPacker;
    const tlvs = [
        t(0x100),
        t(0x10a),
        t(0x116),
        t(0x144),
        t(0x143, this.sig.d2),
        t(0x142),
        t(0x154),
        t(0x18),
        t(0x141),
        t(0x8),
        t(0x147),
        t(0x177),
        t(0x187),
        t(0x188),
        t(0x202),
        t(0x511),
    ];
    if (this.apk.ssover > 12) {
        let tlv544;
        try {
            tlv544 = await this.c.getT544("810_a");
        } catch (e) {
            const message = e.message || "[qsign][T544] 未知错误";
            this.logger.error(message);
            this.c.em("system.login.error", { code: -1, message: message });
            return;
        }
        tlvs.push(t(0x544, "810_a", tlv544));
        if (this.sig.t553 && this.apk.buildtime >= 1691565978) tlvs.push(t(0x553));
    }
    const writer = new Writer()
        .writeU16(11)
        .writeU16(tlvs.length);
    for (const tlv of tlvs)
        writer.writeBytes(tlv);
    const body = writer.read();
    const seq = this.c.nextSeq();
    const pkt = await this._buildLoginPacket("wtlogin.exchange_emp", this._buildOICQPacket(body), 2, seq);
    try {
        let payload = await this.c.send(pkt, undefined, seq);
        payload = tea.decrypt(payload.slice(16, payload.length - 1), this.ecdh.share_key);
        const stream = Readable.from(payload, { objectMode: false });
        stream.read(2);
        const type = stream.read(1).readUInt8();
        stream.read(2);
        const t = readTlv(stream);
        if (type === 0)
            this.decodeT119(t[0x119], true);
        const success = await this.register();
        if (!success)
            return this.c.emit("internal.network", "服务器繁忙(register)");
        await this.exchangeEmp();
    } catch { }
}
