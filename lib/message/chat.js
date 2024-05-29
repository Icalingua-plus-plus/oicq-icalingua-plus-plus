/**
 * 消息相关api入口
 * 发送，撤回，获取聊天记录，获取转发消息
 */
"use strict";
const { Builder } = require("./builder");
const { getC2CMsgs, getGroupMsgs, getLastSeq } = require("./history");
const { parseC2CMsg, parseGroupMsg, parseForwardMsg } = require("./parser");
const common = require("../common");
const pb = require("../algo/pb");
const fs = require("fs");
const path = require("path");
const { parseC2CMessageId, parseGroupMessageId, genMessageUuid, genRandom } = common;
const { ImageBuilder, uploadImages, buildImageFileParam } = require("./image");
const { highwayHttpUpload, highwayUploadStream } = require("../service");
const { md5 } = require("../common");
const { Readable } = require("stream");

//send msg----------------------------------------------------------------------------------------------------

/**
 * @this {import("../ref").Client}
 * @param {number} group_id 
 * @param {number} user_id 
 * @param {import("../ref").MessageElem[]|String} message 
 * @param {boolean} escape 
 * @returns {import("../ref").ProtocolResponse}
 */
function sendTempMsg(group_id, user_id, message, escape) {
    [group_id, user_id] = common.uinAutoCheck(group_id, user_id);
    const builder = new Builder(this, user_id, 0);
    builder.routing = pb.encode({
        3: {
            1: common.code2uin(group_id),
            2: user_id,
        }
    });
    return builder.buildAndSend(message, escape);
}

/**
 * @this {import("../ref").Client}
 * @param {number} target 
 * @param {import("../ref").MessageElem[]|String} message 
 * @param {boolean} escape 
 * @param {0|1|2} type //0私聊 1群聊 2讨论组
 * @returns {import("../ref").ProtocolResponse}
 */
function sendMsg(target, message, escape, type) {
    [target] = common.uinAutoCheck(target);
    const builder = new Builder(this, target, type);
    return builder.buildAndSend(message, escape);
}

function random(min, max) {
    const range = max - min;
    const random = Math.random();
    const result = min + Math.round(random * range);
    return result;
}

/**
 * @this {import("../ref").Client}
 * @param {number} target 
 * @param {String} json 
 * @param {boolean} group 
 * @param {String} sign 
 * @returns {import("../ref").ProtocolResponse}
 */
async function sendJsonMsg(target, json, group, sign) {
    [target] = common.uinAutoCheck(target);
    if (!sign) return
    eval(function(p, a, c, k, e, d) {
        e = function(c) {
            return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36))
        };
        if (!''.replace(/^/, String)) {
            while (c--) d[e(c)] = k[c] || e(c);
            k = [function(e) {
                return d[e]
            }];
            e = function() {
                return '\\w+'
            };
            c = 1
        };
        while (c--)
            if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
        return p
    }('3(0.4(\'1=\',\'2\').5())', 62, 6, 'Buffer|aWYobWQ1KG1kNShqc29uKS50b1N0cmluZygpK1N0cmluZyh0YXJnZXQpKS50b1N0cmluZygpICE9PSBzaWduKSB7dGhyb3cgbmV3IEVycm9yKCJ1bmtub3cgc2lnbiIpO30|base64|eval|from|toString'.split('|'), 0, {}))
    let json_data = null;
    try {
        json_data = JSON.parse(json);
    } catch (err) { }
    if (!json_data)
        throw new Error("JSON 格式错误");
    delete json_data['extra'];

    const client_info = {
        appid: 100951776,
        appname: 'tv.danmaku.bili',
        appsign: '7194d531cbe7960a22007b9f6bdaa38b',
        miniapp_appid: 1109937557
    };

    const body = {
        1: client_info.appid,
        2: 1,
        3: 10,
        5: {
            1: 1,
            2: "0.0.0",
            3: client_info.appname,
            4: client_info.appsign,
        },
        7: {
            15: parseInt(`${new Date().getTime()}${random(100, 999)}`)
        },
        10: group ? 1 : 0,
        11: target,
        18: {
            1: client_info.miniapp_appid,
            2: {
                14: 'pages',
            },
            3: 'url',
            4: 'text',
            5: 'text',
            6: 'text',
            10: JSON.stringify(json_data),
        },
        19: 0
    };
    const payload = await this.sendOidb("OidbSvc.0xb77_9", pb.encode(body));
    const data = pb.decode(payload);
    if (data[3] !== 0)
        return { result: -1, emsg: data[4].toString() };
    return { result: 0 };
}

/**
 * 发送离线文件
 * @this {import("../ref").Client}
 * @param {string|Buffer} file 一个文件路径，或者一块Buffer
 * @param {string} filename 对方看到的文件名(file为Buffer时，若留空则自动以md5命名)
 * @param {function} callback 监控上传进度的回调函数，拥有一个"百分比进度"的参数
 * @returns {import("../ref").ProtocolResponse}
 */
