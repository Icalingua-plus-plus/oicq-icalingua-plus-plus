/**
 * tcp上传数据
 * 网络下载
 */
"use strict";
const stream = require("stream");
const net = require("net");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { randomBytes } = require("crypto");
const tea = require("./algo/tea");
const pb = require("./algo/pb");
const { md5, NOOP, BUF0} = require("./common");
const axios = require("axios").default;
const MAX_UPLOAD_SIZE = 31457280;

/**
 * 数字ip转换成通用ip
 * @param {number|string} ip 
 */
function int32ip2str(ip) {
    if (typeof ip === "string")
        return ip;
    ip = ip & 0xffffffff;
    return [
        ip & 0xff,
        (ip & 0xff00) >> 8,
        (ip & 0xff0000) >> 16,
        (ip & 0xff000000) >> 24 & 0xff,
    ].join(".");
}

class HighwayTransform extends stream.Transform {

    seq = randomBytes(2).readUInt16BE();
    offset = 0;
    __ = Buffer.from([41]);

    /**
     * @param {import("./ref").Client} c 
     * @param {import("./ref").HighwayUploadStreamObject} obj 
     */
    constructor(c, obj) {
        super();
        this.c = c;
        this.cmd = obj.cmd;
        this.md5 = obj.md5;
        this.size = obj.size;
        this.ticket = obj.ticket || this.c.storage.sig_session;
        this.ext = obj.encrypt ? tea.encrypt(obj.ext, this.c.storage.session_key) : obj.ext;
        this.on("error", NOOP);
    }

    _transform(data, encoding, callback) {
        let offset = 0, limit = 1048576;
        while (offset < data.length) {
            const chunk = data.slice(offset, limit + offset);
            const head = pb.encode({
                1: {
                    1: 1,
                    2: String(this.c.uin),
                    3: "PicUp.DataUp",
                    4: this.seq++,
                    6: this.c.apk.subid,
                    7: 4096,
                    8: this.cmd,
                    10: 2052,
                },
                2: {
                    2: this.size,
                    3: this.offset + offset,
                    4: chunk.length,
                    6: this.ticket,
                    8: md5(chunk),
                    9: this.md5,
                },
                3: this.ext
            });
            offset += chunk.length;
            const _ = Buffer.allocUnsafe(9);
            _.writeUInt8(40);
            _.writeUInt32BE(head.length, 1);
            _.writeUInt32BE(chunk.length, 5);
            this.push(_);
            this.push(head);
            this.push(chunk);
            this.push(this.__);
        }
        this.offset += data.length;
        callback(null);
    }
}

const ERROR_HIGHWAY_FAILED = new Error("ERROR_HIGHWAY_FAILED");

/**
 * 将一个可读流经过转换后上传
 * @this {import("./ref").Client}
 * @param {stream.Readable} readable
 * @param {import("./ref").HighwayUploadStreamObject} obj
 */
function highwayUploadStream(readable, obj, ip, port) {
    ip = int32ip2str(ip || this.storage.ip);
    port = port || this.storage.port;
    this.logger.debug(`highway ip:${ip} port:${port}`);
    return new Promise((resolve) => {
        const highway = new HighwayTransform(this, obj);
        const socket = net.connect(
            port, ip,
            () => readable.pipe(highway).pipe(socket, { end: false })
        );
        const handleRspHeader = (header) => {
            const rsp = pb.decode(header);
            if (typeof rsp[3] === "number" && rsp[3] !== 0) {
                this.logger.warn(`highway upload failed (code: ${rsp[3]})`);
                readable.unpipe(highway).destroy();
                highway.unpipe(socket).destroy();
                socket.end();
                throw ERROR_HIGHWAY_FAILED;
            } else {
                const percentage = ((rsp[2][3] + rsp[2][4]) / rsp[2][2] * 100).toFixed(2);
                this.logger.debug(`highway chunk uploaded (${percentage}%)`);
                if (typeof obj.callback === "function")
                    obj.callback(percentage)
                if (percentage >= 100)
                    socket.end();
            }
        }
        let _data = BUF0;
        socket.on("data", (data) => {
            try {
                _data = _data.length ? Buffer.concat([_data, data]) : data;
                while (_data.length >= 5) {
                    const len = _data.readInt32BE(1);
                    if (_data.length >= len + 10) {
                        handleRspHeader(_data.slice(9, len + 9));
                        _data = _data.slice(len + 10);
                    } else {
                        break;
                    }
                }
            } catch (err) {
                this.logger.error(err);
            }
        });
        socket.on("close", resolve);
        socket.on("error", (err) => {
            this.logger.warn(err);
        });
        readable.on("error", (err) => {
            this.logger.warn(err);
            socket.end();
        });
    });
}

const __ = Buffer.from([41])

