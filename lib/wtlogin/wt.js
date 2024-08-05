"use strict";
const fs = require("fs");
const path = require("path");
const { randomBytes, createHash } = require("crypto");
const Readable = require("stream").Readable;
const tea = require("../algo/tea");
const jce = require("../algo/jce");
const pb = require("../algo/pb");
const Ecdh = require("./ecdh");
const Writer = require("./writer");
const tlv = require("./tlv");
const { timestamp, md5, BUF16, BUF4, BUF0, NOOP } = require("../common");
const { TimeoutError } = require("../exception");

const BUF_UNKNOWN = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00]);
const BUF_UNKNOWN2 = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00]);

class WtLogin {

    tlvPacker = tlv.getPacker(this);
    ecdh = new Ecdh;

    t104; //滑动验证码、短信验证、设备锁用
    t174; //短信验证用
    phone; //密保手机号，短信验证用

    token_flag = false;

    session_id = randomBytes(4);
    random_key = randomBytes(16);

    qrcode_sig; //用于扫码登录

    get logger() { return this.c.logger; }
    get dir() { return this.c.dir; }
    get uin() { return this.c.uin; }
    get password_md5() { return this.c.password_md5; }
    get device() { return this.c.device; }
    get apk() { return this.c.apk; }
    get seq_id() { return this.c.seq_id; }
    get cookies() { return this.c._cookies; }
    get ksid() {
        return Buffer.from('||' + this.apk.name);
    }
    get sig() { return this.c.sig; }
    set sig(val) { this.c.sig = val; }
    set nickname(val) { this.c.nickname = val; }
    set sex(val) { this.c.sex = val; }
    set age(val) { this.c.age = val; }
    get uid() { return this.c.uid; }
    set uid(val) { this.c.uid = val; }

    /**
     * @param {import("../ref").Client} c 
     */
    constructor(c) {
        this.c = c;
    }

    async sendLogin(cmd, body) {
        const seq = this.c.nextSeq();
        let pkt;
        try {
            pkt = await this._buildLoginPacket(cmd, this._buildOICQPacket(body), 2, seq);
        } catch (e) {
            const message = e.message || "[qsign][HeadSign] 未知错误";
            this.logger.error(message);
            this.c.em("system.login.error", { code: -1, message: message });
            return;
        }
        try {
            const payload = await this.c.send(pkt, undefined, seq);
            this._decodeLoginResponse(payload);
        } catch (e) {
            this.logger.error(e.message);
            if (this.token_flag && (e instanceof TimeoutError === false))
                await this.deleteToken();
            this.c.emit("internal.network", "服务器繁忙");
        }
    }

