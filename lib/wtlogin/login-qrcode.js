/**
 * 二维码登录流程
 * 
 * token -> ok(二次)
 * token not exists ↘
 *                     fetch -> qrcodeLogin -> ok
 * token (expired)  ↗
 */
"use strict";
const fs = require("fs");
const path = require("path");
const Readable = require("stream").Readable;
const jsqr = require("jsqr");
const { PNG } = require("pngjs");
const qrt = require("qrcode-terminal");
const { WtLogin, readTlv, BUF_UNKNOWN} = require("./wt");
const tea = require("../algo/tea");
const Writer = require("./writer");
const { timestamp, BUF16, BUF0 } = require("../common");

const ERROR_FETCH = new Error("获取二维码失败，请重试。");
const ERROR_SCAN = new Error("扫描二维码失败，请重新获取。");
const ERROR_UNKNOWN = new Error("扫码遇到未知错误。");
const ERROR_TIMEOUT = new Error("二维码超时，请重新获取。");
const ERROR_CANCELLED = new Error("扫码设备取消登录，请重新获取。");

WtLogin.prototype._buildTransEmpPacket = async function (cmdid, head, body, seq = 0) {
    seq = seq ? seq : this.c.nextSeq();
    body = new Writer()
        .writeBytes(head)
        .writeU32(timestamp())
        .writeU8(2)
        .writeU16(44 + body.length)
        .writeU16(cmdid)
        .writeBytes(Buffer.alloc(21))
        .writeU8(3)
        .writeU16(0)
        .writeU16(50)
        .writeU32(this.seq_id)
        .writeU64(0)
        .writeBytes(body)
        .writeU8(3)
        .read();

    body = new Writer()
        .writeU8(0x02)
        .writeU8(0x01)
        .writeBytes(this.random_key)
        .writeU16(0x131)
        .writeU16(0x01)
        .writeTlv(this.ecdh.public_key)
        .writeBytes(tea.encrypt(body, this.ecdh.share_key))
        .read();

    body = new Writer()
        .writeU8(0x02)
        .writeU16(29 + body.length)
        .writeU16(8001)
        .writeU16(0x812)
        .writeU16(1)
        .writeU32(0)
        .writeU8(3)
        .writeU8(0x87)
        .writeU8(0)
        .writeU32(2)
        .writeU32(0)
        .writeU32(0)
        .writeBytes(body)
        .writeU8(0x03)
        .read();

    const reserveFields = await this.c.buildSSOReserveField("wtlogin.trans_emp", Buffer.from(body), seq);

    return new Writer()
        .writeWithLength(
            new Writer()
            .writeU32(0x0A)
            .writeU8(2)
            .writeWithLength(BUF0)
            .writeU8(0)
            .writeWithLength("0")
            .writeBytes(tea.encrypt(
                new Writer()
                .writeWithLength(
                    new Writer().writeU32(this.seq_id)
                    .writeU32(this.apk.subid)
                    .writeU32(this.apk.subid)
                    .writeBytes(BUF_UNKNOWN)
                    .writeWithLength(BUF0)
                    .writeWithLength("wtlogin.trans_emp")
                    .writeWithLength(this.session_id)
                    .writeWithLength(this.device.android_id)
                    .writeWithLength(this.sig._ksid || BUF0)
                    .writeU16(this.ksid.length + 2)
                    .writeBytes(this.ksid)
                    .writeWithLength(reserveFields)
                    .read()
                )
                .writeWithLength(body)
                .read(), BUF16)
            )
            .read()
        )
        .read();
}

WtLogin.prototype.fetchQrcode = async function () {
    if (this.qrcode_sig)
        return this.qrcodeLogin();
    const t = this.tlvPacker;
    const body = new Writer()
        .writeU16(0)
        .writeU32(16)
        .writeU64(0)
        .writeU8(8)
        .writeTlv(BUF0)
        .writeU16(6)
        .writeBytes(t(0x16))
        .writeBytes(t(0x1B))
        .writeBytes(t(0x1D))
        .writeBytes(t(0x1F))
        .writeBytes(t(0x33))
        .writeBytes(t(0x35))
        .read()
    const seq = this.c.nextSeq();
    const pkt = await this._buildTransEmpPacket(0x31, Buffer.from("0001110000001000000072000000", "hex"), body, seq);
    try {
        let payload = await this.c.send(pkt, undefined, seq);
        payload = tea.decrypt(payload.slice(16, -1), this.ecdh.share_key);
        const stream = Readable.from(payload, { objectMode: false });
        stream.read(54);
        const retcode = stream.read(1)[0];
        const sig = stream.read(stream.read(2).readUInt16BE());
        stream.read(2);
        const t = readTlv(stream);
        if (!retcode && t[0x17]) {
            this.qrcode_sig = sig;
            const filepath = path.join(this.dir, "qrcode.png");
            await fs.promises.writeFile(filepath, t[0x17]);
            this.logger.mark("请用手机QQ扫描二维码，若打印出错请打开：" + filepath);
            try {
                const qrdata = PNG.sync.read(t[0x17]);
                const qr = jsqr(new Uint8ClampedArray(qrdata.data), qrdata.width, qrdata.height);
                qrt.generate(qr.data, console.log);
            } catch { }
            setTimeout(() => {
                this.fetchQrcode();
            }, 1000);
            return this.c.em("system.login.qrcode", {
                image: t[0x17]
            });
        }
        throw ERROR_FETCH;
    } catch (e) {
        this.logger.error(e.message);
        this.c.em("system.login.error", {
            message: "获取二维码失败，请重试。",
            code: -1
        })
    }
};

