/**
 * 构造语音节点
 * 上传语音
 * 音频转换
 */
"use strict";
const { Readable } = require("stream");
const fs = require("fs");
const path = require("path");
const http = require("http");
const querystring = require("querystring");
const { exec } = require("child_process");
const pb = require("../algo/pb");
const { downloadFromWeb, int32ip2str, highwayUploadStream } = require("../service");
const common = require("../common");

const ERROR_UNSUPPORTED_FILE = new Error("file必须为Buffer或string类型");
const ERROR_FFMPEG_AUDIO_FAILED = new Error("音频转码到amr失败，请确认你的ffmpeg可以处理此转换");
const ERROR_FFMPEG_IMAGE2_FAILED = new Error("ffmpeg获取视频图像帧失败");

/**
 * 语音处理流程
 * 
 *               no↗ transform -> cachefile ↘
 * localfile -> amr|slk?     -> yes ->         Buffer -> upload
 * 
 * base64file
 *    ↓       no↗ tmpfile -> transform -> cachefile -> Buffer -> upload -> delete tmpfile
 * Buffer -> amr|slk? -> yes -> upload
 * 
 * httpfile -> tmpfile -> amr|slk? -> yes -> mv tmpfile cachefile       -> Buffer -> upload
 *                         no↘ transform -> cachefile -> delete tmpfile ↗
 * 
 * @this {import("../ref").Client}
 * @param {number} target
 * @param {import("../ref").ImgPttElem["data"]} cq 
 * @returns {Promise<Buffer>}
 */
async function makePttElem(target, cq) {
    let { file, cache, timeout, headers } = cq;

    if (!file)
        throw ERROR_UNSUPPORTED_FILE;

    // 转发收到的语音
    if (file.startsWith && file.startsWith("protobuf://")) {
        return Buffer.from(file.slice(11), "base64");
    }

    // 读取缓存发送
    const cache_file = path.join(this.dir, "../record", common.md5(file).toString("hex"));
    if (!["0", "false", "no"].includes(String(cache))) {
        try {
            return await _uploadPtt.call(
                this, target,
                await fs.promises.readFile(cache_file)
            );
        } catch {
            fs.unlink(cache_file, common.NOOP);
        }
    }

    // base64
    if (file.startsWith && file.startsWith("base64://")) {
        this.logger.debug("转换base64音频");
        file = Buffer.from(file.slice(9), "base64");
    }

    // bytes
    if (file instanceof Uint8Array || file instanceof ArrayBuffer || file instanceof SharedArrayBuffer) {
        const buf = Buffer.isBuffer(file) ? file : Buffer.from(file);
        // 文件为silk或amr格式直接发送
        const head = String(buf.slice(0, 7));
        if (head.includes("SILK") || head.includes("AMR")) {
            return await _uploadPtt.call(this, target, buf);
        } else {
            // 写入临时文件->音频转换->发送&删除临时文件
            const tmp_file = cache_file + common.uuid() + ".ptt";
            await fs.promises.writeFile(tmp_file, buf);
            try {
                return await _uploadPtt.call(
                    this, target,
                    await _audioTrans.call(this, cache_file, tmp_file)
                );
            } finally {
                fs.unlink(tmp_file, common.NOOP);
            }
        }
    }

    if (file.startsWith && file.startsWith("http")) {
        this.logger.debug("开始下载网络音频：" + file);
        const res = await downloadFromWeb(file, headers);
        const tmp_file = cache_file + common.uuid() + ".ptt";
        timeout = Math.abs(parseFloat(timeout)) || 60;
        const id = setTimeout(()=>{
            this.logger.warn(`download timeout after ${timeout}s`);
            res.destroy();
            fs.unlink(tmp_file, common.NOOP);
        }, timeout * 1000)
        await common.pipeline(res, fs.createWriteStream(tmp_file));
        clearTimeout(id);
        this.logger.debug("网络音频下载完成：" + file);
        const head = await _read7Bytes(tmp_file);
        if (head.includes("SILK") || head.includes("AMR")) {
            await fs.promises.rename(tmp_file, cache_file);
            return await _uploadPtt.call(
                this, target,
                await fs.promises.readFile(cache_file));
        } else {
            const buf = await _audioTrans.call(this, cache_file, tmp_file);
            fs.unlink(tmp_file, common.NOOP);
            return await _uploadPtt.call(
                this, target, buf
            );
        }
    } else {
        // 本地文件
        const local_file = String(file).replace(/^file:\/{2,3}/, "");
        const head = await _read7Bytes(local_file);
        if (head.includes("SILK") || head.includes("AMR")) {
            return await _uploadPtt.call(
                this, target,
                await fs.promises.readFile(local_file));
        } else {
            return await _uploadPtt.call(
                this, target,
                await _audioTrans.call(this, cache_file, local_file)
            );
        }
    }
}