    /**
     * @this {import("../ref").Client}
     * @param {Buffer} data 
     */
    decodeT119(data, token = false) {
        const reader = Readable.from(tea.decrypt(data, this.device.tgtgt), { objectMode: false });
        reader.read(2);
        const t = readTlv(reader);
        this.readT106(t[0x106]);
        this.readT10C(t[0x10c]);
        this.readT11A(t[0x11a]);
        this.readT512(t[0x512]);
        this.sig = {
            srm_token: t[0x16a] ? t[0x16a] : this.sig.srm_token,
            tgt: t[0x10a] ? t[0x10a] : this.sig.tgt,
            tgt_key: t[0x10d] ? t[0x10d] : this.sig.tgt_key,
            st_key: t[0x10e] ? t[0x10e] : this.sig.st_key,
            st_web_sig: t[0x103] ? t[0x103] : this.sig.st_web_sig,
            t103: t[0x103] ? t[0x103] : this.sig.t103,
            t543: t[0x543] ? t[0x543] : this.sig.t543,
            t547: this.sig.t547,
            t553: this.sig.t553,
            skey: t[0x120] ? t[0x120] : this.sig.skey,
            d2: t[0x143] ? t[0x143] : this.sig.d2,
            d2key: t[0x305] ? t[0x305] : this.sig.d2key,
            sig_key: t[0x133] ? t[0x133] : this.sig.sig_key,
            ticket_key: t[0x134] ? t[0x134] : this.sig.ticket_key,
            device_token: t[0x322] ? t[0x322] : this.sig.device_token,
            emp_time: timestamp(),
            time_diff: this.sig.time_diff,
            _ksid: t[0x108] || this.sig._ksid,
            qsign_token_time: 0,
        };
        this.device.tgtgt = t[0x10c] || this.device.tgtgt
        this.uid = this.uid || (this.sig.t543.length > 6 ? this.sig.t543.slice(6).toString() : "");
        if (t[0x550] && !this.uid) {
            const t550 = pb.decode(t[0x550]);
            if (t550[19])
                this.uid = String(t550[19][1] || "");
        }
        let token_writer = new Writer()
            .writeTlv(this.sig.d2key)
            .writeTlv(this.sig.d2)
            .writeTlv(this.sig.ticket_key)
            .writeTlv(this.sig.sig_key)
            .writeTlv(this.sig.srm_token)
            .writeTlv(this.sig.tgt);
        if (this.sig.device_token) token_writer.writeTlv(this.sig.device_token);
        else token_writer.writeTlv(BUF0);
        token_writer.writeTlv(this.sig._ksid);
        fs.writeFile(
            path.join(this.dir, "token"),
            token_writer.read(),
            { mode: 0o600 },
            NOOP
        );
        fs.writeFile(
            path.join(this.dir, "uid"),
            this.uid,
            { mode: 0o600 },
            NOOP
        );
    }
    readT106(data) {
        if (!data) return;
        this.t106 = data;
        fs.writeFile(
            path.join(this.dir, "t106"),
            data,
            { mode: 0o600 },
            NOOP
        );
    }
    readT10C(data) {
        if (!data) return;
        this.t10c = data;
        fs.writeFile(
            path.join(this.dir, "t10c"),
            data,
            { mode: 0o600 },
            NOOP
        );
    }
    readT11A(data) {
        if (!data) return;
        const stream = Readable.from(data, { objectMode: false });
        stream.read(2);
        this.age = stream.read(1).readUInt8();
        this.sex = ["unknown", "male", "female"][stream.read(1).readUInt8()];
        const nickname = stream.read(stream.read(1).readUInt8() & 0xff);
        this.nickname = nickname ? String(nickname) : "";
    }
    readT512(data) {
        if (!data) return;
        const stream = Readable.from(data, { objectMode: false });
        let len = stream.read(2).readUInt16BE();
        while (len-- > 0) {
            const domain = String(stream.read(stream.read(2).readUInt16BE()));
            const pskey = stream.read(stream.read(2).readUInt16BE());
            const pt4token = stream.read(stream.read(2).readUInt16BE());
            this.cookies[domain] = pskey;
        }
    }

