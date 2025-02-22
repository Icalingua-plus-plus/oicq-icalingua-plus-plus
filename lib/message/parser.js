/**
 * 解析消息节点
 */
"use strict";
const http = require("http");
const https = require("https");
const querystring = require("querystring");
const tea = require("../algo/tea");
const pb = require("../algo/pb");
const face = require("./face");
const { getGroupMsgs } = require("./history");
const { int32ip2str } = require("../service");
const { buildImageFileParam, groupNTPicDown, offNTPicDown, checkImgUrl, getOffNTPicURL, getGroupNTPicURL, getNTPicURLbyFileid } = require("./image");
const { Gfs, getC2CFileUrl, getSyncDeviceFileUrl } = require("./file");
const { getVideoUrl, getPttUrl, getOffNTPttUrl, getGroupNTPttUrl, getOffNTVideoUrl, getGroupNTVideoUrl } = require("./ptt");
const { genC2CMessageId, genGroupMessageId, timestamp, parseFunString, code2uin, genRandom, unzip } = require("../common");

function escapeCQInside(s) {
    if (s === "&") return "&amp;";
    if (s === ",") return "&#44;";
    if (s === "[") return "&#91;";
    if (s === "]") return "&#93;";
}
function escapeCQ(s) {
    if (s === "&") return "&amp;";
    if (s === "[") return "&#91;";
    if (s === "]") return "&#93;";
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
    let host = `${port == 443 ? 'ssl.' : ''}htdata.qq.com`;
    if (this.storage.ip === "v6.htdata.qq.com") {
        url = "https://sslv6.htdata.qq.com" + rsp[2];
        host = "sslv6.htdata.qq.com";
    }
    const headers = {
        "Host": host,
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
                        buf = await unzip(buf);
                    const head_len = buf.readUInt32BE(1);
                    const body_len = buf.readUInt32BE(5);
                    buf = tea.decrypt(buf.slice(head_len + 9, head_len + 9 + body_len), rsp[3].toBuffer());
                    buf = pb.decode(buf)[3];
                    // if (Array.isArray(buf)) buf = buf[0];
                    buf = await unzip(buf[3].toBuffer());
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
 * 解析消息
 */
class Parser {

    /**
     * @type {import("../ref").MessageElem[]}
     */
    message = [];
    raw_message = "";
    bubble_id = 0;
    isNTImg = false;

    /**
     * @type {import("../ref").Anonymous}
     */
    anonymous = null;

    /**
     * @type {import("../ref").Proto}
     */
    extra;

    /**
     * @private
     * 排他型消息：语音、视频、闪照、json、xml、poke、文件
     */
    exclusive = false;

    /**
     * @private
     * @type {IterableIterator<[number, import("../ref").Proto]>}
     */
    it;

    atme = false;

    /**
     * @public
     * @param {import("../ref").Client} c 
     * @param {number} uid
     * @param {number} gid
     * @param {import("../ref").RichMsg} rich 
     */
    static async invoke(c, uid, gid, rich) {
        const parser = new Parser(c, uid, gid)
        await parser.parseMsg(rich);
        return parser;
    }
    
    /**
     * @private
     * @param {import("../ref").Client} c 
     * @param {number} uid 发送者 
     * @param {number} gid 群号 
     */
    constructor(c, uid, gid) {
        this.c = c;
        this.uid = uid;
        this.gid = gid;
    }

    /**
     * @private
     * @param {import("../ref").RichMsg} rich 
     */
    async parseMsg(rich) {
        let elems = rich[2], ptt = rich[4];
        if (!Array.isArray(elems))
            elems = [elems];
        if (ptt)
            await this.parseExclusiveElem(0, ptt);
        await this.parseElems(elems);
        if (this.message.length === 0) {
            this.message.push({ type: "text", data: { text: "该消息类型暂不支持查看" } });
            this.raw_message = this.raw_message || "该消息类型暂不支持查看";
        }
    }

    /**
     * 获取下一个节点的文本
     * @private
     * @returns {string}
     */
    getNextText() {
        try {
            const elem = this.it.next().value[1][1];
            return String(elem[1]);
        } catch {
            return "[未知]";
        }
    }

    /**
     * 解析排他型消息节点
     * xml, json, ptt, video, flash, file, shake, poke
     * @private
     * @param {number} type 
     * @param {import("../ref").Proto} elem 
     */
    async parseExclusiveElem(type, elem) {
        /**
         * @type {import("../ref").MessageElem}
         */
        const msg = {
            type: "",
            data: {}
        };
        let brief = "";
        switch (type) {
        case 12: //xml
        case 51: //json
            msg.type = type === 12 ? "xml" : "json";
            if (elem[1].toBuffer()[0] > 0)
                msg.data.data = String(await unzip(elem[1].toBuffer().slice(1)));
            else
                msg.data.data = String(elem[1].toBuffer().slice(1));
            if (elem[2] > 0)
                msg.data.type = elem[2];
            brief = `[${msg.type}消息]`;
            break;
        case 3: //flash
            msg.type = "flash";
            msg.data = await this.parseImgElem(type, elem);
            brief = "[闪照]";
            break;
        case 0: //ptt
            msg.type = "record";
            msg.data.file = "protobuf://" + elem.toBase64();
            if (!elem[4]) return;
            try {
                msg.data.url = await getPttUrl.call(this.c, elem, this.gid);
            } catch { }
            brief = "[语音]";
            break;
        case 19: //video
            msg.type = "video";
            msg.data.file = "protobuf://" + elem.toBase64();
            try {
                msg.data.url = await getVideoUrl.call(this.c, elem);
            } catch { }
            brief = "[视频]";
            break;
        case 5: //transElem
            msg.type = "file";
            msg.data = await this.parseTransElem(elem);
            brief = "[群文件]";
            break;
        case 17: //shake
            msg.type = "shake";
            brief = "[窗口抖动]";
            break;
        case 126: //poke
            if (!elem[3]) {
                msg.type = "shake";
                brief = "[窗口抖动]";
                break;
            }
            msg.type = "poke";
            msg.data.type = elem[3];
            if (elem[3] === 126) {
                msg.data.id = elem[2][4];
                msg.data.name = face.pokemap[elem[2][4]];
            } else {
                msg.data.id = -1;
                msg.data.name = face.pokemap[elem[3]];
            }
            brief = "[" + msg.data.name + "]";
            break;
        default:
            return;
        }
        this.exclusive = true;
        this.message = [msg];
        if (this.c.config.brief)
            this.raw_message = brief;
        else
            this.raw_message = genCQMsg(msg);
    }

    /**
     * 解析连续型消息节点
     * text, at, face, bface, sface, image, mirai, qlottie
     * @private
     * @param {number} type 
     * @param {import("../ref").Proto} elem 
     */
    async parsePartialElem(type, elem) {
        /**
         * @type {import("../ref").MessageElem}
         */
        const msg = {
            type: "",
            data: {}
        };
        let brief = "";
        switch (type) {
        case 1: //text&at
            brief = String(elem[1]);
            if (elem[3] && elem[3].toBuffer()[1] === 1) {
                msg.type = "at";
                if (elem[3].toBuffer()[6] === 1) {
                    msg.data.qq = "all";
                } else {
                    msg.data.qq = elem[3].toBuffer().readUInt32BE(7);
                    if (msg.data.qq === this.c.uin)
                        this.atme = true;
                }
                brief = "@" + brief ? brief : msg.data.qq;
            } else {
                if (!brief)
                    return;
                msg.type = "text";
            }
            msg.data.text = brief;
            break;
        case 2: //face
            msg.type = "face";
            msg.data.id = elem[1];
            msg.data.text = face.map[msg.data.id] || "表情";
            brief = `[${msg.data.text}]`;
            break;
        case 33: //face(id>255)
            msg.type = "face";
            msg.data.id = elem[1];
            msg.data.text = face.map[msg.data.id];
            if (!msg.data.text)
                msg.data.text = elem[2] ? String(elem[2]) : ("/" + msg.data.id);
            brief = msg.data.text;
            break;
        case 6: //bface
            brief = this.getNextText();
            if (brief.includes("骰子") || brief.includes("猜拳")) {
                msg.type = brief.includes("骰子") ? "dice" : "rps";
                msg.data.id = elem[12].toBuffer()[16] - 0x30 + 1;
            } else {
                msg.type = "bface";
                msg.data.file = elem[4].toHex() + elem[7].toHex() + elem[5];
                msg.data.text = brief.replace(/[[\]]/g, "");
                try {
                    let size = elem[13][1];
                    if (Array.isArray(size)) size = size[0];
                    msg.data.width = size[1];
                    msg.data.height = size[2];
                } catch { }
            }
            break;
        case 4:
        case 8:
            msg.type = "image";
            msg.data = await this.parseImgElem(type, elem);
            brief = "[图片]";
            if (this.isNTImg) return;
            break;
        case 34: //sface
            brief = this.getNextText();
            msg.type = "sface";
            msg.data.id = elem[1];
            msg.data.text = brief.replace(/[[\]]/g, "");
            break;
        case 31: //mirai
            if (elem[3] === 103904510) {
                brief = String(elem[2]);
                msg.type = "mirai";
                msg.data.data = brief;
            } else {
                return;
            }
            break;
        case 37: //qlottie
            msg.type = "face";
            msg.data.id = elem[2][3];
            if (elem[2][2]) msg.data.qlottie = String(elem[2][2]);
            if (elem[2][2]) msg.data.extra = JSON.stringify({
                packId: String(elem[2][1]), //string
                lottieId: String(elem[2][2]), //string
                faceId: elem[2][3], //number
                sourceType: elem[2][4], //number
                lottieType: elem[2][5], //number
                resultId: String(elem[2][6]), //string
                text: String(elem[2][7]), //string
                surpriseId: String(elem[2][8]), //string
                ramdomType: elem[2][9], //number
            });
            msg.data.text = face.map[msg.data.id];
            if (!msg.data.text)
                msg.data.text = elem[2][7] ? String(elem[2][7]) : ("/" + msg.data.id);
            brief = msg.data.text;
            break;
        case 45: //markdown
            msg.type = "markdown";
            brief = String(elem[1]);
            msg.data.markdown = brief;
            if (elem[2]) {
                msg.data.config = {
                    unknown: elem[2][1] || 1,
                    time: elem[2][2] || 0,
                    token: (elem[2][3] && elem[2][3].toHex) ? elem[2][3].toHex() : null,
                }
            }
            break;
        case 46: //markdown button
            //TODO
            return;
            break;
        case 48: //ntv2richmedia
            const businessType = elem[3];
            if ([10, 20].includes(businessType)) {
                //image
                msg.type = "image";
                try {
                    msg.data = await this.parseNTImgElem(type, elem[2], businessType);
                } catch {
                    return;
                }
                brief = "[图片]";
            } else if ([12, 22].includes(businessType)) {
                //record
                const dm = businessType === 12;
                msg.type = "record";
                msg.data.file = "protobuf://" + elem[2].toBase64();
                try {
                    msg.data.url = await (dm ? getOffNTPttUrl : getGroupNTPttUrl).call(this.c, elem[2][1][1], dm ? String(this.uid) : this.gid);
                } catch { }
                brief = "[语音]";
            } else if ([11, 21].includes(businessType)) {
                //video
                const dm = businessType === 11;
                msg.type = "video";
                msg.data.file = "protobuf://" + elem[2].toBase64();
                try {
                    let ntv2Files = elem[2][1];
                    if (!Array.isArray(ntv2Files)) ntv2Files = [ntv2Files];
                    for (let file of ntv2Files) {
                        const subType = file[1][6];
                        if (subType === 100) continue;
                        msg.data.url = await (dm ? getOffNTVideoUrl : getGroupNTVideoUrl).call(this.c, file[1], dm ? String(this.uid) : this.gid);
                    }
                } catch { }
                brief = "[视频]";
            } else {
                return;
            }
            break;
        default:
            return;
        }
        if (msg.type === "text") {
            if (!this.c.config.brief)
                brief = msg.data.text.replace(/[&[\]]/g, escapeCQ);
            if (this.message.length > 0 && this.message[this.message.length - 1].type === "text") {
                //合并文本节点
                this.message[this.message.length - 1].data.text += msg.data.text;
            } else {
                this.message.push(msg);
            }
        } else {
            if (!this.c.config.brief)
                brief = genCQMsg(msg);
            this.message.push(msg);
        }
        this.raw_message += brief;
    }

    /**
     * @private
     * @param {import("../ref").Proto[]} elems 
     */
    async parseElems(elems) {
        for (const ele of elems) {
            try {
                if (ele[53][1] === 48) this.isNTImg = true;
            } catch { }
        }
        this.it = elems.entries();
        while (true) {
            let wrapper = this.it.next().value;
            if (!wrapper)
                break;
            wrapper = wrapper[1];
            const type = parseInt(Object.keys(Reflect.getPrototypeOf(wrapper))[0]);
            const elem = wrapper[type];
            if (type === 16) { //extraInfo 额外情报
                this.extra = elem;
            } else if (type === 21) { //anonGroupMsg 匿名情况
                try {
                    const name = String(elem[3]);
                    this.anonymous = {
                        id: elem[6], name,
                        flag: name + "@" + elem[2].toBase64(),
                    };
                } catch {
                    this.c.logger.warn("解析匿名失败");
                }
            } else if (type === 37) { //generalFlags 超长消息，气泡等
                if (elem[6] === 1 && elem[7]) {
                    try {
                        const buf = await _downloadMultiMsg.call(this.c, elem[7].toBuffer(), 1);
                        let msg = pb.decode(buf)[1];
                        if (Array.isArray(msg)) msg = msg[0];
                        const parser = Parser.invoke(this.c, this.uid, this.gid, msg[3][1]);
                        this.message = parser.message;
                        this.raw_message = parser.raw_message;
                        this.anonymous = parser.anonymous;
                        this.extra = parser.extra;
                    } catch (e) {
                        this.c.logger.error("解析超长消息失败", e);
                    }
                    return;
                }
            } else if (type === 9) { //bubble 气泡
                this.bubble_id = elem[1] || 0;
            } else if (!this.exclusive) {
                switch (type) {
                case 1: //text
                case 2: //face
                case 4: //notOnlineImage
                case 6: //bface
                case 8: //customFace
                case 31: //mirai
                case 34: //sface
                    await this.parsePartialElem(type, elem);
                    break;
                case 5: //transElem
                case 12: //xml
                case 17: //shake
                case 19: //video
                case 51: //json
                    await this.parseExclusiveElem(type, elem);
                    break;
                case 53: //commonElem
                    if (elem[1] === 3) { //flash
                        await this.parseExclusiveElem(3, elem[2][1] ? elem[2][1] : elem[2][2]);
                    } else if (elem[1] === 33) { //face(id>255)
                        await this.parsePartialElem(33, elem[2]);
                    } else if (elem[1] === 2) { //poke
                        await this.parseExclusiveElem(126, elem);
                    } else if (elem[1] === 37) { //qlottie
                        await this.parsePartialElem(37, elem);
                        this.it.next();
                    } else if (elem[1] === 20) { //json only for mobileqq
                        await this.parseExclusiveElem(51, elem[2]);
                    } else if (elem[1] == 48) { //ntv2richmedia
                        await this.parsePartialElem(48, elem);
                    } else if (elem[1] == 45) { //markdown
                        await this.parsePartialElem(45, elem[2]);
                    }
                    break;
                case 45: //reply
                    await this.parseReplyElem(elem);
                    break;
                default:
                    break;
                }
            }
        }
    }

    /**
     * 解析QQNT图片
     * @private
     * @param {number} type 48|3
     * @param {import("../ref").Proto} elem 
     * @param {number} businessType 10|20
     */
    async parseNTImgElem(type, elem, businessType = 0) {
        const data = { };
        const dm = businessType === 10;
        const extra = (elem[2] && elem[2][1]) ? (elem[2][1][11] || elem[2][1][12] || { }) : { };
        let ntPath = String(extra[30] || "");
        try {
            if (ntPath && ntPath[0] !== "/") {
                ntPath = String(elem[1][2][1]) + ntPath;
            }
        } catch { }

        const imgInfo = elem[1][1];
        const md5 = String(imgInfo[1][2]); //string, not buffer
        const sha1 = String(imgInfo[1][3]);
        const fileName = String(imgInfo[1][4]);
        const size = imgInfo[1][1];
        const width = imgInfo[1][6];
        const height = imgInfo[1][7];
        const imgType = imgInfo[1][5][2];

        const fileid = String(imgInfo[2]);
        const storeId = imgInfo[3];
        const time = imgInfo[4];

        data.file = buildImageFileParam(md5, size, width, height, imgType);

        if (ntPath && storeId === 1) {
            data.url = `https://${elem[1][2][3]}${ntPath}&spec=0`;
        } else {
            data.url = `https://gchat.qpic.cn/gchatpic_new/0/0-0-${md5.toUpperCase()}/0`;
        }
        if (timestamp() - time > 60 * 60 || !(await checkImgUrl(data.url))) {
            // 图片地址失效，尝试发包获取
            let newURL = null;
            if (dm) { //私聊
                newURL = await getOffNTPicURL.call(this.c, imgInfo, String(this.uid));
            } else { //群聊
                newURL = await getGroupNTPicURL.call(this.c, imgInfo, this.gid);
            }
            if (newURL) {
                data.url = newURL;
            }
        }
        // QQNT 图片容错，某些 QQNT 的机器人会发出 appid 异常的图片
        data.url = data.url.replace("multimedia.nt.qq.com.cn", "gchat.qpic.cn"); //这个host下面似乎不检查rkey有效期
        if (!(await checkImgUrl(data.url))) {
            data.url = await getNTPicURLbyFileid.call(this.c, fileid);
        }
        this.isNTImg = true;
        return data;
    }

    /**
     * 解析图片
     * @private
     * @param {number} type 4|8|3
     * @param {import("../ref").Proto} elem 
     */
    async parseImgElem(type, elem) {
        const data = { };
        const dm = type === 3 ? (!!elem[1]) : (type === 4); //私图
        const md5 = dm ? elem[7] : elem[13];
        const fileName = dm ? elem[1] : elem[2];
        const fileid = dm ? elem[3] : elem[7];
        const fileResId = dm ? elem[10] : undefined;
        const extra = dm ? elem[29] : elem[34];
        const ntPath = extra ? String(extra[30]) : null;

        const size = dm ? elem[2] : elem[25];
        const width = dm ? elem[9] : elem[22];
        const height = dm ? elem[8] : elem[23];
        const imgType = dm ? elem[5] : elem[20];
        data.file = buildImageFileParam(md5.toHex(), size, width, height, imgType);

        let ntFileId = null;

        if (dm) { //私图
            if (ntPath && ntPath.startsWith("/download")) {
                data.url = "https://gchat.qpic.cn" + ntPath + "&spec=0";
            } else if (elem[15] && String(elem[15])[0] === "/") {
                data.url = "https://gchat.qpic.cn" + elem[15];
            } else {
                data.url = `https://gchat.qpic.cn/gchatpic_new/0/0-0-${md5.toHex().toUpperCase()}/0`
            }
            if (!(await checkImgUrl(data.url))) {
                ntFileId = data.url.match(/&fileid=([^&]+)/) || ntFileId;
                // 图片地址失效，尝试发包获取
                if (elem[23]) { //QQNT 私聊合并转发到群聊图
                    data.url = await groupNTPicDown.call(this.c, this.gid || 284840486, elem[23], md5);
                } else { //纯私聊图片
                    data.url = await offNTPicDown.call(this.c, this.uid, fileResId);
                }
            }
        } else { //群图
            if (ntPath && ntPath.startsWith("/download")) {
                data.url = "https://gchat.qpic.cn" + ntPath + "&spec=0";
            } else if (elem[16] && String(elem[16])[0] === "/") {
                data.url = "https://gchat.qpic.cn" + elem[16];
            } else {
                data.url = `https://gchat.qpic.cn/gchatpic_new/0/0-0-${md5.toHex().toUpperCase()}/0`
            }
            if (!(await checkImgUrl(data.url))) {
                ntFileId = data.url.match(/&fileid=([^&]+)/) || ntFileId;
                // 图片地址失效，尝试发包获取
                if (fileid) { //纯群聊图片
                    data.url = await groupNTPicDown.call(this.c, this.gid || 284840486, fileid, md5);
                } else { //QQNT 群聊合并转发到私聊图
                    data.url = await offNTPicDown.call(this.c, this.uid, fileName);
                }
            }
        }
        // QQNT 图片容错，某些 QQNT 的机器人会发出 appid 异常的图片
        data.url = data.url.replace("multimedia.nt.qq.com.cn", "gchat.qpic.cn");
        if (ntFileId && !(await checkImgUrl(data.url))) {
            data.url = await getNTPicURLbyFileid.call(this.c, ntFileId[1]);
        }
        return data;
    }

    /**
     * 解析回复message_id
     * @private
     * @param {import("../ref").Proto} elem 
     */
    async parseReplyElem(elem) {
        if (Array.isArray(elem[1]))
            elem[1] = elem[1][0];
        try {
            const msg = {
                type: "reply",
                data: {
                    id: "",
                    text: ""
                }
            };
            let seq = elem[1], user_id = elem[2]
            let replyed = elem[5] ? (Array.isArray(elem[5]) ? elem[5] : [elem[5]]) : [];
            if (this.gid) {
                let random = elem[8] ? genRandom(elem[8][3]) : null;
                let time = elem[3];
                if (!random || !time) {
                    let m = (await getGroupMsgs.call(this.c, this.gid, seq, seq))[0];
                    random = m[3][1][1][3];
                    time = m[1][6];
                }
                msg.data.id = genGroupMessageId(this.gid, user_id, seq, random, time);
            } else {
                let random = genRandom(elem[8][3]);
                let time = elem[3];
                let flag = user_id === this.c.uin ? 1 : 0;
                msg.data.id = genC2CMessageId(this.uid, seq, random, time, flag);
            }
            for (let m of replyed) {
                if (m[1]) {
                    msg.data.text += String(m[1][1]);
                } else if (m[2] || m[6] || m[34]) {
                    msg.data.text += "[表情]";
                } else if (m[4] || m[8]) {
                    msg.data.text += "[图片]";
                }
            }
            this.message.unshift(msg);
            this.raw_message = (this.c.config.brief ? "[回复]" : genCQMsg(msg)) + this.raw_message;
        } catch { }
    }

    /**
     * 解析群文件
     * @private
     * @param {import("../ref").Proto} elem 
     */
    parseTransElem(elem) {
        elem = pb.decode(elem[2].toBuffer().slice(3))[7][2];
        if (elem[7]) {
            try {
                const ext = JSON.parse(String(elem[7]));
                if (ext.ExtInfo) { //来自群聊转发消息里的文件
                    const f_file = pb.decode(Buffer.from(ext.ExtInfo,'base64'))[2];
                    const fid = String(f_file[4]);
                    if (f_file[14]) { //私聊型转发的文件
                        const fileid = f_file[4].toBuffer(),
                        md5 = f_file[8] ? f_file[8].toHex() : "",
                        name = String(f_file[5]),
                        size = f_file[6],
                        duration = f_file[9] || 0;
                        return new Promise((resolve, reject)=>{
                            getC2CFileUrl.call(this.c, fileid).then((url)=>{
                                resolve({
                                    name, url, size, md5, duration,
                                    busid: 0,
                                    fileid: String(fileid)
                                })
                            }).catch(reject)
                        })
                    }
                    const gid = f_file[3];
                    const gfs = new Gfs(this.c, gid);
                    return gfs.download(fid);
                }
            } catch { }
        }
        const fid = String(elem[2]);
        const gfs = new Gfs(this.c, this.gid);
        return gfs.download(fid);
    }
}

/**
 * 生成CQ码字符串消息
 * @param {import("../ref").MessageElem} msg 
 * @returns {string}
 */
function genCQMsg(msg) {
    const data = querystring.stringify(msg.data, ",", "=", { encodeURIComponent: (s) => s.replace(/&|,|\[|\]/g, escapeCQInside) });
    return "[CQ:" + msg.type + (data ? "," : "") + data + "]";
}

/**
 * 解析离线文件
 * @this {import("../ref").Client}
 * @param {import("../ref").Proto} elem 
 * @param {number} from 
 */
async function _parseC2CFileElem(elem) {
    const fileid = elem[3].toBuffer(),
        md5 = elem[4].toHex(),
        name = String(elem[5]),
        size = elem[6],
        duration = elem[51] ? timestamp() + elem[51] : 0;
    const url = await getC2CFileUrl.call(this, fileid);
    const message = [{
        type: "file",
        data: {
            name, url, size, md5, duration,
            busid: 0,
            fileid: String(fileid)
        }
    }];
    const raw_message = this.config.brief ? "[离线文件]" : genCQMsg(message);
    return {
        message, raw_message
    };
}

/**
 * 解析其他设备发来的文件
 * @this {import("../ref").Client}
 * @param {import("../ref").Proto} elem 
 * @param {number} from 
 */
async function _parseSyncDeviceFileElem(elem, from) {
    const fileid = elem[3].toBuffer(),
        md5 = elem[4].toHex(),
        name = String(elem[2]),
        size = elem[6],
        duration = elem[51] ? timestamp() + elem[51] : 0;
    const url = await getSyncDeviceFileUrl.call(this, fileid);
    const message = [{
        type: "file",
        data: {
            name, url, size, md5, duration,
            busid: 0,
            fileid: String(fileid)
        }
    }];
    const raw_message = this.config.brief ? "[离线文件]" : genCQMsg(message);
    return {
        message, raw_message
    };
}

/**
 * @this {import("../ref").Client}
 * @param {import("../ref").Msg} msg 
 * @param {boolean} realtime 
 */
async function parseC2CMsg(msg, realtime = false) {

    const head = msg[1], content = msg[2], body = msg[3];
    const type = head[3]; //141|166|167|208|529
    let from_uin = head[1], to_uin = head[2], flag = 0,
        seq = head[5], random = genRandom(head[7]),
        time = body[1] && body[1][1] ? body[1][1][2] : head[6];
    let uid = from_uin;
    if (from_uin === this.uin) {
        uid = to_uin;
        flag = 1;
    }
    let sub_type,
        message_id = genC2CMessageId(uid, seq, random, time, flag),
        font = body[1] && body[1][1] ? String(body[1][1][9]) : "unknown";

    const sender = Object.assign({ user_id: from_uin }, this.fl.get(from_uin));
    if (type === 141) {
        sub_type = "other";
        if (head[8] && head[8][4]) {
            sub_type = "group";
            sender.group_id = head[8][4];
        }
    } else if (type === 167) {
        sub_type = "single";
    } else {
        sub_type = this.fl.has(from_uin) ? "friend" : "single";
    }
    if (sender.nickname === undefined) {
        const stranger = (await this.getStrangerInfo(from_uin, seq % 5 == 0 && realtime)).data;
        if (stranger) {
            stranger.group_id = sender.group_id;
            Object.assign(sender, stranger);
            if (!this.sl.has(from_uin) || realtime)
                this.sl.set(from_uin, stranger);
        }
    }
    if (type === 529) {
        if (head[4] === 4) {
            var parser = await _parseC2CFileElem.call(this, body[2][1]);
        } else if (head[4] === 7) {
            sub_type = "self";
            if (body[2][6]) {
                const elem = {
                    type: "text",
                    data: {
                        text: String(body[2][6][5][1][2])
                    }
                };
                var parser = {
                    message: elem,
                    raw_message: genCQMsg(elem)
                };
            } else if (body[2][3]) {
                var parser = await _parseSyncDeviceFileElem.call(this, body[2][3]);
            } else {
                return;
                const elem = {
                    type: "text",
                    data: {
                        text: "该消息类型暂不支持查看"
                    }
                };
                var parser = {
                    message: elem,
                    raw_message: "该消息类型暂不支持查看"
                };
            }
        } else {
            return;
        }
    } else if (body[1] && body[1][2]) {
        var parser = await Parser.invoke(this, uid, 0, body[1]);
    } else {
        return;
    }
    return {
        sub_type, message_id, user_id: from_uin,
        message: parser.message,
        raw_message: parser.raw_message,
        bubble_id: parser.bubble_id,
        font, sender, time,
        auto_reply: !!(content && content[4])
    };
}

/**
 * @this {import("../ref").Client}
 * @param {import("../ref").Msg} msg 
 * @param {boolean} realtime 
 */
async function parseGroupMsg(msg, realtime = false) {

    const head = msg[1], content = msg[2], body = msg[3];
    const user_id = head[1],
        time = head[6],
        seq = head[5],
        subid = head[11],
        random = body[1][1][3];
    let group = head[9],
        group_id = group[1],
        group_name = group[8] ? String(group[8]) : "",
        group_remark = "";
    if (!group_name) {
        try {
            group_name = this.gl.get(group_id).group_name;
        } catch { }
    }
    try {
        group_remark = this.gl.get(group_id).group_remark;
    } catch { }

    if (realtime) {
        this.msgExists(group_id, 0, seq, time);
        this.getGroupInfo(group_id);
    }

    const parser = await Parser.invoke(this, user_id, group_id, body[1]);

    let font = String(body[1][1][9]),
        card = group[4] ? parseFunString(group[4].toBuffer()) : "",
        message_id = genGroupMessageId(group_id, user_id, seq, random, time, content[1]);

    let user;
    if (!parser.anonymous) {
        try {
            try {
                user = this.gml.get(group_id).get(user_id);
                this.getGroupMemberInfo(group_id, user_id);
            } catch {
                user = (await this.getGroupMemberInfo(group_id, user_id)).data;
            }
            if (user && realtime) {
                const extra = parser.extra;
                if (extra[7])
                    user.title = String(extra[7]);
                if (extra[3])
                    user.level = extra[3];
                if (extra[1] && !extra[2]) {
                    user.card = card = "";
                    user.nickname = String(extra[1]);
                } else {
                    user.card = card;
                }
                user.last_sent_time = time;
                this.gl.get(group_id).last_sent_time = time;
            }
        } catch (e) { }
    }

    if (user) {
        var { nickname, sex, age, area, level, role, title } = user;
    } else {
        var nickname = card, sex = "unknown", age = 0, area = "", level = 0, role = "member", title = "";
    }
    const sender = {
        user_id, nickname, card, sex, age, area, level, role, title, subid
    };
    return {
        sub_type: parser.anonymous ? "anonymous" : "normal",
        message_id, group_id, group_name, group_remark, user_id,
        anonymous: parser.anonymous,
        message: parser.message,
        raw_message: parser.raw_message,
        bubble_id: parser.bubble_id,
        atme: parser.atme,
        block: group[2] === 127,
        seqid: seq,
        font, sender, time
    };
}

/**
 * @this {import("../ref").Client}
 * @param {import("../ref").Msg} msg 
 */
async function parseDiscussMsg(msg) {

    const head = msg[1], body = msg[3];
    const user_id = head[1],
        time = head[6],
        seq = head[5];
    const discuss = head[13],
        discuss_id = discuss[1],
        discuss_name = String(discuss[5]);

    this.msgExists(discuss_id, 0, seq, time);

    const font = String(body[1][1][9]),
        card = String(discuss[4]),
        nickname = card;

    const sender = {
        user_id, nickname, card
    };

    const parser = await Parser.invoke(this, user_id, discuss_id, body[1]);

    return {
        discuss_id, discuss_name, user_id,
        message: parser.message,
        raw_message: parser.raw_message,
        bubble_id: parser.bubble_id,
        atme: parser.atme,
        font, sender, time
    };
}

/**
 * 解析转发消息
 * @this {import("../ref").Client}
 * @param {string} resid 
 * @returns {import("../ref").ProtocolResponse}
 */
async function parseForwardMsg(resid, fileName) {
    const data = [];
    const blob = await _downloadMultiMsg.call(this, String(resid), 2);
    /**
     * @type {import("../ref").Msg[]}
     */
    let msgs = pb.decode(blob)[2];
    if (!Array.isArray(msgs))
        msgs = [msgs];
    for (let msg1 of msgs) {
        const m_fileName = msg1[1].toString();
        if (m_fileName === fileName) {
            msgs = msg1;
            break;
        }
    }
    if (Array.isArray(msgs))
        msgs = msgs[0];
    msgs = msgs[2][1];
    if (!Array.isArray(msgs))
        msgs = [msgs];
    for (let msg of msgs) {
        const head = msg[1];
        let time = head[6];
        let seq = head[5];
        let user_id = head[1], nickname = "unknown", group_id;
        let head_img = "";
        if (head[14]) {
            nickname = String(head[14]);
            try {
                group_id = head[9][1];
            } catch { }
        } else {
            try {
                nickname = String(head[9][4]);
                group_id = head[9][1];
            } catch { }
        }
        try {
            head_img = String(head[20][5]);
        } catch { }
        try {
            let parser;
            if (head[3] === 529 && head[4] === 4 && msg[3][2]) {
                const file_msg = msg[3][2];
                try {
                    if (String(file_msg[6][2][4])[0] === "/") {
                        const gid = file_msg[6][2][3];
                        const fid = file_msg[6][2][4];
                        const gfs = new Gfs(this, gid);
                        const file = await gfs.download(fid);
                        parser = {
                            message: [{
                                type: "file",
                                data: file,
                            }],
                            raw_message: "[转发的文件]",
                            bubble_id: 0
                        }
                    }
                } catch { }
                parser = parser ?? await _parseC2CFileElem.call(this, file_msg[1]);
            } else {
                parser = await Parser.invoke(this, user_id, group_id, msg[3][1]);
            }
            data.push({
                group_id, user_id, nickname, time, seq,
                head_img,
                message: parser.message,
                raw_message: parser.raw_message,
                bubble_id: parser.bubble_id
            });
        } catch { }
    }
    return { result: 0, data };
}

module.exports = {
    parseC2CMsg, parseGroupMsg, parseDiscussMsg, genCQMsg, parseForwardMsg
};