/**
 * @this {import("../ref").Client}
 * @param {string} cache_file 
 * @param {string} tmp_file 
 * @returns {Promise<Buffer>}
 */
function _audioTrans(cache_file, tmp_file) {
    return new Promise((resolve, reject) => {
        exec(`${this.config.ffmpeg_path || "ffmpeg"} -y -i "${tmp_file}" -ac 1 -ar 8000 -f amr "${cache_file}"`, async (error, stdout, stderr) => {
            this.logger.debug("ffmpeg output: " + stdout + stderr);
            try {
                const amr = await fs.promises.readFile(cache_file);
                this.logger.info("ffmpeg成功转换了一个音频。");
                resolve(amr);
            } catch {
                reject(ERROR_FFMPEG_AUDIO_FAILED);
            }
        });
    });
}

/**
 * @param {string} filepath 
 */
async function _read7Bytes(filepath) {
    const fd = await fs.promises.open(filepath, "r");
    const buf = (await fd.read(Buffer.alloc(7), 0, 7, 0)).buffer;
    fd.close();
    return buf;
}

/**
 * 
 * @param {Buffer} fileBuffer 
 * @returns {number} Duration in seconds
 */
function getAmrDuration(fileBuffer) {
    const AMR_MAGIC_NUMBER = "#!AMR\n";
    const FRAME_SIZE = [12, 13, 15, 17, 19, 20, 26, 31, 5, 0, 0, 0, 0, 0, 0, 0];

    const magicNumber = fileBuffer.toString('ascii', 0, 6);
    if (magicNumber !== AMR_MAGIC_NUMBER) {
        throw new Error('Invalid AMR file.');
    }
    let duration = 0;
    let offset = 6;

    while (offset < fileBuffer.length) {
        const frameHeader = fileBuffer[offset];
        const frameType = (frameHeader >> 3) & 0x0F;
        if (frameType < 0 || frameType >= FRAME_SIZE.length) {
            throw new Error('Invalid frame type.');
        }
        const frameSize = FRAME_SIZE[frameType];
        if (frameSize === 0) {
            throw new Error('Invalid frame size.');
        }
        duration += 20;
        offset += frameSize + 1;
    }
    return Math.round(duration / 1000);
}

/**
 * 
 * @param {Buffer} fileBuffer 
 * @param {number} packetLength
 * @returns {number} Duration in seconds
 */
function getSilkDuration(fileBuffer, packetLength = 20) {
    const tencent = fileBuffer[0] !== 0x23;
    if (tencent) fileBuffer = fileBuffer.slice(1);
    const SILK_MAGIC_NUMBER = "#!SILK_V3";
    const magicNumber = fileBuffer.toString('ascii', 0, 9);
    if (magicNumber !== SILK_MAGIC_NUMBER) {
        throw new Error('Invalid SILK file.');
    }
    let offset = 9;
    let duration = 0;
    while (offset < fileBuffer.length) {
        const frameLength = (fileBuffer[offset] & 0xFF) | ((fileBuffer[offset + 1] & 0xFF) << 8);
        offset += 2;
        if (frameLength === 0 || offset + frameLength > fileBuffer.length) {
            throw new Error('Invalid frame length.');
        }
        if (packetLength === 0) {
            throw new Error('Invalid frame duration.');
        }
        duration += packetLength;
        offset += frameLength;
    }
    return Math.round(duration / 1000);
}

/**
 * @this {import("../ref").Client}
 * @param {number} target 
 * @param {Buffer} buf 
 * @returns {Promise<Buffer>}
 */