    calcPoW(data) {
        if (!data || data.length === 0) return Buffer.alloc(0);
        const stream = Readable.from(data, { objectMode: false });
        const version = stream.read(1).readUInt8();
        const typ = stream.read(1).readUInt8();
        const hashType = stream.read(1).readUInt8();
        let ok = stream.read(1).readUInt8() === 0;
        const maxIndex = stream.read(2).readUInt16BE();
        const reserveBytes = stream.read(2);
        const src = stream.read(stream.read(2).readUInt16BE());
        const tgt = stream.read(stream.read(2).readUInt16BE());
        const cpy = stream.read(stream.read(2).readUInt16BE());

        if (hashType !== 1) {
            this.logger.warn(`Unsupported tlv546 hash type ${hashType}`);
            return Buffer.alloc(0);
        }
        let inputNum = BigInt("0x" + src.toString("hex"));
        switch (typ) {
            case 1:
                // TODO
                // See https://github.com/mamoe/mirai/blob/cc7f35519ea7cc03518a57dc2ee90d024f63be0e/mirai-core/src/commonMain/kotlin/network/protocol/packet/login/wtlogin/WtLoginExt.kt#L207
                this.logger.warn(`Unsupported tlv546 algorithm type ${typ}`);
                break;
            case 2:
                // Calc SHA256
                let dst;
                let elp = 0, cnt = 0;
                if (tgt.length === 32) {
                    const start = Date.now();
                    let hash = createHash("sha256").update(Buffer.from(inputNum.toString(16).padStart(256, "0"), "hex")).digest();
                    while (Buffer.compare(hash, tgt) !== 0) {
                        inputNum ++;
                        hash = createHash("sha256").update(Buffer.from(inputNum.toString(16).padStart(256, "0"), "hex")).digest();
                        cnt++;
                        if (cnt > 1000000) {
                            this.logger.error("Calculating PoW cost too much time, maybe something wrong");
                            throw new Error("Calculating PoW cost too much time, maybe something wrong");
                        }
                    }
                    ok = true;
                    dst = Buffer.from(inputNum.toString(16).padStart(256, "0"), "hex");
                    elp = Date.now() - start;
                    this.logger.info(`Calculating PoW of plus ${cnt} times cost ${elp} ms`);
                }
                if (!ok) return Buffer.alloc(0);
                const body = new Writer()
                    .writeU8(version)
                    .writeU8(typ)
                    .writeU8(hashType)
                    .writeU8(ok ? 1 : 0)
                    .writeU16(maxIndex)
                    .writeBytes(reserveBytes)
                    .writeTlv(src)
                    .writeTlv(tgt)
                    .writeTlv(cpy)
                    .writeTlv(dst)
                    .writeU32(elp)
                    .writeU32(cnt);
                return body.read();
            default:
                this.logger.warn(`Unsupported tlv546 algorithm type ${typ}`);
                break;
            }
        return Buffer.alloc(0);
    }

    _decodeLoginResponse(payload) {
        payload = tea.decrypt(payload.slice(16, payload.length - 1), this.ecdh.share_key);
        const stream = Readable.from(payload, { objectMode: false });
        stream.read(2);
        const type = stream.read(1).readUInt8();
        stream.read(2);
        const t = readTlv(stream);
    
        if (t[0x546]) this.sig.t547 = this.calcPoW(t[0x546]);
    
        if (type === 204) {
            this.t104 = t[0x104];
            this.logger.mark("unlocking...");
            return this.deviceLogin();
        }
    
        if (type === 0) {
            this.t104 = undefined;
            this.t174 = undefined;
            this.phone = undefined;
            this.decodeT119(t[0x119], this.token_flag);
            return this.c.emit("internal.login");
        }
    
        if (this.token_flag) {
            this.logger.mark("token失效，重新login..");
            if (t[0x146]) {
                const stream = Readable.from(t[0x146], { objectMode: false });
                const version = stream.read(4);
                const title = stream.read(stream.read(2).readUInt16BE()).toString();
                const content = stream.read(stream.read(2).readUInt16BE()).toString();
                const message = `[${title}]${content}`;
                this.logger.warn("token失效: " + message + "(错误码：" + type + ")");
            }
            return this.deleteToken().then(this.passwordLogin.bind(this));
        }
    
        if (type === 2) {
            this.t104 = t[0x104];
            if (t[0x192]) {
                const url = String(t[0x192]);
                this.logger.mark(`收到滑动验证码，请访问以下地址完成滑动，并从网络响应中取出ticket输入：${url}`);
                return this.c.em("system.login.slider", { url });
            }
            const message = "[登陆失败]未知格式的验证码。";
            this.logger.error(message);
            return this.c.em("system.login.error", {
                code: 2, message
            });
        }
    
        if (type === 160 || type === 162 || type === 239) {
            let url = ""
            if (t[0x204])
                url = String(t[0x204]).replace("verify", "qrcode");
            this.logger.mark("登录保护二维码验证地址：" + url);
            if (t[0x174] && t[0x178]) {
                this.t104 = t[0x104];
                this.t174 = t[0x174];
                this.phone = String(t[0x178]).substr(t[0x178].indexOf("\x0b") + 1, 11);
            }
            return this.c.em("system.login.device", { url, phone: this.phone });
        }

        if (t[0x149]) {
            const stream = Readable.from(t[0x149], { objectMode: false });
            stream.read(2);
            const title = stream.read(stream.read(2).readUInt16BE()).toString();
            const content = stream.read(stream.read(2).readUInt16BE()).toString();
            const message = `[${title}]${content}`;
            this.logger.error(message + "(错误码：" + type + ")");
            return this.c.em("system.login.error", { code: type, message });
        }
    
        if (t[0x146]) {
            const stream = Readable.from(t[0x146], { objectMode: false });
            const version = stream.read(4);
            const title = stream.read(stream.read(2).readUInt16BE()).toString();
            const content = stream.read(stream.read(2).readUInt16BE()).toString();
            const message = `[${title}]${content}`;
            this.logger.error(message + "(错误码：" + type + ")");
            return this.c.em("system.login.error", { code: type, message });
        }
    
        this.logger.error("[登陆失败]未知错误，错误码：" + type);
        this.c.em("system.login.error", {
            code: type,
            message: "[登陆失败]未知错误。"
        });
    }

