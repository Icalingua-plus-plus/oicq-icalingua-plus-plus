"use strict";

const {
    randomBytes,
    createCipheriv,
    createDecipheriv,
    createHash,
} = require("crypto");
const { WtLogin } = require("../wtlogin/wt");
const Writer = require("../wtlogin/writer");
const Ecdh = require("./ecdh");
const pb = require("../algo/pb");
const tea = require("../algo/tea");
const { md5, timestamp, BUF0, BUF4 } = require("../common");
const { TimeoutError } = require("../exception");

const NT_LOGIN_CMD_PREFIX = "trpc.login.ecdh.EcdhService.";
const NT_LOGIN_COMMANDS = Object.freeze({
    KEY_EXCHANGE: NT_LOGIN_CMD_PREFIX + "SsoKeyExchange",
    PASSWORD_LOGIN: NT_LOGIN_CMD_PREFIX + "SsoNTLoginPasswordLogin",
    PASSWORD_LOGIN_UNUSUAL_DEVICE: NT_LOGIN_CMD_PREFIX + "SsoNTLoginPasswordLoginUnusualDevice",
    EASY_LOGIN: NT_LOGIN_CMD_PREFIX + "SsoNTLoginEasyLogin",
    REFRESH_TICKET: NT_LOGIN_CMD_PREFIX + "SsoNTLoginRefreshTicket",
    REFRESH_A2: NT_LOGIN_CMD_PREFIX + "SsoNTLoginRefreshA2",
});

const NT_LOGIN_PROOF_KEY = Buffer.from(
    "e2733bf403149913cbf80c7a95168bd4ca6935ee53cd39764beebe2e007e3aee",
    "hex",
);

const NTLoginErrorCode = {
    AccountNotUin: 140022018,
    AccountOrPasswordError: 140022013,
    BlackAccount: 150022021,
    CookieExpired: 150022039,
    CookieUsedExceedUpperLimit: 150022040,
    Default: 140022000,
    ExpireTicket: 140022014,
    Frozen: 140022005,
    IllegalTicket: 140022016,
    IllegalAccount: 150022030,
    InterfaceUnavailable: 150022031,
    InvalidCookie: 140022012,
    InvalidParameter: 140022001,
    KickedTicket: 140022015,
    NeedUpdate: 140022004,
    NewDevice: 140022010,
    ProofWater: 140022008,
    Strict: 140022007,
    Success: 0,
    UnusualDevice: 140022011,
};

const NT_LOGIN_PLATFORM_ID = {
    Android: 2,
    Mac: 5,
    iPad: 6,
};

/**
 * @param {any} value
 * @returns {Buffer}
 */
function toBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (value && typeof value.toBuffer === "function") {
        const buffer = value.toBuffer();
        return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    }
    return BUF0;
}

/**
 * @param {any} value
 * @returns {string}
 */
function toString(value) {
    return value === undefined || value === null ? "" : String(value);
}

/**
 * @param {any} value
 * @returns {number}
 */
function toNumber(value) {
    if (typeof value === "bigint") return Number(value);
    return Number(value || 0);
}

/**
 * @param {any} value
 * @returns {any}
 */
function first(value) {
    return Array.isArray(value) ? value[0] : value;
}

/**
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @returns {number}
 */
function getNTLoginPlatform(wt) {
    return NT_LOGIN_PLATFORM_ID[wt.apk.platform] || 2;
}

/**
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @returns {string}
 */
function getNTLoginPlatformName(wt) {
    return String(wt.apk.platform || "Android").toUpperCase();
}

/**
 * @param {Buffer} data
 * @param {Buffer} key
 * @returns {Buffer}
 */
function aesGcmEncrypt(data, key) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", toBuffer(key), iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([iv, encrypted, cipher.getAuthTag()]);
}

/**
 * @param {Buffer} data
 * @param {Buffer} key
 * @returns {Buffer}
 */