async function _uploadPtt(target, buf) {
    const md5 = common.md5(buf);
    const codec = String(buf.slice(0, 7)).includes("SILK") ? 1 : 0;
    let seconds = 1;
    try {
        if (codec) seconds = getSilkDuration(buf);
        else seconds = getAmrDuration(buf);
    } catch (e) {
        this.logger.warn("无法获取音频时长", e.message);
    }
    const body = pb.encode({
        1: 3,
        2: 3,
        5: [{
            1: target,
            2: this.uin,
            3: 0,
            4: md5,
            5: buf.length,
            6: md5.toString("hex") + (codec ? ".slk" : ".amr"),
            7: 2,
            8: 9,
            9: 3,
            10: this.apk.version,
            12: seconds,
            13: 1,
            14: codec,
            15: 2,
        }],
    });
    const blob = await this.sendUni("PttStore.GroupPttUp", body);
    const rsp = pb.decode(blob)[5];
    rsp[2] && drop(rsp[2], rsp[3]);
    if (!rsp[4]) {
        const ip = Array.isArray(rsp[5]) ? rsp[5][0] : rsp[5],
            port = Array.isArray(rsp[6]) ? rsp[6][0] : rsp[6];
        const ukey = rsp[7].toHex(), filekey = rsp[11].toHex();
        const params = {
            ver: 4679,
            ukey, filekey,
            filesize: buf.length,
            bmd5: md5.toString("hex"),
            mType: "pttDu",
            voice_encodec: codec
        };
        const url = `http://${int32ip2str(ip)}:${port}/?` + querystring.stringify(params);
        const headers = {
            "User-Agent": `QQ/${this.apk.version} CFNetwork/1126`,
            "Net-Type": "Wifi"
        };
        this.logger.debug("开始上传语音到tx服务器。");
        await new Promise((resolve) => {
            http.request(url, { method: "POST", headers }, resolve)
                .on("error", (e) => {
                    this.logger.warn("语音上传遇到错误：" + e.message);
                    resolve();
                })
                .end(buf);
        });
        this.logger.debug("语音上传结束。");
    }
    const fid = rsp[11].toBuffer();
    return pb.encode({
        1: 4,
        2: this.uin,
        3: fid,
        4: md5,
        5: md5.toString("hex") + ".amr",
        6: buf.length,
        11: 1,
        18: fid,
        29: codec,
        30: Buffer.from([8, 0, 40, 0, 56, 0]),
    });
}

/**
 * @this {import("../ref").Client}
 * @param {import("../ref").Proto} elem 
 */
async function getVideoUrl(elem) {
    const body = pb.encode({
        1: 400,
        4: {
            1: this.uin,
            2: this.uin,
            3: 1,
            4: 7,
            5: elem[1],
            6: 1,
            8: elem[2],
            9: 1,
            10: 2,
            11: 2,
            12: 2,
        }
    });
    const blob = await this.sendUni("PttCenterSvr.ShortVideoDownReq", body);
    const rsp = pb.decode(blob)[4][9];
    const url = new URL(String(Array.isArray(rsp[10]) ? rsp[10][0] : rsp[10]) + String(rsp[11]));
    url.host = url.pathname === "/download" ? "multimedia.nt.qq.com.cn" : "grouptalk.c2c.qq.com";
    url.protocol = "https";
    return url.toString();
}

// Thanks @5ec1cff
/**
 * @this {import("../ref").Client}
 * @param {import("../ref").Proto} elem 
 * @param {number} gid 
 */
 async function getPttUrl(elem, gid) {
    if (gid) {
        const body = pb.encode({
            1: 3,
            2: 4,
            6: [
                {
                    1: gid,
                    2: this.uin,
                    3: elem[8],
                    4: elem[4],
                    5: 2,
                    6: 9,
                    8: 3,
                    10: 0,
                    11: elem[18],
                    12: 1,
                    14: 2,
                    15: 1,
                },
            ],
        });
        const blob = await this.sendUni("PttStore.GroupPttDown", body);
        const rsp = pb.decode(blob)[6];
        return `https://${rsp[8].toString()}${rsp[9].toString()}`;
    } else {
        const body = pb.encode({
            1: 1200,
            2: 0,
            14: {
                10: this.uin,
                20: elem[3],
                30: 2,
            },
            101: 17,
            102: 104,
            99999: {
                90300: 1,
                91000: 2,
                91100: 1,
            },
        });
        const blob = await this.sendUni("PttCenterSvr.pb_pttCenter_CMD_REQ_APPLY_DOWNLOAD-1200", body);
        const url = new URL(pb.decode(blob)[14][30][50].toString());
        url.host = url.pathname === "/download" ? "multimedia.nt.qq.com.cn" : "grouptalk.c2c.qq.com";
        url.protocol = "https";
        return url.toString();
    }
}