    async heartbeat() {
        const seq = this.c.nextSeq();
        const pkt = await this._buildLoginPacket("Heartbeat.Alive", BUF0, 0, seq);
        return this.c.send(pkt, undefined, seq).catch(NOOP);
    }

    async ssoHeartbeat() {
        const body = pb.encode({
            1: 1,
            2: {
                1: 1,
            },
            3: 53,
            4: timestamp(),
        });
        const pkt = await this.c.sendUni("trpc.qq_new_tech.status_svc.StatusService.SsoHeartBeat", body);
        return pkt;
    }

    async syncTimeDiff() {
        const seq = this.c.nextSeq();
        const pkt = await this._buildLoginPacket("Client.CorrectTime", BUF4, 0, seq);
        this.c.send(pkt, undefined, seq).then(buf => {
            try {
                this.sig.time_diff = buf.readInt32BE() - timestamp();
                this.logger.debug("同步时间成功。时间差：" + this.sig.time_diff + "s");
            } catch {
                this.logger.warn("同步时间失败。");
            }
        }).catch(e => {
            this.logger.warn("同步时间失败。");
        });
    }

    async register(logout = false) {
        if (this.c.config.useNT) {
            return await this.registerNT(logout);
        }
        const pb_buf = pb.encode({
            1: [
                { 1: 46, 2: timestamp() },
                { 1: 283, 2: 0 }
            ]
        });
        const d = this.device;
        const SvcReqRegister = jce.encodeStruct([
            this.uin,
            (logout ? 0 : 7), 0, "", (logout ? 21 : 11), 0, 0, 0, 0, 0, (logout ? 44 : 0),
            d.version.sdk, 1, "", 0, null, d.guid, 2052, 0, d.model, d.model,
            d.version.release, 1, 0, 0, null, 0, 0, "", 0, d.brand,
            d.brand, "", pb_buf, 0, null, 0, null, 1000, 98
        ]);
        const extra = {
            service: "PushService",
            method: "SvcReqRegister",
        };
        const body = jce.encodeWrapper({ SvcReqRegister }, extra);
        const seq = this.c.nextSeq();
        const pkt = await this._buildLoginPacket("StatSvc.register", body, 1, seq);
        try {
            const blob = await this.c.send(pkt, undefined, seq);
            const rsp = jce.decode(blob);
            const result = rsp[9] ? true : false;
            if (!result && !logout)
                await this.deleteToken();
            return result;
        } catch {
            return false;
        }
    }