function aesGcmDecrypt(data, key) {
    if (!Buffer.isBuffer(data) || data.length < 28)
        throw new Error("invalid AES-GCM data");
    const iv = data.subarray(0, 12);
    const tag = data.subarray(-16);
    const decipher = createDecipheriv("aes-256-gcm", toBuffer(key), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
        decipher.update(data.subarray(12, -16)),
        decipher.final(),
    ]);
}

/**
 * @param {Buffer} data
 * @returns {Buffer}
 */
function sha256(data) {
    return createHash("sha256").update(data).digest();
}

/**
 * NT 0x106 is intentionally kept here. The normal TLV packer must retain
 * the original OICQ behavior, while NT uses sso_ver=0 and subid=1.
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @param {Buffer} md5pass
 * @returns {Buffer}
 */
function buildNTPasswordA1(wt, md5pass) {
    md5pass = toBuffer(md5pass);
    if (!md5pass.length) return toBuffer(wt.t106);
    const body = new Writer()
        .writeU16(4)
        .writeBytes(randomBytes(4))
        .writeU32(0)
        .writeU32(wt.apk.appid)
        .writeU32(0)
        .writeU64(wt.uin)
        .write32((Date.now() / 1000) & 0xffffffff)
        .writeBytes(BUF4)
        .writeU8(1)
        .writeBytes(md5pass)
        .writeBytes(wt.device.tgtgt)
        .writeU32(0)
        .writeU8(1)
        .writeBytes(wt.device.guid)
        .writeU32(1)
        .writeU32(1)
        .writeTlv(String(wt.uin))
        .writeU16(0)
        .read();
    const uin = Buffer.alloc(4);
    uin.writeUInt32BE(wt.uin);
    const key = md5(Buffer.concat([md5pass, BUF4, uin]));
    return tea.encrypt(body, key);
}

/**
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @param {boolean} passwordLogin
 * @returns {object}
 */
function buildNTLoginHead(wt, passwordLogin) {
    const head = {
        1: {
            1: String(wt.uin),
        },
        2: {
            1: getNTLoginPlatformName(wt),
            2: wt.device.model,
            3: getNTLoginPlatform(wt),
            4: wt.device.guid,
        },
        3: {
            1: passwordLogin ? "" : wt.apk.ver,
            2: wt.apk.appid,
            3: wt.apk.id,
            5: wt.apk.qua,
        },
    };
    if (passwordLogin) head[7] = { 1: 1 };
    if (wt.nt_login_cookie) head[5] = { 1: wt.nt_login_cookie };
    return head;
}

/**
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @param {object} proto
 * @returns {Promise<Buffer>}
 */
async function buildNTServicePacket(wt, proto) {
    if (!await wt.keyExchange()) throw new Error("NT key exchange failed");
    const inner = wt.apk.appid === 16
        ? { 2: proto, 3: { 1: 0, 2: String(wt.uin) } }
        : proto;
    const encrypted = aesGcmEncrypt(pb.encode(inner), wt.nt_session.key);
    return Buffer.from(pb.encode({
        1: wt.nt_session.ticket,
        [wt.apk.appid === 16 ? 5 : 3]: encrypted,
        4: 1,
    }));
}

/**
 * 构造 SsoKeyExchange 包。
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @param {number} seq
 * @returns {Promise<Buffer>}
 */
async function buildSsoKeyExchangePacket(wt, seq) {
    if (!wt.nt_ecdh) wt.nt_ecdh = new Ecdh();
    const ecdh = wt.nt_ecdh;
    const plain1 = pb.encode({
        1: "",
        2: wt.device.guid,
    });
    const gcmCalc1 = aesGcmEncrypt(plain1, ecdh.nt_share_key);
    const ts = Date.now();
    const plain2 = new Writer()
        .writeBytes(ecdh.public_key)
        .writeU32(1)
        .writeBytes(gcmCalc1)
        .writeU64(ts)
        .read();
    const gcmCalc2 = aesGcmEncrypt(sha256(plain2), NT_LOGIN_PROOF_KEY);
    const body = pb.encode({
        1: ecdh.public_key,
        2: 1,
        3: gcmCalc1,
        4: ts,
        5: gcmCalc2,
    });
    return wt._buildLoginPacket(NT_LOGIN_COMMANDS.KEY_EXCHANGE, body, 2, seq, 0);
}