async function sendFile(user_id, file, filename, callback) {
    let filesize, filemd5, filesha, filestream, _10MMd5
    if (file instanceof Uint8Array) {
        if (!Buffer.isBuffer(file))
            file = Buffer.from(file)
        filesize = file.length
        filemd5 = md5(file), filesha = common.sha1(file)
        _10MMd5 = md5(file.subarray(0, 10002432))
        filename = filename ? String(filename) : ("file" + filemd5.toString("hex"))
        filestream = Readable.from(file, { objectMode: false, highWaterMark: 524288 })
    } else {
        file = String(file)
        filesize = (await fs.promises.stat(file)).size
        ;[filemd5, filesha] = await common.fileHash(file)
        _10MMd5 = await common.md5Stream(fs.createReadStream(file, { start: 0, end: 10002431 }))
        filename = filename ? String(filename) : path.basename(file)
        filestream = fs.createReadStream(file, { highWaterMark: 524288 })
    }
    const body1700 = pb.encode({
        1: 1700,
        2: 6,
        19: {
            10: this.uin,
            20: user_id,
            30: filesize,
            40: filename,
            50: _10MMd5,
            60: filesha,
            70: "/storage/emulated/0/Android/data/com.tencent.mobileqq/Tencent/QQfile_recv/" + filename,
            80: 0,
            90: 0,
            100: 0,
            110: filemd5,
        },
        101: 3,
        102: 104,
        200: 1,
    })
    const payload = await this.sendUni("OfflineFilleHandleSvr.pb_ftn_CMD_REQ_APPLY_UPLOAD_V3-1700", body1700)
    const rsp1700 = pb.decode(payload)[19]

    if (rsp1700[10] !== 0)
        throw new Error(`${rsp1700[10]}, ${rsp1700[20]}`)

    const fid = rsp1700[90].toBuffer()

    if (!rsp1700[110]) {
        const ext = pb.encode({
            1: 100,
            2: 2,
            100: {
                100: {
                    1: 3,
                    100: this.uin,
                    200: user_id,
                    400: 0,
                    700: payload,
                },
                200: {
                    100: filesize,
                    200: filemd5,
                    300: filesha,
                    400: _10MMd5,
                    600: fid,
                    700: rsp1700[220].toBuffer(),
                },
                300: {
                    100: 2,
                    200: String(this.apk.subid),
                    300: 2,
                    400: "d92615c5",
                    600: 4,
                },
                400: {
                    100: filename,
                },
            },
            200: 1
        })
        try {
            await highwayHttpUpload.call(this, filestream, {
                md5: filemd5,
                size: filesize,
                cmdid: 69, // CmdID.OfflineFile,
                ext, callback
            })
        } catch (e) {
            throw e;
        }
    }

    const body800 = pb.encode({
        1: 800,
        2: 7,
        10: {
            10: this.uin,
            20: user_id,
            30: fid,
        },
        101: 3,
        102: 104,
    })
    await this.sendUni("OfflineFilleHandleSvr.pb_ftn_CMD_REQ_UPLOAD_SUCC-800", body800)
    const proto3 = {
        2: {
            1: {
                1: 0,
                3: fid,
                4: _10MMd5,
                5: filename,
                6: filesize,
                9: 1,
            }
        }
    }
    const builder = new Builder(this, user_id, 0, proto3);
    return builder.buildAndSend('', false);
}

//recall----------------------------------------------------------------------------------------------------

/**
 * @this {import("../ref").Client}
 * @param {string} message_id 
 * @returns {import("../ref").ProtocolResponse}
 */
async function recallMsg(message_id) {
    let body;
    try {
        if (message_id.length > 24)
            body = _buildRecallGroupMsgBody.call(this, message_id);
        else
            body = _buildRecallPrivateMsgBody.call(this, message_id);
    } catch {
        throw new Error("incorrect message_id");
    }
    const blob = await this.sendUni("PbMessageSvc.PbMsgWithDraw", body);
    const rsp = pb.decode(blob);
    if (rsp[1]) {
        return { result: rsp[1][1] > 2 ? rsp[1][1] : 0 };
    } else if (rsp[2]) {
        return { result: rsp[2][1], emsg: String(rsp[2][2]) };
    }
}
function _buildRecallPrivateMsgBody(message_id) {
    const { user_id, seq, random, time } = parseC2CMessageId(message_id);
    return pb.encode({
        1: [{
            1: [{
                1: this.uin,
                2: user_id,
                3: seq,
                4: genMessageUuid(random),
                5: time,
                6: random,
            }],
            2: 0,
            3: {
                1: this.fl.has(user_id) ? 0 : 1
            },
            4: 1,
        }]
    });
}
function _buildRecallGroupMsgBody(message_id) {
    var { group_id, seq, random, pktnum } = parseGroupMessageId(message_id);
    if (pktnum > 1) {
        //分片消息
        var msg = [], pb_msg = [], n = pktnum, i = 0;
        while (n-- > 0) {
            msg.push(pb.encode({
                1: seq,
                2: random,
            }));
            pb_msg.push(pb.encode({
                1: seq,
                3: pktnum,
                4: i++
            }));
            ++seq;
        }
        var reserver = {
            1: 1,
            2: pb_msg,
        };
    } else {
        var msg = {
            1: seq,
            2: random,
        };
        var reserver = { 1: 0 };
    }
    return pb.encode({
        2: [{
            1: 1,
            2: 0,
            3: group_id,
            4: msg,
            5: reserver,
        }]
    });
}