/**
 * 获取QQNT群语音URL
 * @this {import("../ref").Client}
 * @param {import("../ref").Proto} elem 
 * @param {number} gid 
 */
async function getGroupNTPttUrl(elem, gid = 284840486) {
    const body = pb.encode({
        1: {
            1: {
                1: 1,
                2: 200,
            },
            2: {
                101: 1,
                102: 3,
                200: 2,
                202: {
                    1: gid,
                },
            },
            3: {
                1: 2,
            },
        },
        3: {
            1: elem,
            2: {
                2: {
                    1: 0,
                    3: 0,
                },
            },
        },
    });
    try {
        const rsp = await this.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x126e_200", body);
        const rkey = rsp[3][1];
        if (!rkey)
            throw new Error("rkey不存在");
        return `https://${rsp[3][3][1]}${rsp[3][3][2]}${rkey}`;
    } catch (e) {
        this.logger.warn("获取QQNT语音URL失败", e.message);
        return null;
    }
}

/**
 * 获取QQNT私聊语音URL
 * @this {import("../ref").Client}
 * @param {import("../ref").Proto} elem 
 * @param {string} uid 
 */
async function getOffNTPttUrl(elem, uid) {
    if (!uid) uid = String(this.uid || this.uin);
    const body = pb.encode({
        1: {
            1: {
                1: 1,
                2: 200,
            },
            2: {
                101: 1,
                102: 3,
                200: 1,
                201: {
                    1: 2,
                    2: uid,
                },
            },
            3: {
                1: 2,
            },
        },
        3: {
            1: elem,
            2: {
                2: {
                    1: 0,
                    3: 0,
                },
            },
        },
    });
    try {
        const rsp = await this.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x126d_200", body);
        const rkey = rsp[3][1];
        if (!rkey)
            throw new Error("rkey不存在");
        return `https://${rsp[3][3][1]}${rsp[3][3][2]}${rkey}`;
    } catch (e) {
        this.logger.warn("获取QQNT语音URL失败", e.message);
        return null;
    }
}

/**
 * 获取QQNT群视频URL
 * @this {import("../ref").Client}
 * @param {import("../ref").Proto} elem 
 * @param {number} gid 
 */
async function getGroupNTVideoUrl(elem, gid = 284840486) {
    const body = pb.encode({
        1: {
            1: {
                1: 1,
                2: 200,
            },
            2: {
                101: 2,
                102: 2,
                200: 2,
                202: {
                    1: gid,
                },
            },
            3: {
                1: 2,
            },
        },
        3: {
            1: elem,
            2: {
                2: {
                    1: 0,
                    3: 0,
                },
            },
        },
    });
    try {
        const rsp = await this.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x11ea_200", body);
        const rkey = rsp[3][1];
        if (!rkey)
            throw new Error("rkey不存在");
        return `https://${rsp[3][3][1]}${rsp[3][3][2]}${rkey}`;
    } catch (e) {
        this.logger.warn("获取QQNT视频URL失败", e.message);
        return null;
    }
}

/**
 * 获取QQNT私聊视频URL
 * @this {import("../ref").Client}
 * @param {import("../ref").Proto} elem 
 * @param {string} uid 
 */
async function getOffNTVideoUrl(elem, uid) {
    if (!uid) uid = String(this.uid || this.uin);
    const body = pb.encode({
        1: {
            1: {
                1: 1,
                2: 200,
            },
            2: {
                101: 2,
                102: 2,
                200: 1,
                201: {
                    1: 2,
                    2: uid,
                },
            },
            3: {
                1: 2,
            },
        },
        3: {
            1: elem,
            2: {
                2: {
                    1: 0,
                    3: 0,
                },
            },
        },
    });
    try {
        const rsp = await this.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x11e9_200", body);
        const rkey = rsp[3][1];
        if (!rkey)
            throw new Error("rkey不存在");
        return `https://${rsp[3][3][1]}${rsp[3][3][2]}${rkey}`;
    } catch (e) {
        this.logger.warn("获取QQNT视频URL失败", e.message);
        return null;
    }
}

