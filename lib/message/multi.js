"use strict";
const { Readable } = require("stream");
const zlib = require("zlib");
const util = require("util");
const { randomBytes } = require("crypto");
const face = require("./face");
const { ImageBuilder, uploadImages } = require("./image");
const tea = require("../algo/tea");
const pb = require("../algo/pb");
const common = require("../common");
const { highwayUploadStream, int32ip2str } = require("../service");
const gzip = util.promisify(zlib.gzip);
const deflate = util.promisify(zlib.deflate);
const { getC2CMsgs, getGroupMsgs } = require("./history");
const http = require("http");
const https = require("https");
const BUF1 = Buffer.from([1]);

function buildTextElem(str) {
    if (!str) str = "";
    return {
        1: {
            1: String(str)
        }
    };
}

function buildFaceElem(id) {
    id = Number(id);
    if (id <= 0xff) {
        const old = Buffer.allocUnsafe(2);
        old.writeUInt16BE(0x1441 + id);
        return {
            2: {
                1: id,
                2: old,
                11: face.FACE_OLD_BUF
            }
        };
    } else {
        const text = face.map[id] || ("/" + id);
        return {
            53: {
                1: 33,
                2: {
                    1: id,
                    2: text,
                    3: text
                },
                3: 1
            }
        };
    }
}

async function buildXmlElem(xml, svcid = 60) {
    svcid = parseInt(svcid);
    return {
        12: {
            1: Buffer.concat([BUF1, await deflate(String(xml))]),
            2: svcid > 0 ? svcid : 60,
        }
    };
}

async function buildJsonElem(obj) {
    if (typeof obj !== "string")
        obj = JSON.stringify(obj);
    return {
        51: {
            1: Buffer.concat([BUF1, await deflate(obj)])
        }
    };
}

/**
 * @this {import("../ref").Client}
 * @param {String} id 
 */
async function getMsg(id) {
    if (id.length > 24) {
        const { group_id ,user_id, seq, random, time } = common.parseGroupMessageId(id);
        const msgs = await getGroupMsgs.call(this, group_id, seq, seq);
        return { user_id, seq, random, time, msg: msgs[0] };
    } else {
        const { user_id, seq, random, time, flag } = common.parseC2CMessageId(id);
        const msgs = await getC2CMsgs.call(this, user_id, time, 10);
        for (let i = msgs.length - 1; i >= 0; --i) {
            const msg = msgs[i];
            if (common.genRandom(msg[1][7]) === random)
                return { user_id, seq, random, time, msg, flag };
        }
        throw new Error();
    }
}
/**
 * @this {import("../ref").Client}
 * @param {Buffer} resid 
 * @param {Number} bu 
 * @returns {Promise<Buffer>}
 */
async function _downloadMultiMsg(resid, bu) {
    const body = pb.encode({
        1: 2,
        2: 5,
        3: 9,
        4: 3,
        5: this.apk.version,
        7: [{
            1: resid,
            2: 3,
        }],
        8: bu,
        9: 2,
    });
    const blob = await this.sendUni("MultiMsg.ApplyDown", body);
    const rsp = pb.decode(blob)[3];
    const ip = int32ip2str(Array.isArray(rsp[4]) ? rsp[4][0] : rsp[4]),
        port = Array.isArray(rsp[5]) ? rsp[5][0] : rsp[5];
    let url = port == 443 ? `https://${ip}` : `http://${ip}:${port}`;
    url += rsp[2];
    const headers = {
        "Host": `${port == 443 ? 'ssl.' : ''}htdata.qq.com`,
        "User-Agent": `QQ/${this.apk.version} CFNetwork/1126`,
        "Net-Type": "Wifi"
    };
    return new Promise((resolve, reject) => {
        const protocol = port == 443 ? https : http;
        protocol.get(url, { headers }, (res) => {
            const data = [];
            res.on("data", (chunk) => data.push(chunk));
            res.on("end", async () => {
                try {
                    let buf = Buffer.concat(data);
                    if (res.headers["accept-encoding"] && res.headers["accept-encoding"].includes("gzip"))
                        buf = await common.unzip(buf);
                    const head_len = buf.readUInt32BE(1);
                    const body_len = buf.readUInt32BE(5);
                    buf = tea.decrypt(buf.slice(head_len + 9, head_len + 9 + body_len), rsp[3].toBuffer());
                    buf = pb.decode(buf)[3];
                    // if (Array.isArray(buf)) buf = buf[0];
                    buf = await common.unzip(buf[3].toBuffer());
                    resolve(buf);
                } catch (e) {
                    e.message = "wrong resid";
                    reject(e);
                }
            });
        }).on("error", reject);
    });
}

/**
 * @this {import("../ref").Client}
 * @param {import("../ref").FakeMessage[]} iterable 
 */