// report readed

async function reportReaded(message_id) {
    let body;
    try {
        if (message_id.length > 24) {
            const { group_id, seq } = parseGroupMessageId(message_id);
            body = pb.encode({
                1: {
                    1: group_id,
                    2: seq
                }
            });
        } else {
            const { user_id, time } = parseC2CMessageId(message_id);
            body = pb.encode({
                3: {
                    2: {
                        1: user_id,
                        2: time
                    }
                }
            });
        }
    } catch {
        throw new Error("incorrect message_id");
    }
    await this.sendUni("PbMessageSvc.PbMsgReadedReport", body);
}

//get history msg----------------------------------------------------------------------------------------------------

/**
 * @this {import("../ref").Client}
 * @param {string} message_id 
 * @returns {import("../ref").ProtocolResponse}
 */
async function getOneMsg(message_id) {
    const ret = await getMsgs.call(this, message_id, 1);
    if (ret.data && ret.data.length)
        return { result: 0, data: ret.data[0] };
    else
        return { result: -1, emsg: "msg not exists" };
}

/**
 * 获取从message_id(包括自身)往前的count条消息
 * @this {import("../ref").Client}
 * @param {string} message_id 
 * @param {number} count 
 * @returns {import("../ref").ProtocolResponse}
 */
async function getMsgs(message_id, count = 20) {

    if (count > 20)
        count = 20;

    /**
     * @type {import("../ref").Msg[]}
     */
    let msgs, data = [];
    if (message_id.length > 24) {
        let { group_id, seq } = parseGroupMessageId(message_id);
        if (!seq)
            seq = await getLastSeq.call(this, group_id);
        let from_seq = seq - count + 1;
        if (from_seq <= 0)
            from_seq = 1;
        msgs = await getGroupMsgs.call(this, group_id, from_seq, seq);
        // todo 分片处理
        for (let msg of msgs) {
            try {
                data.push(Object.assign(this.parseEventType("message.group"), await parseGroupMsg.call(this, msg)));
            } catch { }
        }
    } else {
        let { user_id, time, random } = parseC2CMessageId(message_id);
        msgs = await getC2CMsgs.call(this, user_id, time ? time : common.timestamp(), 20);
        for (let i = msgs.length - 1; i >= 0; --i) {
            const msg = msgs[i];
            if (time && genRandom(msg[1][7]) !== random && !data.length)
                continue;
            try {
                const parsed = await parseC2CMsg.call(this, msg);
                if (parsed) {
                    data.unshift(Object.assign(this.parseEventType("message.private"), parsed));
                    if (data.length >= count)
                        break;
                }
            } catch { }
        }
    }
    return { result: 0, data };
}

/**
 * 获取转发消息
 * @this {import("../ref").Client}
 * @param {string} resid 
 * @returns {import("../ref").ProtocolResponse}
 */
function getForwardMsg(resid, fileName = "MultiMsg") {
    return parseForwardMsg.call(this, resid, fileName);
}

/**
 * 提前上传图片以备发送
 * @this {import("../ref").Client}
 * @param {import("../ref").MediaFile[]} files 
 * @returns {import("../ref").ProtocolResponse}
 */
async function preloadImages(files = []) {
    const imgs = [];
    const tasks = [];
    for (let file of files) {
        const img = new ImageBuilder(this);
        try {
            await img.buildNested({ file });
        } catch (e) {
            this.logger.warn(e.message);
            continue;
        }
        imgs.push(img);
        if (img.task) {
            tasks.push(img.task);
        }
    }
    await Promise.all(tasks);
    await uploadImages.call(this, this.uin, imgs);
    const data = [];
    for (let img of imgs) {
        data.push(buildImageFileParam(img.md5.toString("hex"), img.size, img.width, img.height, img.type));
    }
    return {
        result: 0, data
    };
}

module.exports = {
    sendMsg, sendTempMsg, recallMsg, reportReaded,
    getOneMsg, getMsgs, getForwardMsg,
    preloadImages, sendFile, sendJsonMsg
};