/**
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @returns {object|undefined}
 */
function buildNTCaptcha(wt) {
    const captcha = wt.nt_captcha;
    if (!captcha) return undefined;
    const match = /(?:^|[?&])sid=([^&]*)/.exec(String(captcha.url || ""));
    return {
        1: captcha.ticket,
        2: captcha.randStr,
        3: match ? match[1] : "",
    };
}

/**
 * 构造 SsoNTLoginPasswordLogin 包。
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @returns {Promise<Buffer>}
 */
async function buildSsoNTLoginPasswordLoginPacket(wt) {
    const proto = {
        1: buildNTLoginHead(wt, true),
        2: {
            1: toBuffer(wt.t106),
            2: buildNTCaptcha(wt),
            5: { 1: 1 },
        },
    };
    const packet = await buildNTServicePacket(wt, proto);
    wt.nt_captcha = null;
    return packet;
}

/**
 * 构造 SsoNTLoginPasswordLoginUnusualDevice 包。
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @returns {Promise<Buffer>}
 */
async function buildSsoNTLoginPasswordLoginUnusualDevicePacket(wt) {
    const proto = {
        1: buildNTLoginHead(wt, true),
        2: {
            1: toBuffer(wt.t106),
            2: wt.nt_unusual_device_check_sig,
        },
    };
    const packet = await buildNTServicePacket(wt, proto);
    wt.nt_unusual_device_check_sig = null;
    return packet;
}

/**
 * 构造 SsoNTLoginEasyLogin 包。
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @returns {Promise<Buffer>}
 */
async function buildSsoNTLoginEasyLoginPacket(wt) {
    return buildNTServicePacket(wt, {
        1: buildNTLoginHead(wt, false),
        2: {
            1: toBuffer(wt.t106),
            2: wt.sig.srm_token,
        },
    });
}

/**
 * 构造 SsoNTLoginRefreshTicket 包。
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @returns {Promise<Buffer>}
 */
async function buildSsoNTLoginRefreshTicketPacket(wt) {
    return buildNTServicePacket(wt, {
        1: buildNTLoginHead(wt, false),
        2: {
            1: toBuffer(wt.t106),
            2: wt.sig.srm_token,
        },
    });
}

/**
 * 构造 SsoNTLoginRefreshA2 包。
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @returns {Promise<Buffer>}
 */
async function buildSsoNTLoginRefreshA2Packet(wt) {
    return buildNTServicePacket(wt, {
        1: buildNTLoginHead(wt, false),
        2: {
            1: wt.sig.tgt,
            2: wt.sig.d2,
            3: wt.sig.d2key,
        },
    });
}

WtLogin.prototype.buildSsoKeyExchangePacket = function (seq) {
    return buildSsoKeyExchangePacket(this, seq);
};
WtLogin.prototype.buildSsoNTLoginPasswordLoginPacket = function () {
    return buildSsoNTLoginPasswordLoginPacket(this);
};
WtLogin.prototype.buildSsoNTLoginPasswordLoginUnusualDevicePacket = function () {
    return buildSsoNTLoginPasswordLoginUnusualDevicePacket(this);
};
WtLogin.prototype.buildSsoNTLoginEasyLoginPacket = function () {
    return buildSsoNTLoginEasyLoginPacket(this);
};
WtLogin.prototype.buildSsoNTLoginRefreshTicketPacket = function () {
    return buildSsoNTLoginRefreshTicketPacket(this);
};
WtLogin.prototype.buildSsoNTLoginRefreshA2Packet = function () {
    return buildSsoNTLoginRefreshA2Packet(this);
};
/**
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @returns {boolean}
 */