    async registerNT(logout = false) {
        const d = this.device;
        const seq = this.c.nextSeq();
        if (logout) {
            const payload = pb.encode({
                1: 0,
                2: {
                    1: d.brand + '-' + d.model,
                    2: d.device,
                    3: d.version.release,
                    4: d.brand,
                    5: `${d.product}-user ${d.version.release} ${d.display} ${d.version.incremental} release-keys`
                },
                3: 0,
            });
            const pkt = await this._buildLoginPacket("trpc.qq_new_tech.status_svc.StatusService.UnRegister", payload, 1, seq);
            try {
                const blob = await this.c.send(pkt, undefined, seq);
                const rsp = pb.decode(blob);
                const result = rsp[7] ? String(rsp[7][2]) === 'unregister success' : false;
                return result;
            } catch {
                return false;
            }
        }

        const pb_buf = pb.encode({
            1: 735,
            2: randomBytes(4).readUInt32BE(),
            4: 2,
            5: 0,
            6: {
                1: {
                },
                2: 0,
                3: {
                },
            },
            8: {
                1: [
                    {
                        1: 46,
                        2: 0,
                    },
                    {
                        1: 283,
                        2: 0,
                    },
                ]
            },
            9: {
                1: d.guid.toString("hex"),
                2: 0,
                3: String(this.apk.version.split(".")[3]),
                4: 0,
                5: 2052,
                6: {
                    1: d.brand + '-' + d.model,
                    2: d.device,
                    3: d.version.release,
                    4: d.brand,
                    5: `${d.product}-user ${d.version.release} ${d.display} ${d.version.incremental} release-keys`
                },
                7: 0,
                8: 5,
                9: 1,
                10: {
                    1: 1,
                    2: 1,
                },
                11: 0,
            },
            10: {
                1: 0,
                2: 1,
            },
            11: {
                1: 0,
                2: 1,
                3: 0,
            },
        });
        const pkt = await this._buildLoginPacket("trpc.msg.register_proxy.RegisterProxy.SsoInfoSync", pb_buf, 1, seq);
        try {
            const blob = await this.c.send(pkt, undefined, seq);
            const rsp = pb.decode(blob);
            const result = rsp[7] ? String(rsp[7][2]) === 'register success' : false;
            return result;
        } catch {
            return false;
        }
    }

    /**
     * @param {Buffer} body 
     * @returns {Buffer}
     */
    _buildOICQPacket(body, emp = false) {
        if (emp) {
            body = new Writer()
                .writeTlv(this.sig.sig_key)
                .writeBytes(tea.encrypt(body, this.sig.ticket_key))
                .read();
        } else {
            body = new Writer()
                .writeU8(0x02)
                .writeU8(0x01)
                .writeBytes(this.random_key)
                .writeU16(0x131)
                .writeU16(0x01)
                .writeTlv(this.ecdh.public_key)
                .writeBytes(tea.encrypt(body, this.ecdh.share_key))
                .read();
        }
        return new Writer()
            .writeU8(0x02)
            .writeU16(29 + body.length) // 1 + 27 + body.length + 1
            .writeU16(8001)             // protocol ver
            .writeU16(0x810)            // command id
            .writeU16(1)                // const
            .writeU32(this.uin)
            .writeU8(3)                 // const
            .writeU8(emp ? 69 : 0x87)   // encrypt type 7:0 69:emp 0x87:4
            .writeU8(0)                 // const
            .writeU32(2)                // const
            .writeU32(0)                // app client ver
            .writeU32(0)                // const
            .writeBytes(body)
            .writeU8(0x03)
            .read();
    }

    /**
     * @param {string} cmd 
     * @param {Buffer} body 
     * @param {0|1|2} type 0心跳 1上线 2登录
     * @param {number} seq
     * @returns {Promise<Buffer>}
     */
    async _buildLoginPacket(cmd, body, type, seq = 0) {
        seq = seq ? seq : this.c.nextSeq();
        this.logger.trace(`send:${cmd} seq:${seq}`);
        let signProtobuf = BUF0;
        if (this.c.needSignCmd.includes(cmd)) signProtobuf = await this.c.getSign(cmd, Buffer.from(body), seq);
        const ntRegCmds = [
            "trpc.msg.register_proxy.RegisterProxy.SsoInfoSync",
            "trpc.qq_new_tech.status_svc.StatusService.UnRegister"
        ];
        if (ntRegCmds.includes(cmd)) {
            signProtobuf = pb.encode({
                9: 1,
                11: 2052,
                12: this.device.qimei36 || this.device.qimei16 || this.device.android_id,
                14: 0,
                15: '00-00000000000000000000000000000000-0000000000000000-00',
                16: String(this.uid),
                18: 0,
                19: 1,
                20: 1,
                21: 34,
                26: 100,
                28: 3,
            });
        }
        let sso = new Writer().writeU32(seq)
            .writeU32(this.apk.subid)
            .writeU32(this.apk.subid)
            .writeBytes(ntRegCmds.includes(cmd) ? BUF_UNKNOWN2 : BUF_UNKNOWN)
            .writeWithLength(this.sig.tgt)
            .writeWithLength(cmd)
            .writeWithLength(this.session_id)
            .writeWithLength(this.device.android_id)
            .writeWithLength(this.sig._ksid || BUF0)
            .writeU16(this.ksid.length + 2)
            .writeBytes(this.ksid)
            .writeWithLength(signProtobuf)
            .read();
        sso = new Writer().writeWithLength(sso).writeWithLength(body).read();
        if (type === 1)
            sso = tea.encrypt(sso, this.sig.d2key);
        else if (type === 2)
            sso = tea.encrypt(sso, BUF16);
        body = new Writer()
            .writeU32(0x0A)
            .writeU8(type)
            .writeWithLength(this.sig.d2)
            .writeU8(0)
            .writeWithLength(String(this.uin))
            .writeBytes(sso)
            .read();
        return new Writer().writeWithLength(body).read();
    }