/**
 * @this {import("../ref").Client}
 * @param {number} target
 * @param {string} file 
 */
async function makeVideoElem(target, file) {
    file = file.replace(/^file:\/{2,3}/, "");
    const thumb = path.join(this.dir, "../image", common.uuid());
    await new Promise((resolve, reject) => {
        exec(`${this.config.ffmpeg_path || "ffmpeg"} -y -i "${file}" -f image2 -frames:v 1 "${thumb}"`, (error, stdout, stderr) => {
            this.logger.debug("ffmpeg output: " + stdout + stderr);
            fs.stat(thumb, (err) => {
                if (err) reject(ERROR_FFMPEG_IMAGE2_FAILED);
                else resolve();
            })
        });
    });
    const [width, height, seconds] = await new Promise((resolve) => {
        exec(`${this.config.ffprobe_path || "ffprobe"} -i "${file}" -show_streams`, (error, stdout, stderr) => {
            this.logger.debug("ffprobe output: " + stdout + stderr);
            const lines = (stdout || stderr || "").split("\n");
            let width = 1280, height = 720, seconds = 120;
            for (const line of lines) {
                if (line.startsWith("width=")) {
                    width = parseInt(line.slice(6));
                } else if (line.startsWith("height=")) {
                    height = parseInt(line.slice(7));
                } else if (line.startsWith("duration=")) {
                    seconds = parseInt(line.slice(9));
                    break;
                }
            }
            resolve([width, height, seconds]);
        });
    });
    const md5video = await common.md5Stream(fs.createReadStream(file));
    const md5thumb = await common.md5Stream(fs.createReadStream(thumb));
    const name = md5video.toString("hex") + ".mp4";
    const videosize = (await fs.promises.stat(file)).size;
    const thumbsize = (await fs.promises.stat(thumb)).size
    const ext = pb.encode({
        1: this.uin,
        2: target,
        3: 1,
        4: 2,
        5: {
            1: name,
            2: md5video,
            3: md5thumb,
            4: videosize,
            5: height,
            6: width,
            7: 3,
            8: seconds,
            9: thumbsize,
        },
        6: target,
        20: 1,
    });
    const body = pb.encode({
        1: 300,
        3: ext,
        100: {
            1: 0,
            2: 1,
        }
    });
    const blob = await this.sendUni("PttCenterSvr.GroupShortVideoUpReq", body);
    const rsp = pb.decode(blob)[3];
    if (rsp[1])
        throw new Error(String(rsp[2]));
    if (!rsp[7]) {
        const md5 = await common.md5Stream(createReadable(thumb, file));
        await highwayUploadStream.call(
            this,
            createReadable(thumb, file),
            {
                cmd: 25,
                md5,
                size: thumbsize + videosize,
                ext,
                encrypt: true,
            }
        );
    }
    fs.unlink(thumb, common.NOOP);
    return pb.encode({
        1: rsp[5].toBuffer(),
        2: md5video,
        3: name,
        4: 3,
        5: seconds,
        6: videosize,
        7: width,
        8: height,
        9: md5thumb,
        10: "camera",
        11: thumbsize,
        12: 0,
        15: 1,
        16: width,
        17: height,
        18: 0,
        19: 0,
    });
}

function createReadable(file1, file2) {
    return Readable.from(
        concatStreams(
            fs.createReadStream(file1, { highWaterMark: 256 * 1024 }),
            fs.createReadStream(file2, { highWaterMark: 256 * 1024 })
        )
    );
}
async function* concatStreams(readable1, readable2) {
    for await (const chunk of readable1)
        yield chunk;
    for await (const chunk of readable2)
        yield chunk;
}

module.exports = {
    makePttElem, makeVideoElem, getVideoUrl, getPttUrl,
    getGroupNTPttUrl, getOffNTPttUrl,
    getGroupNTVideoUrl, getOffNTVideoUrl,
};