WtLogin.prototype.qrcodeLogin = async function () {
    const body = new Writer()
        .writeU16(5)
        .writeU8(1)
        .writeU32(8)
        .writeU32(16)
        .writeTlv(this.qrcode_sig)
        .writeU64(0)
        .writeU8(8)
        .writeTlv(BUF0)
        .writeU16(0)
        .read()
    const seq = this.c.nextSeq();
    const pkt = await this._buildTransEmpPacket(0x12, Buffer.from("0000620000001000000072000000", "hex"), body, seq);
    try {
        let payload = await this.c.send(pkt, undefined, seq);
        payload = tea.decrypt(payload.slice(16, -1), this.ecdh.share_key);
        const stream = Readable.from(payload, { objectMode: false });
        stream.read(48);
        let len = stream.read(2).readUInt16BE();
        if (len > 0) {
            len--;
            if (stream.read(1)[0] === 2) {
                stream.read(8);
                len -= 8;
            }
            if (len > 0) {
                stream.read(len);
            }
        }
        stream.read(4);
        const retcode = stream.read(1)[0];
        this.logger.debug("二维码扫码结果：" + retcode);
        if (retcode != 0) {
            switch (retcode) {
                case 0x30: // 48, 等待扫描中
                case 0x35: // 53, 被扫描等待确认
                    return;
                case 0x31: // 49, 超时未查询扫码结果
                case 0x11: // 17, 二维码已失效(120s)
                    this.qrcode_sig = undefined;
                    throw ERROR_TIMEOUT;
                case 0x36: // 54, 扫码设备取消登录
                    this.qrcode_sig = undefined;
                    throw ERROR_CANCELLED;
                default:
                    this.qrcode_sig = undefined;
                    throw ERROR_SCAN;
            }
        }
        this.qrcode_sig = undefined;
        stream.read(4);
        const uin = stream.read(4).readUInt32BE();
        if (uin !== this.uin)
            throw new Error(`扫码账号(${uin})与登录账号(${this.uin})不符`);
        stream.read(6);
        const t = readTlv(stream);
        const t106 = t[0x18];
        const t16a = t[0x19];
        const t318 = t[0x65];
        const tgtgt = t[0x1e];
        if (t106 && t16a && t318 && tgtgt) {
            this.t106 = t106;
            this.device.tgtgt = tgtgt;
            this.sig.srm_token = t16a;
            this._qrcodeLogin(t16a, t318);
        } else {
            throw ERROR_UNKNOWN;
        }
    } catch (e) {
        this.logger.error(e.message);
        this.c.em("system.login.error", {
            message: e.message,
            code: -2
        })
    }
};

WtLogin.prototype._qrcodeLogin = async function (t16a, t318) {
    const t = this.tlvPacker;
    const tlvs = [
        t(0x18),
        t(0x1),
        t(0x106, this.t106),
        t(0x116),
        t(0x100),
        t(0x107),
        t(0x142),
        t(0x144),
        t(0x145),
        t(0x147),
        t(0x16a),
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
    tlvs.push(t(0x191));
    if (!this.device.qimei16){
        tlvs.push(t(0x202)); // should have been removed
    }
    tlvs.push(t(0x177));
    tlvs.push(t(0x516));
    tlvs.push(t(0x521));
    tlvs.push(t(0x318, t318));
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
    if (this.sig.t553) tlvs.push(t(0x553));
    tlvs.push(t(0x542));

    const writer = new Writer()
        .writeU16(9)
        .writeU16(tlvs.length);
    for (const tlv of tlvs)
        writer.writeBytes(tlv);
    const body = writer.read();
    this.sendLogin("wtlogin.login", body);
};