function highwayHttpUpload(readable, obj) {
    const agent = new http.Agent({ maxSockets: 10 })
    const ip = this.storage.ip
    const port = this.storage.port
    if (!port) throw new Error("没有上传通道，如果你刚刚登录，请等待几秒")

    console.log(`highway(http) ip:${ip} port:${port}`)
    const url = "http://" + ip + ":" + port + "/cgi-bin/httpconn?htcmd=0x6FF0087&uin=" + this.uin
    let seq = 1
    let offset = 0, limit = 524288
    obj.ticket = this.storage.sig_session

    const bufs = new Set()
    const controller = new AbortController();
    require("events").setMaxListeners(233, controller.signal);
    let finished = 0

    readable.on("data", data => {
        let _offset = 0
        while (_offset < data.length) {
            const chunk = data.slice(_offset, limit + _offset)
            const head = pb.encode({
                1: {
                    1: 1,
                    2: String(this.uin),
                    3: "PicUp.DataUp",
                    4: seq++,
                    5: 0,
                    6: this.apk.subid,
                    8: obj.cmdid,
                },
                2: {
                    1: 0,
                    2: obj.size,
                    3: offset + _offset,
                    4: chunk.length,
                    6: obj.ticket,
                    8: md5(chunk),
                    9: obj.md5,
                    10: 0,
                    13: 0,
                },
                3: obj.ext,
                4: Date.now()
            })
            _offset += chunk.length
            const _ = Buffer.allocUnsafe(9)
            _.writeUInt8(40)
            _.writeUInt32BE(head.length, 1)
            _.writeUInt32BE(chunk.length, 5)
            const buf = Buffer.concat([_, head, chunk, __])
            bufs.add(buf)
        }
        offset += data.length
    })

    return new Promise((resolve, reject) => {
        readable.on("err", reject)
        .on("end", async() => {
            let flag = false
            for (const buf of bufs) {
                if (flag) break
                await axios.post(url, buf, {
                    responseType: "arraybuffer",
                    httpAgent: agent,
                    signal: controller.signal,
                    headers: {
                        "Content-Length": String(buf.length),
                        "Content-Type": "application/octet-stream"
                    }
                }).then(r => {
                    let percentage, rsp
                    try {
                        const buf = Buffer.from(r?.data)
                        const header = buf.slice(9, buf.length - 1)
                        rsp = pb.decode(header)
                    } catch (err) {
                        this.logger.error(err)
                        reject(err)
                        return
                    }
                    if (rsp?.[3] !== 0) {
                        controller.abort()
                        reject(new Error(`${rsp[3]}, unknown highway error"`))
                        return
                    }
                    ++finished
                    percentage = (finished / bufs.size * 100).toFixed(2)
                    this.logger.debug(`highway(http) chunk uploaded (${percentage}%)`)
                    if (typeof obj.callback === "function" && percentage)
                        obj.callback(percentage)
                    if (finished < bufs.size && rsp[7]?.toBuffer().length > 0) {
                        controller.abort()
                        flag = true
                        this.logger.debug(`highway(http) can quick upload`)
                        this.logger.debug(`highway(http) chunk uploaded (100.00%)`)
                        if (typeof obj.callback === "function")
                            obj.callback("100.00")
                    }
                    if (finished >= bufs.size && !rsp[7]?.toBuffer().length)
                        reject("文件校验未通过，上传失败")
                }).catch(err => {
                    if (err instanceof axios.Cancel === false) {
                        reject(err)
                    }
                    flag = true
                })
            }
            resolve(undefined)
        })
    })
}

const ERROR_SIZE_TOO_BIG = new Error("文件体积超过30MB，拒绝下载");

class DownloadTransform extends stream.Transform {
    _size = 0;
    _transform(data, encoding, callback) {
        this._size += data.length;
        if (this._size <= MAX_UPLOAD_SIZE) {
            this.push(data);
        }
        callback(null);
    }
}

/**
 * 下载(最大30M)
 * @param {http.OutgoingHttpHeader|undefined|string} headers
 * @returns {Promise<stream.Readable>}
 */
function downloadFromWeb(url, headers, redirect = 0) {
    if (typeof headers === "string") {
        try {
            headers = JSON.parse(headers);
        } catch {
            headers = null;
        }
    }
    return new Promise((resolve, reject) => {
        (url.startsWith("https") ? https : http).get(url, { headers }, (res) => {
            if (redirect < 3 && String(res.statusCode).startsWith("3") && res.headers["location"]) {
                let location = res.headers["location"];
                if (!location.startsWith("http"))
                    location = new URL(url).origin + location;
                return downloadFromWeb(location, headers, redirect + 1)
                    .then(resolve)
                    .catch(reject);
            }
            if (res.statusCode !== 200) {
                res.destroy();
                return reject(new Error("http status code: " + res.statusCode));
            }
            if (res.headers["content-length"] && res.headers["content-length"] > MAX_UPLOAD_SIZE) {
                res.destroy();
                return reject(ERROR_SIZE_TOO_BIG);
            }
            resolve(res.pipe(new DownloadTransform));
        }).on("error", reject);
    });
}

module.exports = {
    downloadFromWeb, highwayUploadStream, int32ip2str, highwayHttpUpload, MAX_UPLOAD_SIZE,
};