    deleteToken() {
        return fs.promises.rename(
            path.join(this.dir, "token"),
            path.join(this.dir, "token." + Date.now())
        ).catch(NOOP);
        //return fs.promises.unlink(path.join(this.dir, "token")).catch(NOOP);
    }

    async exchangeEmp() {
        if (!this.t10c || !this.c.isOnline())
            return;
        this.device.tgtgt = this.t10c;
        const t = this.tlvPacker;
        const tlvs = [
            t(0x18),
            t(0x1),
            t(0x106, this.t106),
            t(0x116),
            t(0x100, 1),
            t(0x107),
            t(0x108),
            t(0x144),
            t(0x142),
            t(0x145),
            t(0x16a),
            t(0x154),
            t(0x141),
            t(0x8),
            t(0x511),
            t(0x147),
            t(0x177),
            //t(0x400),
            t(0x187),
            t(0x188),
            //t(0x194),
            //t(0x202),
            t(0x516),
            t(0x521),
            t(0x525),
        ];
        if (this.apk.ssover > 12) {
            let tlv544;
            try {
                tlv544 = await this.c.getT544("810_f");
            } catch (e) {
                const message = e.message || "[qsign][T544] 未知错误";
                this.logger.error(message);
                this.c.em("system.login.error", { code: -1, message: message });
                return;
            }
            tlvs.push(t(0x544, "810_f", tlv544));
            if (this.sig.t553 && this.apk.buildtime >= 1691565978) tlvs.push(t(0x553));
        }
        if (this.device.qimei16) {
            tlvs.push(t(0x545, this.device.qimei16));
        }
        const writer = new Writer()
            .writeU16(15)
            .writeU16(tlvs.length);
        for (const tlv of tlvs)
            writer.writeBytes(tlv);
        const body = writer.read();
        const pkt = this._buildOICQPacket(body, true);
        try {
            let payload = await this.c.sendUni("wtlogin.exchange_emp", pkt);
            payload = tea.decrypt(payload.slice(16, payload.length - 1), this.sig.ticket_key);
            const stream = Readable.from(payload, { objectMode: false });
            stream.read(5);
            const t = readTlv(stream);
            if (t[0x119])
                this.decodeT119(t[0x119]);
            else
                this.logger.warn("刷新cookies失败，未收到t119。");
        } catch (e) {
            this.logger.warn("刷新cookies失败。");
            this.logger.warn(e);
        }
    }
}

/**
 * @param {Readable} stream 
 * @returns {{[k: number]: Buffer}}
 */
function readTlv(stream) {
    const t = { };
    while (stream.readableLength > 2) {
        const k = stream.read(2).readUInt16BE();
        t[k] = stream.read(stream.read(2).readUInt16BE());
    }
    return t;
}

module.exports = {
    WtLogin, readTlv, BUF_UNKNOWN,
};

require("./login-password");
require("./login-qrcode");