function hasNTSession(wt) {
    const session = wt.nt_session;
    return !!session && Buffer.isBuffer(session.key) && session.key.length === 32 &&
        Buffer.isBuffer(session.ticket) && session.ticket.length > 0 &&
        session.expire_time - timestamp() >= 60;
}

/**
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @returns {Promise<boolean>}
 */
async function performNTKeyExchange(wt) {
    wt.nt_session = null;
    if (!wt.nt_ecdh) wt.nt_ecdh = new Ecdh();
    const seq = wt.c.nextSeq();
    const packet = await wt.buildSsoKeyExchangePacket(seq);
    const response = pb.decode(await wt.c.send(packet, 6, seq));
    const encrypted = toBuffer(response?.[1]);
    const serverPublicKey = toBuffer(response?.[3]);
    if (!encrypted.length || !serverPublicKey.length) return false;
    const shareKey = wt.nt_ecdh.ntExchange(serverPublicKey);
    const session = pb.decode(aesGcmDecrypt(encrypted, shareKey));
    const key = toBuffer(session?.[1]);
    const ticket = toBuffer(session?.[2]);
    const expire = toNumber(session?.[3]);
    if (key.length !== 32 || !ticket.length || !expire) return false;
    wt.nt_session = {
        key,
        ticket,
        expire_time: timestamp() + expire,
    };
    wt.logger.debug(`NT key exchange succeeded, session: ${expire}s`);
    return true;
}

WtLogin.prototype.keyExchange = function () {
    if (hasNTSession(this)) return Promise.resolve(true);
    if (!this.ntKeyExchangePromise) {
        this.ntKeyExchangePromise = performNTKeyExchange(this).finally(() => {
            this.ntKeyExchangePromise = null;
        });
    }
    return this.ntKeyExchangePromise;
};

/**
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @param {Buffer} payload
 * @returns {Buffer}
 */
function decryptNTLoginPacket(wt, payload) {
    if (!wt.nt_session) return BUF0;
    const response = pb.decode(payload);
    const encrypted = toBuffer(response?.[wt.apk.appid === 16 ? 5 : 3]);
    if (!encrypted.length) throw new Error("invalid NT login response");
    const decrypted = aesGcmDecrypt(encrypted, wt.nt_session.key);
    if (wt.apk.appid !== 16) return decrypted;
    const inner = pb.decode(decrypted);
    return toBuffer(inner?.[2]);
}

/**
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @param {string} cmd
 * @param {Buffer} body
 * @param {number} timeout
 * @returns {Promise<void>}
 */
async function sendNTLoginPacket(wt, cmd, body, timeout = 5) {
    try {
        const seq = wt.c.nextSeq();
        const packet = await wt._buildLoginPacket(cmd, body, 2, seq);
        const response = await wt.c.send(packet, timeout, seq);
        await decodeNTLoginResponse(wt, cmd, decryptNTLoginPacket(wt, response));
    } catch (e) {
        wt.logger.error(e.message || e);
        if (wt.token_flag && e instanceof TimeoutError === false)
            await wt.deleteToken();
        wt.c.emit("internal.network", "服务器繁忙");
    }
}

/**
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @param {string} cmd
 * @param {() => Promise<Buffer>} builder
 * @returns {Promise<void>}
 */
async function sendNTLoginWithBuilder(wt, cmd, builder) {
    let body;
    try {
        body = await builder.call(wt);
    } catch (e) {
        const message = e.message || "NT login packet build failed";
        wt.logger.error(message);
        wt.c.em("system.login.error", { code: -1, message });
        return;
    }
    return sendNTLoginPacket(wt, cmd, body, 5);
}

