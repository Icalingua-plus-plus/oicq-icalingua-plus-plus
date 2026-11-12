/**
 * QQ 闪传 sliceupload 数据协议。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const pb = require("../algo/pb");
const { hashNTMedia } = require("./nt-media");

const CHUNK_SIZE = 1024 * 1024;
const UPLOAD_URL = "https://multimedia.qfile.qq.com/sliceupload";

/**
 * @typedef {object} UploadSource
 * @property {string} name
 * @property {number} size
 * @property {Buffer} md5
 * @property {Buffer} sha1
 * @property {Buffer[]} states
 * @property {Buffer[]} chunks
 * @property {(offset: number, length: number) => Promise<Buffer>} read
 * @property {() => Promise<void>} close
 */

/**
 * 分片计算摘要；关闭后可重新打开，上传时按摘要检查文件是否变动。
 * @param {import("../../").MediaFile} file
 * @param {string} [name]
 * @returns {Promise<UploadSource>}
 */
async function prepareFile(file, name) {
    let handle, buffer, size;
    if (file instanceof Uint8Array || file instanceof ArrayBuffer || file instanceof SharedArrayBuffer) {
        buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
        size = buffer.length;
    } else {
        file = path.resolve(String(file));
        handle = await fs.promises.open(file, "r");
        try {
            const stat = await handle.stat();
            if (!stat.isFile())
                throw new TypeError("upload source must be a regular file");
            size = stat.size;
        } catch (error) {
            await handle.close();
            throw error;
        }
    }
    const source = {
        size,
        name: name ? String(name) : buffer ? "" : path.basename(file),
        states: [],
        chunks: [],
        /**
         * @param {number} offset
         * @param {number} length
         * @returns {Promise<Buffer>}
         */
        async read(offset, length) {
            if (buffer)
                return buffer.subarray(offset, offset + length);
            if (!handle) {
                handle = await fs.promises.open(file, "r");
                try {
                    const stat = await handle.stat();
                    if (!stat.isFile() || stat.size !== size)
                        throw new Error("upload source changed after hashing");
                } catch (error) {
                    await handle.close();
                    handle = null;
                    throw error;
                }
            }
            const chunk = Buffer.allocUnsafe(length);
            let read = 0;
            while (read < length) {
                const result = await handle.read(chunk, read, length - read, offset + read);
                if (!result.bytesRead)
                    throw new Error("upload source was truncated");
                read += result.bytesRead;
            }
            return chunk;
        },
        async close() {
            if (handle) {
                await handle.close();
                handle = null;
            }
        },
    };
    try {
        const md5 = createHash("md5");
        const scan = async function* () {
            for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
                const chunk = await source.read(offset, Math.min(CHUNK_SIZE, size - offset));
                md5.update(chunk);
                source.chunks.push(createHash("sha1").update(chunk).digest());
                yield chunk;
            }
        };
        const { sha1, sha1Stream } = await hashNTMedia(scan(), size);
        source.md5 = md5.digest();
        source.sha1 = sha1;
        // NT Highway 会在整 MiB 文件末尾再附一份未填充状态；sliceupload 最后只需要标准摘要。
        if (size) {
            source.states = sha1Stream.slice(0, Math.ceil(size / CHUNK_SIZE) - 1);
            source.states.push(sha1);
        }
        if (!source.name)
            source.name = "file" + source.md5.toString("hex");
        return source;
    } catch (error) {
        await source.close();
        throw error;
    }
}

/**
 * @param {UploadSource} source
 * @param {string} ukey
 * @param {number} appid
 * @param {import("axios").AxiosInstance} http
 * @param {(percentage: string) => void} [callback]
 * @returns {Promise<void>}
 */
async function uploadFile(source, ukey, appid, http, callback) {
    if (typeof ukey !== "string" || !ukey)
        throw new TypeError("upload ukey must be a non-empty string");
    if (!Number.isSafeInteger(appid) || appid <= 0)
        throw new TypeError("upload appid must be a positive integer");
    if (!source.size)
        throw new RangeError("an empty file must be completed by the control protocol");
    for (let offset = 0, index = 0; offset < source.size; offset += CHUNK_SIZE, ++index) {
        const chunk = await source.read(offset, Math.min(CHUNK_SIZE, source.size - offset));
        const sha1 = createHash("sha1").update(chunk).digest();
        if (!sha1.equals(source.chunks[index]))
            throw new Error("upload source changed after hashing");
        const body = Buffer.from(pb.encode({
            1: 0,
            2: appid,
            3: 2,
            107: {
                1: Buffer.alloc(0),
                2: ukey,
                3: offset,
                4: offset + chunk.length - 1,
                5: sha1,
                6: { 1: source.states },
                7: chunk,
            },
        }));
        let response;
        for (let attempt = 0; ; ++attempt) {
            try {
                response = await http.post(UPLOAD_URL, body, {
                    responseType: "arraybuffer",
                    maxBodyLength: Infinity,
                    maxContentLength: CHUNK_SIZE,
                    maxRedirects: 0,
                    headers: { "Content-Type": "application/octet-stream", "Accept": "*/*" },
                });
                break;
            } catch (error) {
                const status = error.response && error.response.status;
                const retryable = status >= 500 && status <= 599 ||
                    ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EAI_AGAIN", "ERR_NETWORK", "ERR_SOCKET_CLOSED"].includes(error.code);
                if (attempt >= 2 || !retryable)
                    throw error;
                await new Promise(resolve => setTimeout(resolve, 100 * (1 << attempt)));
            }
        }
        const rsp = pb.decode(Buffer.from(response.data));
        if (String(rsp[5] || "") !== "success")
            throw new Error("qfile slice upload failed: " + String(rsp[5] || "invalid response"));
        if (callback)
            callback(((offset + chunk.length) / source.size * 100).toFixed(2));
    }
}

module.exports = { CHUNK_SIZE, prepareFile, uploadFile };
