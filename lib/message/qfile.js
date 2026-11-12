/**
 * QQ 闪传上传与网页下载协议。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { createHmac, createHash, randomBytes } = require("crypto");
const { Transform, pipeline } = require("stream");
const { promisify } = require("util");
const { prepareFile, uploadFile } = require("./qfile-upload");
const native = require("./qfile-native");
const { FlashTransferError } = native;

const pipelineAsync = promisify(pipeline);
const ORIGIN = "https://qfile.qq.com";
const RPC_PATH = "/http2rpc/gotrpc/noauth/";
const SIGN_KEY = "9EB18BB9ED457684";
const FILE_SERVICE = "trpc.file.FileFlashTrans/";
const TRANSFER_SERVICE = "trpc.file.flashtransfer.FlashTransferService/";
const METHODS = {
    resolve: [TRANSFER_SERVICE + "GetFilesetIDByCode", "0x93eb", "2"],
    stat: [FILE_SERVICE + "GetFileset", "0x93d3", "1"],
    dir: [FILE_SERVICE + "GetFileList", "0x93d4", "1"],
    progress: [FILE_SERVICE + "GetTransProgress", "0x93d9", "1"],
    fileProgress: [TRANSFER_SERVICE + "GetFilesTransferProgress", "0x93ea", "2"],
    category: [TRANSFER_SERVICE + "GetFileCategory", "0x9407", "2"],
    download: ["trpc.qqntv2.richmedia.InnerProxy/BatchDownload", "0x9248", "4"],
};

function checkString(value, name) {
    if (typeof value !== "string" || !value.trim())
        throw new TypeError(name + " must be a non-empty string");
    return value.trim();
}

function getShareCode(value) {
    value = checkString(value, "share code");
    if (/^https?:\/\//i.test(value)) {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.hostname !== "qfile.qq.com" || url.port || url.username || url.password)
            throw new TypeError("invalid QQ flash transfer URL");
        const match = /^\/q\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname);
        if (!match)
            throw new TypeError("invalid QQ flash transfer URL");
        value = match[1];
    }
    if (!/^[a-zA-Z0-9]+$/.test(value))
        throw new TypeError("invalid QQ flash transfer share code");
    return value;
}

function getPhysicalId(file) {
    const id = typeof file === "string" ? file : file && file.physical && file.physical.id;
    return checkString(id, "physical file id");
}

function createFileId() {
    const bytes = randomBytes(16);
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const id = bytes.toString("hex");
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function getFileType(name) {
    const ext = path.extname(name).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".avif"].includes(ext))
        return 26;
    if ([".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv"].includes(ext))
        return 2;
    if ([".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a"].includes(ext))
        return 1;
    if ([".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz"].includes(ext))
        return 4;
    if ([".doc", ".docx", ".rtf", ".odt"].includes(ext))
        return 3;
    if ([".xls", ".xlsx", ".csv"].includes(ext))
        return 6;
    if ([".ppt", ".pptx"].includes(ext))
        return 7;
    if ([".html", ".htm"].includes(ext))
        return 8;
    if ([".txt", ".md", ".log"].includes(ext))
        return 10;
    return ({ ".pdf": 9, ".apk": 5, ".psd": 12, ".ai": 15, ".ipa": 17, ".dmg": 23, ".pkg": 24 })[ext] || 11;
}

class FlashTransfer {
    /**
     * 与 Gfs 一样，这里的方法直接 reject，不经过 _useProtocol。
     * @param {import("../ref").Client} c
     * @param {import("../../").FlashTransferOptions} [options]
     */
    constructor(c, options = {}) {
        this.c = c;
        this.timeout = options.timeout === undefined ? 30000 : options.timeout;
        if (!Number.isSafeInteger(this.timeout) || this.timeout <= 0)
            throw new TypeError("timeout must be a positive integer");
        this._http = axios.create({ timeout: this.timeout });
        this._device_id = "";
        this._ready = null;
        this._captcha = null;
    }

    /**
     * @private
     * @returns {Promise<void>}
     */
    async _init() {
        if (!this._ready) {
            this._ready = (async () => {
                const rsp = await this._http.get(ORIGIN + "/", {
                    validateStatus: status => status === 200 || status === 404,
                    maxRedirects: 0,
                });
                const cookies = rsp.headers["set-cookie"] || [];
                for (const cookie of cookies) {
                    const match = /^deviceId=([^;]+)/.exec(cookie);
                    if (match)
                        this._device_id = match[1];
                }
                if (!this._device_id)
                    throw new FlashTransferError(-1, "qfile did not return a deviceId cookie");
            })().catch(error => {
                this._ready = null;
                throw error;
            });
        }
        await this._ready;
    }

    /**
     * 网页下载遇到验证时，传入用户完成验证码后获得的 ticket 和 randstr。
     * @param {string} ticket
     * @param {string} randstr
     * @returns {void}
     */
    setCaptcha(ticket, randstr) {
        this._captcha = {
            "x-fsq-captcha-ticket": checkString(ticket, "captcha ticket"),
            "x-fsq-captcha-randstr": checkString(randstr, "captcha randstr"),
        };
    }

    /**
     * @private
     * @param {keyof typeof METHODS} method
     * @param {Record<string, any>} body
     * @returns {Promise<Record<string, any>>}
     */
    async _request(method, body) {
        await this._init();
        const [service, command, type] = METHODS[method];
        const data = JSON.stringify({ ...body, scene_type: 103 });
        const nonce = String(randomBytes(4).readUInt32BE() % 10000 + 1);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac("sha1", SIGN_KEY).update(data + nonce + timestamp).digest("hex");
        const rsp = await this._http.post(ORIGIN + RPC_PATH + service, data, {
            maxRedirects: 0,
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0",
                "Referer": ORIGIN + "/",
                "Cookie": `uin=9000002;p_uin=9000002;deviceId=${this._device_id}`,
                "x-device-id": this._device_id,
                "x-oidb": JSON.stringify({ uint32_command: command, uint32_service_type: type }),
                "x-qq-ar-nonce": nonce,
                "x-qq-ar-timestamp": timestamp,
                "x-qq-ar-signature": signature,
                ...(method === "download" ? this._captcha : null),
            },
        });
        const result = rsp.data;
        if (!result || typeof result !== "object" || result.retcode === undefined)
            throw new FlashTransferError(-1, "invalid qfile response");
        const outer = Number(result.retcode);
        const inner = result.error && result.error.code !== undefined ? Number(result.error.code) : 0;
        const code = Number.isFinite(outer) && Number.isFinite(inner) ? outer || inner : NaN;
        if (!Number.isFinite(code) || code !== 0)
            throw new FlashTransferError(code, result.error && result.error.message || result.message);
        if (!result.data || typeof result.data !== "object")
            throw new FlashTransferError(-1, "qfile response has no data");
        return result.data;
    }

    /**
     * 分享码或官网链接转换为文件集 ID。
     * @param {string} code
     * @returns {Promise<string>}
     */
    async resolve(code) {
        const rsp = await this._request("resolve", { code: getShareCode(code) });
        return checkString(rsp.fileset_id, "fileset id");
    }

    /**
     * 原生创建接口需要在线客户端；task_id 必须保留到上传任务提交。
     * @param {string} name
     * @param {import("../../").FlashTransferCreateOptions} [options]
     * @returns {Promise<import("../../").FlashTransferTask>}
     */
    create(name, options) {
        return native.createFileSet(this.c, name, options);
    }

    /**
     * 所有文件完成同步后，提交上传任务；参数是 task_id，不是 fileset_id。
     * @param {string} task_id
     * @returns {Promise<void>}
     */
    submit(task_id) {
        return native.submitUploadTask(this.c, task_id);
    }

    /**
     * 将已创建的文件集发送为原生闪传消息；逐目标检查结果。
     * @param {string} fileset_id
     * @param {import("../../").FlashTransferMessageTarget | import("../../").FlashTransferMessageTarget[]} targets
     * @returns {Promise<import("../../").FlashTransferMessageStatus[]>}
     */
    send(fileset_id, targets) {
        return native.sendMessage(this.c, fileset_id, targets);
    }

    /**
     * @param {Pick<import("../../").FlashTransferTask, "fileset_id" | "task_id">} task
     * @param {import("../../").FlashTransferMetadata[]} files
     * @returns {Promise<import("../../").FlashTransferFile[]>}
     */
    addFiles(task, files) {
        return native.addFiles(this.c, task, files);
    }

    /**
     * @param {Pick<import("../../").FlashTransferTask, "fileset_id">} task
     * @param {import("../../").FlashTransferFile} file
     * @param {import("../../").FlashTransferUploadSource} source
     * @returns {Promise<import("../../").FlashTransferUploadTicket>}
     */
    applyUpload(task, file, source) {
        return native.applyUpload(this.c, source, native.getBizTransInfo(task, file), file.is_cover ? 23 : 22);
    }

    /**
     * @param {import("../../").FlashTransferUploadTicket} ticket
     * @returns {Promise<void>}
     */
    completeFile(ticket) {
        return native.completeFile(this.c, ticket);
    }

    /**
     * 本地文件、目录或 Buffer 的完整上传；直到文件同步和任务提交均成功才返回。
     * @param {import("../../").FlashTransferUploadInput | import("../../").FlashTransferUploadInput[]} files
     * @param {string} [name]
     * @param {(percentage: string) => void} [callback]
     * @param {import("../../").FlashTransferCreateOptions} [options]
     * @returns {Promise<import("../../").FlashTransferUploadResult>}
     */
    async upload(files, name, callback, options = {}) {
        native.checkOnline(this.c);
        if (callback !== undefined && typeof callback !== "function")
            throw new TypeError("upload callback must be a function");
        if (name !== undefined)
            name = checkString(name, "fileset name");
        if (options.duration !== undefined && (!Number.isSafeInteger(options.duration) || options.duration <= 0))
            throw new RangeError("duration must be a positive integer in seconds");
        const inputs = Array.isArray(files) ? files : [files];
        if (!inputs.length)
            throw new TypeError("files must be a non-empty array");
        const metadata = [];
        const sources = new Map();
        let task;
        let stage = "hash";
        /**
         * @param {import("../../").MediaFile} file
         * @param {string} [file_name]
         * @param {string} [parent_id]
         * @param {number} [depth=1]
         * @returns {Promise<{is_dir: boolean, file_size: number, file_count: number}>}
         */
        const collect = async (file, file_name, parent_id = "", depth = 1) => {
            if (file_name !== undefined)
                file_name = checkString(file_name, "file name");
            const binary = file instanceof Uint8Array || file instanceof ArrayBuffer || file instanceof SharedArrayBuffer;
            let stat;
            if (!binary) {
                if (typeof file !== "string")
                    throw new TypeError("upload source must be a local path or binary data");
                file = path.resolve(file);
                stat = await fs.promises.lstat(file);
                if (!stat.isDirectory() && !stat.isFile())
                    throw new TypeError("upload source must be a regular file or directory");
            }
            const cli_fileid = createFileId();
            const meta = {
                cli_fileid, parent_id, depth,
                name: file_name || (!binary ? path.basename(file) : ""),
                cli_file_index: metadata.length + 1,
                is_dir: !!stat?.isDirectory(),
                file_size: 0,
                file_count: 0,
            };
            metadata.push(meta);
            if (meta.is_dir) {
                meta.file_type = 25;
                const children = await fs.promises.readdir(file, { withFileTypes: true });
                children.sort((a, b) => a.name.localeCompare(b.name));
                for (const child of children) {
                    const entry = await collect(path.join(file, child.name), child.name, cli_fileid, depth + 1);
                    meta.file_size += entry.file_size;
                    ++meta.file_count;
                }
            } else {
                const source = await prepareFile(file, meta.name || undefined);
                sources.set(cli_fileid, source);
                await source.close();
                Object.assign(meta, {
                    name: source.name,
                    file_type: getFileType(source.name),
                    file_size: source.size,
                    md5: source.md5.toString("hex"),
                    sha1: source.sha1.toString("hex"),
                });
            }
            return meta;
        };
        try {
            for (const input of inputs) {
                const entry = input && typeof input === "object" && "file" in input ? input : { file: input };
                await collect(entry.file, entry.name);
            }
            stage = "create";
            const total = [...sources.values()].reduce((size, source) => size + source.size, 0);
            task = await this.create(name || metadata[0].name, {
                ...options,
                total_file_count: sources.size,
                total_file_size: total,
                first_level_item_count: metadata.filter(file => !file.parent_id).length,
            });
            stage = "add_files";
            const added = await this.addFiles(task, metadata);
            let transferred = 0, completed = 0;
            for (const file of added) {
                if (file.is_dir)
                    continue;
                const source = sources.get(file.cli_fileid);
                if (!source)
                    throw new FlashTransferError(-1, "upload response has an unknown client file id");
                stage = "apply_upload";
                const ticket = await this.applyUpload(task, file, source);
                stage = "upload";
                if (ticket.ukey && source.size) {
                    await uploadFile(source, ticket.ukey, ticket.appid, this._http, callback ? percentage => {
                        callback(total ? ((transferred + source.size * Number(percentage) / 100) / total * 100).toFixed(2) : "0.00");
                    } : undefined);
                }
                await source.close();
                stage = "complete_file";
                await this.completeFile(ticket);
                file.physical = { id: String(ticket.info[1][2]), status: 2 };
                transferred += source.size;
                ++completed;
                if (callback)
                    callback((total ? transferred / total * 100 : completed / sources.size * 100).toFixed(2));
            }
            stage = "submit";
            await this.submit(task.task_id);
            return { ...task, files: added };
        } catch (error) {
            if (error instanceof Error) {
                error.stage = stage;
                if (task)
                    error.task = task;
            }
            throw error;
        } finally {
            await Promise.allSettled([...sources.values()].map(source => source.close()));
        }
    }

    /**
     * @param {string} fileset_id
     * @returns {Promise<Record<string, any>>}
     */
    async stat(fileset_id) {
        const rsp = await this._request("stat", { fileset_id: checkString(fileset_id, "fileset id") });
        if (!rsp.fileset)
            throw new FlashTransferError(-1, "qfile response has no fileset");
        return rsp.fileset;
    }

    /**
     * pagination_info 是服务端返回的不透明游标，不能当作数字偏移。
     * @param {string} fileset_id
     * @param {string} [parent_id]
     * @param {string} [pagination_info]
     * @param {number} [count=100]
     * @returns {Promise<import("../../").FlashTransferPage>}
     */
    async dir(fileset_id, parent_id = "", pagination_info = "", count = 100) {
        if (!Number.isInteger(count) || count < 1 || count > 100)
            throw new RangeError("count must be between 1 and 100");
        const rsp = await this._request("dir", {
            fileset_id: checkString(fileset_id, "fileset id"),
            req_infos: [{
                parent_id: String(parent_id),
                req_depth: 1,
                count,
                pagination_info: String(pagination_info),
                filter_condition: { file_category: 0, exclude_deleted: true },
                sort_conditions: [{ sort_field: 4, sort_order: 2 }, { sort_field: 0, sort_order: 1 }],
            }],
            support_folder_status: true,
        });
        if (!Array.isArray(rsp.file_lists) || !rsp.file_lists[0])
            throw new FlashTransferError(-1, "qfile response has no file list");
        const page = rsp.file_lists[0];
        if (Array.isArray(page.file_list)) {
            page.file_list = page.file_list.map(({ file_sha1, ...file }) => {
                if (file_sha1 !== undefined)
                    file.sha1 = file_sha1;
                return file;
            });
        }
        return page;
    }

    /**
     * @param {string} fileset_id
     * @param {string} [parent_id]
     * @returns {AsyncGenerator<import("../../").FlashTransferFile>}
     */
    async *files(fileset_id, parent_id = "") {
        let cursor = "";
        const cursors = new Set();
        while (true) {
            const page = await this.dir(fileset_id, parent_id, cursor);
            for (const file of page.file_list || [])
                yield file;
            if (page.is_end)
                return;
            cursor = page.pagination_info;
            if (!cursor || cursors.has(cursor))
                throw new FlashTransferError(-1, "qfile pagination did not advance");
            cursors.add(cursor);
        }
    }

    /**
     * @param {string[]} fileset_ids
     * @returns {Promise<Record<string, any>>}
     */
    async progress(fileset_ids) {
        if (!Array.isArray(fileset_ids) || !fileset_ids.length)
            throw new TypeError("fileset_ids must be a non-empty array");
        return this._request("progress", { fileset_ids: fileset_ids.map(id => checkString(id, "fileset id")) });
    }

    /**
     * @param {string} fileset_id
     * @param {string[]} srv_fileids
     * @returns {Promise<Record<string, any>>}
     */
    async fileProgress(fileset_id, srv_fileids) {
        if (!Array.isArray(srv_fileids))
            throw new TypeError("srv_fileids must be an array");
        return this._request("fileProgress", {
            fileset_id: checkString(fileset_id, "fileset id"),
            srv_fileids: srv_fileids.map(id => checkString(id, "server file id")),
        });
    }

    /**
     * @param {string} fileset_id
     * @param {string} [parent_id]
     * @returns {Promise<Record<string, any>>}
     */
    async category(fileset_id, parent_id = "") {
        return this._request("category", { fileset_id: checkString(fileset_id, "fileset id"), parent_id: String(parent_id) });
    }

    /**
     * 每批最多 30 个文件，返回顺序与请求一致；逐个检查错误，不能过滤掉失败项。
     * @param {(import("../../").FlashTransferFile | string)[]} files
     * @returns {Promise<import("../../").FlashTransferDownload[]>}
     */
    async getDownloadUrls(files) {
        if (!Array.isArray(files) || !files.length)
            throw new TypeError("files must be a non-empty array");
        const ids = files.map(getPhysicalId);
        const result = [];
        for (let start = 0; start < ids.length; start += 30) {
            const batch = ids.slice(start, start + 30);
            const rsp = await this._request("download", {
                req_head: { agent: 8 },
                download_info: batch.map(id => ({
                    batch_id: id,
                    scene: { business_type: 4, app_type: 22, scene_type: 5 },
                    index_node: { file_uuid: id },
                    url_type: 2,
                    download_scene: 0,
                })),
            });
            if (!Array.isArray(rsp.download_rsp) || rsp.download_rsp.length !== batch.length)
                throw new FlashTransferError(-1, "qfile returned an incomplete download batch");
            for (const file of rsp.download_rsp) {
                if (!file.url)
                    throw new FlashTransferError(file.retcode || -1, file.message || "qfile returned no download URL");
                const url = new URL(file.url);
                if (url.protocol !== "http:" && url.protocol !== "https:")
                    throw new FlashTransferError(-1, "invalid qfile download URL");
                result.push(file);
            }
        }
        return result;
    }

    /**
     * @param {import("../../").FlashTransferFile | string} file
     * @returns {Promise<import("../../").FlashTransferDownload>}
     */
    async getDownloadUrl(file) {
        return (await this.getDownloadUrls([file]))[0];
    }

    /**
     * 上传到已有凭证；ukey 和 appid 必须来自服务器的上传申请响应。
     * @param {import("../../").MediaFile} file
     * @param {string} ukey
     * @param {number} appid
     * @param {string} [name]
     * @param {(percentage: string) => void} [callback]
     * @returns {Promise<{name: string, size: number, md5: string, sha1: string}>}
     */
    async uploadFile(file, ukey, appid, name, callback) {
        checkString(ukey, "upload ukey");
        if (!Number.isSafeInteger(appid) || appid <= 0)
            throw new TypeError("upload appid must be a positive integer");
        const source = await prepareFile(file, name);
        try {
            await uploadFile(source, ukey, appid, this._http, callback);
            return {
                name: source.name,
                size: source.size,
                md5: source.md5.toString("hex"),
                sha1: source.sha1.toString("hex"),
            };
        } finally {
            await source.close();
        }
    }

    /**
     * 流式下载到调用方指定的路径；默认不覆盖已有文件。
     * @param {import("../../").FlashTransferFile | string} file
     * @param {string} target
     * @param {(percentage: string) => void} [callback]
     * @returns {Promise<{path: string, size: number, sha1: string}>}
     */
    async download(file, target, callback) {
        target = path.resolve(checkString(target, "download target"));
        const info = await this.getDownloadUrl(file);
        const rsp = await this._http.get(info.url, {
            responseType: "stream",
            maxRedirects: 5,
            // 下载请求不携带控制接口的 Cookie、签名或登录票据。
            headers: { "Accept-Encoding": "identity" },
        });
        const size = typeof file === "object" && file.file_size !== undefined ? Number(file.file_size) :
            rsp.headers["content-length"] === undefined ? null : Number(rsp.headers["content-length"]);
        const expected = typeof file === "object" && file.sha1;
        const hash = createHash("sha1");
        let transferred = 0;
        const temp = target + "." + randomBytes(8).toString("hex") + ".part";
        const progress = new Transform({
            /**
             * @param {Buffer} chunk
             * @param {BufferEncoding} encoding
             * @param {import("stream").TransformCallback} done
             * @returns {void}
             */
            transform(chunk, encoding, done) {
                try {
                    transferred += chunk.length;
                    hash.update(chunk);
                    if (callback)
                        callback(size ? (transferred / size * 100).toFixed(2) : "0.00");
                    done(null, chunk);
                } catch (error) {
                    done(error);
                }
            },
        });
        try {
            await pipelineAsync(rsp.data, progress, fs.createWriteStream(temp, { flags: "wx" }));
            const sha1 = hash.digest("hex");
            if (size !== null && transferred !== size)
                throw new FlashTransferError(-1, "qfile download size mismatch");
            if (expected && sha1 !== String(expected).toLowerCase())
                throw new FlashTransferError(-1, "qfile download SHA1 mismatch");
            // link 原子发布且不覆盖 target；共享目录不支持硬链接时使用独占复制。
            try {
                await fs.promises.link(temp, target);
            } catch (error) {
                if (!["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(error.code))
                    throw error;
                await fs.promises.copyFile(temp, target, fs.constants.COPYFILE_EXCL);
            }
            return { path: target, size: transferred, sha1 };
        } finally {
            rsp.data.destroy();
            await fs.promises.unlink(temp).catch(() => {});
        }
    }
}

/**
 * @this {import("../ref").Client}
 * @param {number | string} recv_id
 * @param {string} fileset_id
 * @param {boolean} [group=false]
 * @returns {import("../ref").ProtocolResponse}
 */
async function sendFlashTransferMsg(recv_id, fileset_id, group = false) {
    if (typeof group !== "boolean")
        throw new TypeError("group must be a boolean");
    try {
        const send_status = await native.sendMessage(this, fileset_id, {
            type: group ? "group" : "private", target: recv_id,
        });
        return { result: 0, data: { fileset_id, send_status } };
    } catch (error) {
        if (error instanceof FlashTransferError)
            return { result: error.code || -1, emsg: error.message };
        throw error;
    }
}

/**
 * 上传单个文件并发送闪传卡片。
 * @this {import("../ref").Client}
 * @param {number | string} recv_id
 * @param {import("../../").MediaFile} file
 * @param {boolean} [group=false]
 * @param {string} [name]
 * @param {(percentage: string) => void} [callback]
 * @returns {import("../ref").ProtocolResponse}
 */
async function sendFlashTransferFile(recv_id, file, group = false, name, callback) {
    if (typeof group !== "boolean")
        throw new TypeError("group must be a boolean");
    if (typeof file === "string") {
        if (!(await fs.promises.lstat(file)).isFile())
            throw new TypeError("flash transfer source must be a single regular file");
    } else if (!(file instanceof Uint8Array || file instanceof ArrayBuffer || file instanceof SharedArrayBuffer)) {
        throw new TypeError("flash transfer source must be a single file path or binary data");
    }
    name = name ? String(name) : undefined;
    const transfer = this.acquireFlashTransfer();
    try {
        const task = await transfer.upload({ file, name }, name, callback);
        const send_status = await transfer.send(task.fileset_id, {
            type: group ? "group" : "private", target: recv_id,
        });
        return { result: 0, data: { ...task, send_status } };
    } catch (error) {
        if (error instanceof FlashTransferError)
            return { result: error.code || -1, emsg: error.message };
        throw error;
    }
}

module.exports = { FlashTransfer, FlashTransferError, sendFlashTransferMsg, sendFlashTransferFile };