WtLogin.prototype.ntPasswordLogin = function (md5pass) {
    this.nt_ecdh = new Ecdh();
    this.nt_session = null;
    this.t106 = buildNTPasswordA1(this, md5pass);
    if (this.nt_unusual_device_check_sig) {
        return sendNTLoginWithBuilder(
            this,
            NT_LOGIN_COMMANDS.PASSWORD_LOGIN_UNUSUAL_DEVICE,
            this.buildSsoNTLoginPasswordLoginUnusualDevicePacket,
        );
    }
    return sendNTLoginWithBuilder(
        this,
        NT_LOGIN_COMMANDS.PASSWORD_LOGIN,
        this.buildSsoNTLoginPasswordLoginPacket,
    );
};

WtLogin.prototype.ntHasCaptcha = function () {
    return !!this.nt_captcha;
};

WtLogin.prototype.ntSubmitCaptcha = function (ticket, randStr = "") {
    if (!this.nt_captcha || !this.t106?.length) return;
    this.nt_captcha.ticket = ticket;
    this.nt_captcha.randStr = randStr;
    return sendNTLoginWithBuilder(
        this,
        NT_LOGIN_COMMANDS.PASSWORD_LOGIN,
        this.buildSsoNTLoginPasswordLoginPacket,
    );
};

/**
 * NT返回的token字段直接落到现有WtLogin字段：
 * a1 -> t106，a1_key -> t10c，a2 -> sig.tgt，a2_key -> sig.tgt_key，
 * d2 -> sig.d2，d2_key -> sig.d2key，no_pic_sig -> sig.srm_token。
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @param {any} payload
 * @returns {boolean}
 */
function parseNTToken(wt, payload) {
    const token = payload?.[1];
    if (!token || typeof token !== "object") return false;
    const a1 = toBuffer(token[3]);
    const a1Key = toBuffer(token[14]);
    const a2 = toBuffer(token[4]);
    const a2Key = toBuffer(token[17]);
    const d2 = toBuffer(token[5]);
    const d2key = toBuffer(token[6]);
    const noPicSig = toBuffer(token[13]);
    if (a1.length) wt.readT106(a1);
    if (a1Key.length) wt.readT10C(a1Key);
    if (a2.length) wt.sig.tgt = a2;
    if (a2Key.length) wt.sig.tgt_key = a2Key;
    if (d2.length) wt.sig.d2 = d2;
    if (d2key.length) wt.sig.d2key = d2key;
    if (noPicSig.length) wt.sig.srm_token = noPicSig;

    const uid = first(payload?.[4]?.[2]) || first(payload?.[2]?.[2]);
    if (uid) wt.uid = toString(uid);
    const user = payload?.[4]?.[3];
    const nickname = user?.[1] ? toString(user[1]) : wt.c.nickname;
    wt.nickname = nickname;
    if (a1Key.length) {
        wt.device.tgtgt = a1Key;
        wt.t10c = a1Key;
    } else if (d2key.length) {
        wt.device.tgtgt = md5(d2key);
    }
    return true;
}

/**
 * @param {any} errorInfo
 * @returns {string}
 */
function getNTErrorMessage(errorInfo) {
    if (!errorInfo) return "NT 登录失败";
    const title = errorInfo[2] ? toString(errorInfo[2]) : "登录失败";
    const content = errorInfo[3] ? toString(errorInfo[3]) : "未知错误";
    return `[${title}]${content}`;
}

/**
 * 解码 NT 登录返回并转换为现有 OICQ 登录事件。
 * @param {import("../wtlogin/wt").WtLogin} wt
 * @param {string} cmd
 * @param {Buffer} payload
 * @returns {Promise<any>}
 */