async function makeForwardMsg(iterable, dm = false, target = 0) {

    if (typeof iterable[Symbol.iterator] !== "function")
        iterable = [iterable];

    /** @type {import("../ref").Msg[]} */
    const nodes = [];
    /** @type {ImageBuilder[]} */
    const imgs = [];
    /** @type {Promise<void>[]} */
    const tasks = [];
    let preview = "";
    let cnt = 0;

    let Multi = [];

    for (const fake of iterable) {
        if (!fake.message || !common.checkUin(fake.user_id)) {
            console.log(fake)
            this.logger.warn("skip invalid FakeMessage: " + JSON.stringify(fake));
            continue;
        }
        const elements = [];
        let brief = "";
        {
            /** @type {import("../ref").MessageElem[]} */
            let sendable = fake.message;
            if (typeof sendable === "string" || typeof sendable[Symbol.iterator] !== "function")
                sendable = [sendable];
            
            for (const elem of sendable) {
                if (typeof elem === "string") {
                    elements.push(buildTextElem(elem));
                    brief += elem;
                    continue;
                }
                if (!elem.data)
                    continue;
                switch (elem.type) {
                case "text":
                case "at":
                    elements.push(buildTextElem(elem.data.text));
                    brief += elem.data.text;
                    break;
                case "face":
                    elements.push(buildFaceElem(elem.data.id));
                    brief += "[表情]";
                    break;
                case "image":
                    const img = new ImageBuilder(this, dm);
                    try {
                        await img.buildNested(elem.data);
                        imgs.push(img);
                        if (img.task)
                            tasks.push(img.task);
                        elements.push({ [dm?4:8]: img.nested });
                        brief += "[图片]";
                    } catch (e) {
                        this.logger.warn(e.message);
                    }
                    break;
                case "reply":
                    let user_id, seq, _random, time, source;
                    const parsed = Buffer.from(elem.data.id, "base64");
                    if (elem.data.id.length > 24) {
                        // Group
                        user_id = parsed.readUInt32BE(4);
                        seq = parsed.readUInt32BE(8);
                        _random = parsed.readUInt32BE(12);
                        time = parsed.readUInt32BE(16);
                    } else {
                        // C2C
                        user_id = parsed.readUInt32BE(0);
                        seq = parsed.readUInt32BE(4);
                        _random = parsed.readUInt32BE(8);
                        time = parsed.readUInt32BE(12);
                    }
                    source = buildTextElem(elem.data.text || " ");
                    elements.push({
                        45: {
                            1: [seq],
                            2: user_id,
                            3: time,
                            4: 1,
                            5: source,
                            6: 0,
                            8: {
                                3: common.genMessageUuid(_random)
                            }
                        }
                    });
                    break;
                case "xml":
                    elements.push(await buildXmlElem(elem.data.data, elem.data.type));
                    const resIdRegex = /m_resid="([\w+=/]+)"/
                    const fileNameRegex = /m_fileName="([\w+-=/]+)"/
                    if (resIdRegex.test(elem.data.data) && fileNameRegex.test(elem.data.data)) {
                        const resId = resIdRegex.exec(elem.data.data)[1];
                        const fileName = fileNameRegex.exec(elem.data.data)[1];
                        const buf = await _downloadMultiMsg.call(this, resId, 2);
                        let msgs = pb.decode(buf)[2];
                        if (!Array.isArray(msgs)) {
                            msgs = [msgs];
                        }
                        for (let msg of msgs) {
                            const m_fileName = msg[1].toString();
                            if (m_fileName === "MultiMsg") {
                                Multi.push({
                                    1: fileName,
                                    2: msg[2]
                                });
                            } else {
                                Multi.push(msg);
                            }
                        }
                        brief += "[聊天记录]";
                    } else {
                        brief += "[XML]";
                    }
                    break;
                case "json":
                    elements.push(await buildJsonElem(elem.data.data));
                    let jsonObj, resId, fileName
                    try {
                        jsonObj = JSON.parse(elem.data.data)
                        if (jsonObj.app === "com.tencent.multimsg") {
                            resId = jsonObj.meta.detail.resid
                            fileName = jsonObj.meta.detail.uniseq
                        }
                    } catch {}
                    if (resId && fileName) {
                        const buf = await _downloadMultiMsg.call(this, resId, 2);
                        let msgs = pb.decode(buf)[2];
                        if (!Array.isArray(msgs)) {
                            msgs = [msgs];
                        }
                        for (let msg of msgs) {
                            const m_fileName = msg[1].toString();
                            if (m_fileName === "MultiMsg") {
                                Multi.push({
                                    1: fileName,
                                    2: msg[2]
                                });
                            } else {
                                Multi.push(msg);
                            }
                        }
                        brief += "[聊天记录]";
                    } else {
                        brief += "[JSON]";
                    }
                    break;
                }
            }
        }

        if (!elements.length)
            continue;
        let seq = randomBytes(2).readInt16BE();
        let random = randomBytes(4).readInt32BE();
        fake.nickname = String(fake.nickname || fake.user_id);
        if (fake.id) {
            try {
                const parsed = Buffer.from(fake.id, "base64");
                if (fake.consistent) {
                    if (fake.id.length > 24) {
                        // Group
                        seq = parsed.readUInt32BE(8);
                        random = parsed.readUInt32BE(12);
                    } else {
                        // C2C
                        seq = parsed.readUInt32BE(4);
                        random = parsed.readUInt32BE(8);
                    }
                }
                if (!fake.bubble_id) {
                    const { msg } = await getMsg.call(this, fake.id);
                    for (let i of msg[3][1][2]) {
                        if (i[9]) {
                            elements.push(i);
                            elements.push({
                                37: {
                                    19: {
                                        15: 65536
                                    }
                                }
                            });
                            break;
                        }
                    }
                }
            } catch {
                this.logger.warn("invalid message id: " + fake.id);
            }
        }
        if (fake.bubble_id) {
            elements.push({
                9: {
                    1: fake.bubble_id
                }
            });
            elements.push({
                37: {
                    19: {
                        15: 65536
                    }
                }
            });
        }
        nodes.push({
            1: {
                1: fake.user_id,
                2: !target ? this.uin : target,
                3: dm ? 166 : 82,
                4: dm ? 11 : null,
                5: seq,
                6: fake.time || common.timestamp(),
                7: common.genMessageUuid(random),
                9: dm ? null : {
                    1: !target ? this.uin : target,
                    4: fake.nickname,
                },
                14: dm ? fake.nickname : null,
                20: {
                    1: 0,
                    2: random
                }
            },
            3: {
                1: {
                    2: elements
                }
            }
        });
        if (cnt < 4) {
            ++cnt
            preview += `<title color="#777777" size="26">${common.escapeXml(fake.nickname)}: ${common.escapeXml(brief.slice(0, 50))}</title>`;
        }
    }
    if (!nodes.length)
        throw new Error("empty message");

    Multi.unshift({
        1: "MultiMsg",
        2: {
            1: nodes
        }
    });

    await Promise.all(tasks);
    await uploadImages.call(this, this.uin, imgs, dm);

    const compressed = await gzip(pb.encode({
        1: nodes,
        2: Multi
    }));
    try {
        var resid = await uploadMultiMsg.call(this, this.uin, compressed);
    } catch (e) {
        throw new Error("failed to upload forward msg");
    }
    
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<msg brief="[聊天记录]" m_fileName="${common.uuid().toUpperCase()}" action="viewMultiMsg" tSum="${nodes.length}" flag="3" m_resid="${resid}" serviceID="35" m_fileSize="${compressed.length}"><item layout="1"><title color="#000000" size="34">转发的聊天记录</title>${preview}<hr></hr><summary color="#808080" size="26">查看${nodes.length}条转发消息</summary></item><source name="聊天记录"></source></msg>`;
    const data = {
        type: "xml",
        data: {
            data: xml,
            type: 35,
            // text: "你的QQ暂不支持查看[转发多条消息]，请期待后续版本。"
        }
    };
    return { result: 0, data};
}

/**
 * @this {import("../ref").Client}
 * @param {number} target 
 * @param {Buffer} compressed 
 * @returns {Promise<Buffer>} resid
 */
async function uploadMultiMsg(target, compressed) {
    const body = pb.encode({
        1: 1,
        2: 5,
        3: 9,
        4: 3,
        5: this.apk.version,
        6: [{
            1: target,
            2: compressed.length,
            3: common.md5(compressed),
            4: 3,
            5: 0,
        }],
        8: 1,
    });
    const blob = await this.sendUni("MultiMsg.ApplyUp", body);
    const rsp = pb.decode(blob)[2];
    if (rsp[1] > 0)
        throw new Error();
    const buf = pb.encode({
        1: 1,
        2: 5,
        3: 9,
        4: [{
            //1: 3,
            2: target,
            4: compressed,
            5: 2,
            6: rsp[3].toBuffer(),
        }],
    });
    const o = {
        buf: buf,
        md5: common.md5(buf),
        key: rsp[10].toBuffer()
    };
    const ip = Array.isArray(rsp[4]) ? rsp[4][0] : rsp[4],
        port = Array.isArray(rsp[5]) ? rsp[5][0] : rsp[5];
    await highwayUploadStream.call(this, Readable.from(Buffer.from(buf), { objectMode: false }), {
        cmd: 27,
        md5: common.md5(buf),
        size: buf.length,
        ticket: rsp[10].toBuffer(),
    }, ip, port, o);
    return rsp[2].toBuffer();
}

module.exports = {
    makeForwardMsg, uploadMultiMsg,
};