async function decodeNTLoginResponse(wt, cmd, payload) {
    wt.NTLoginResponse = payload;
    const proto = pb.decode(payload);
    if (!proto) throw new Error("invalid NT login response");
    const errorInfo = proto[1]?.[4];
    const code = errorInfo ? toNumber(errorInfo[1]) : 0;
    wt.nt_login_cookie = proto[1]?.[5]?.[1]
        ? toString(proto[1][5][1])
        : null;

    if (code === NTLoginErrorCode.Success) {
        if (!parseNTToken(wt, proto[2]))
            throw new Error("NT login response has no token");
        if (wt.apk.appid === 16) {
            wt.token_flag = true;
            return wt.tokenLogin(wt.sig.d2);
        }
        return wt.c.emit("internal.login");
    }

    if (code === NTLoginErrorCode.Strict) {
        const message = getNTErrorMessage(errorInfo);
        let jump;
        if (errorInfo?.[7]?.length && errorInfo[7][0]?.[2]) {
            jump = {
                word: toString(errorInfo[7][0][1]),
                url: toString(errorInfo[7][0][2]),
            };
        } else if (errorInfo?.[5]) {
            jump = {
                word: toString(errorInfo[4]),
                url: toString(errorInfo[5]),
            };
        }
        if (jump?.url) {
            wt.logger.mark(message);
            wt.logger.mark("访问URL完成验证后调用login()可直接登录（需要提交设备信息）。");
            wt.logger.mark(`${jump.word}: ${jump.url}`);
            return wt.c.em("system.login.auth", {
                url: jump.url,
                device: wt.buildLoginAuthDevice(),
            });
        }
        wt.logger.error(message);
        return wt.c.em("system.login.error", { code: 237, message });
    }

    if (code === NTLoginErrorCode.ProofWater) {
        const url = errorInfo?.[5]
            ? toString(errorInfo[5])
            : proto[2]?.[2]?.[3]
                ? toString(proto[2][2][3])
                : "";
        if (url) {
            wt.nt_captcha = { url };
            wt.logger.mark(`收到滑动验证码，请访问以下地址完成滑动，并从网络响应中取出ticket和randstr参数以英文逗号拼接输入：${url}`);
            return wt.c.em("system.login.slider", { url });
        }
        wt.logger.error("[登陆失败]未知格式的验证码。");
        return wt.c.em("system.login.error", {
            code: 2,
            message: "[登陆失败]未知格式的验证码。",
        });
    }

    if (code === NTLoginErrorCode.NewDevice) {
        const url = errorInfo?.[5] ? toString(errorInfo[5]) : "";
        wt.logger.mark("登录保护验证URL：" + url);
        return wt.c.em("system.login.device", {
            url,
            phone: "",
        });
    }

    if (code === NTLoginErrorCode.UnusualDevice) {
        const detail = proto[2]?.[3];
        if (detail?.[2]) {
            wt.nt_unusual_device_check_sig = toBuffer(detail[2]);
        }
        const url = detail?.[3] ? toString(detail[3]) : "";
        wt.logger.warn("[登陆失败]当前设备环境异常，请完成设备验证后重新登录");
        if (url) wt.logger.mark("登录保护验证URL：" + url);
        return wt.c.em("system.login.device", {
            url,
            phone: "",
        });
    }

    const message = getNTErrorMessage(errorInfo);
    if (code === NTLoginErrorCode.NeedUpdate) {
        wt.logger.warn(message + "(错误码：" + code + ")");
        return wt.c.em("system.login.error", { code, message });
    }

    if (cmd === NT_LOGIN_COMMANDS.EASY_LOGIN || cmd === NT_LOGIN_COMMANDS.REFRESH_TICKET) {
        await wt.deleteToken();
        return wt.passwordLogin();
    }
    return wt.c.em("system.login.error", { code, message });
}

module.exports = {
    NT_LOGIN_CMD_PREFIX,
    NT_LOGIN_COMMANDS,
    NTLoginErrorCode,
    buildSsoKeyExchangePacket,
    buildSsoNTLoginPasswordLoginPacket,
    buildSsoNTLoginPasswordLoginUnusualDevicePacket,
    buildSsoNTLoginEasyLoginPacket,
    buildSsoNTLoginRefreshTicketPacket,
    buildSsoNTLoginRefreshA2Packet,
};
