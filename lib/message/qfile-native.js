/**
 * QQ 闪传原生控制协议。
 */
"use strict";
const pb = require("../algo/pb");
const { getNTMediaHead, getNTMediaScene, parseNTMediaUpload } = require("./nt-media");

class FlashTransferError extends Error {
    name = "FlashTransferError";
    constructor(code, message) {
        super(message ? String(message) : "unknown flash transfer error");
        this.code = code;
    }
}

function checkString(value, name) {
    if (typeof value !== "string" || !value.trim())
        throw new TypeError(name + " must be a non-empty string");
    return value;
}

function list(value) {
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function bytes(value) {
    return value && typeof value.toBuffer === "function" ? value.toBuffer() : Buffer.from(value || []);
}

function text(value) {
    return value === undefined ? "" : String(value);
}

function checkInteger(value, name, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum)
        throw new RangeError(name + " is out of range");
    return value;
}

/**
 * @param {import("../../").FlashTransferUploadSource} source
 * @returns {Record<number, any>}
 */
function fileInfo(source) {
    const data = {
        1: checkInteger(source.size, "file size"),
        2: Buffer.isBuffer(source.md5) ? source.md5.toString("hex") : checkString(source.md5, "file MD5").toLowerCase(),
        3: Buffer.isBuffer(source.sha1) ? source.sha1.toString("hex") : checkString(source.sha1, "file SHA1").toLowerCase(),
        4: checkString(source.name, "file name"),
        5: { 1: 0, 2: 0, 3: 0, 4: 0 },
        6: 0,
        7: 0,
        8: 0,
        9: 0,
    };
    if (!/^[a-f0-9]{32}$/.test(data[2]) || !/^[a-f0-9]{40}$/.test(data[3]))
        throw new TypeError("file metadata requires hexadecimal MD5 and SHA1");
    return data;
}

/**
 * @param {import("../ref").Proto} file
 * @returns {import("../../").FlashTransferFile}
 */
function parseFile(file) {
    const physical = file[13];
    return {
        cli_fileid: text(file[2]),
        parent_id: text(file[4]),
        is_dir: !!file[3],
        name: text(file[8]),
        cli_file_index: Number(file[5] || 0),
        depth: Number(file[6] || 0),
        file_type: Number(file[7] || 0),
        sha1: text(file[20]),
        md5: text(file[25]),
        is_cover: !!file[10],
        file_size: typeof file[11] === "bigint" ? String(file[11]) : Number(file[11] || 0),
        file_count: Number(file[12] || 0),
        physical: { id: text(physical?.[1]) },
        srv_fileid: text(file[15]),
        fileset_id: text(file[1]),
    };
}

/**
 * @param {import("../../").FlashTransferMetadata} file
 * @param {number} index
 * @param {string} fileset_id
 * @returns {Record<number, any>}
 */
function encodeFile(file, index, fileset_id) {
    const size = checkInteger(Number(file.file_size), "file size");
    if (!file.is_dir && (!/^[a-fA-F0-9]{40}$/.test(file.sha1) || !/^[a-fA-F0-9]{32}$/.test(file.md5)))
        throw new TypeError("file metadata requires hexadecimal MD5 and SHA1");
    return {
        1: fileset_id,
        2: checkString(file.cli_fileid, "client file id"),
        3: file.is_dir ? 1 : 0,
        4: file.parent_id || "",
        5: checkInteger(file.cli_file_index === undefined ? index + 1 : file.cli_file_index, "client file index", 1),
        6: checkInteger(file.depth === undefined ? 1 : file.depth, "file depth"),
        7: checkInteger(file.file_type === undefined ? file.is_dir ? 25 : 11 : file.file_type, "file type"),
        8: checkString(file.name, "file name"),
        9: file.name,
        10: file.is_cover ? 1 : 0,
        11: size,
        12: checkInteger(file.file_count || 0, "file count"),
        20: file.sha1?.toLowerCase(),
        24: "",
        25: file.md5?.toLowerCase(),
    };
}

function checkOnline(c) {
    if (!c || typeof c.sendOidbSvcTrpcTcp !== "function" || typeof c.isOnline === "function" && !c.isOnline())
        throw new FlashTransferError(-1, "native flash transfer requires an online client");
}

function checkMediaHead(rsp, command) {
    const head = rsp[1];
    if (!head)
        throw new FlashTransferError(-1, "native media response has no header");
    if (head[2])
        throw new FlashTransferError(Number(head[2]), text(head[3]));
    if (head[1]?.[2] !== command)
        throw new FlashTransferError(-1, "native media response has an unexpected command");
}

/**
 * @param {import("../ref").Client} c
 * @param {string} command
 * @param {Record<number, any>} body
 * @returns {Promise<import("../ref").Proto>}
 */
async function send(c, command, body) {
    checkOnline(c);
    let rsp = await c.sendOidbSvcTrpcTcp(command, pb.encode(body), true);
    if (rsp instanceof Uint8Array)
        rsp = pb.decode(Buffer.from(rsp));
    if (!rsp || typeof rsp !== "object")
        throw new FlashTransferError(-1, "invalid native flash transfer response");
    return rsp;
}

/**
 * 创建文件集，返回后续清单操作和最终提交必需的 task_id。
 * @param {import("../ref").Client} c
 * @param {string} name
 * @param {import("../../").FlashTransferCreateOptions} [options]
 * @returns {Promise<import("../../").FlashTransferTask>}
 */
async function createFileSet(c, name, options = {}) {
    name = checkString(name, "fileset name");
    const duration = options.duration === undefined ? 7 * 86400 : options.duration;
    if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 0xffffffff)
        throw new RangeError("duration must be a positive uint32 integer in seconds");
    const total_file_count = checkInteger(options.total_file_count === undefined ? 1 : options.total_file_count, "total file count", 1);
    const total_file_size = checkInteger(options.total_file_size === undefined ? 0 : options.total_file_size, "total file size");
    const first_level_item_count = checkInteger(options.first_level_item_count === undefined ? total_file_count : options.first_level_item_count, "first level item count", 1);
    if (first_level_item_count > 0xffffffff)
        throw new RangeError("first level item count exceeds uint32 range");
    const rsp = await send(c, "OidbSvcTrpcTcp.0x93cf_1", {
        1: 1,
        2: {
            2: name,
            3: "",
            4: total_file_count,
            5: total_file_size,
            10: c.uin ? [{ 1: String(c.uin), 2: c.nickname, 3: c.uid, 4: "" }] : [],
            16: first_level_item_count,
            20: 0,
            21: 0,
            23: 0,
            24: { 2: 0, 3: "" },
        },
        3: 14,
        4: duration,
    });
    const task_id = rsp[1] === undefined ? "" : String(rsp[1]);
    const fileset_id = rsp[2] === undefined ? "" : String(rsp[2]);
    const share_link = rsp[3] === undefined ? "" : String(rsp[3]);
    if (!fileset_id || !task_id || !share_link)
        throw new FlashTransferError(-1, "create fileset response is missing its identifiers");
    return {
        fileset_id,
        task_id,
        share_link,
        expire_time: rsp[4] === undefined ? 0 : Number(rsp[4]),
        expire_left_time: rsp[5] === undefined ? 0 : Number(rsp[5]),
    };
}

/**
 * 提交上传任务，服务端完成状态为 6。
 * @param {import("../ref").Client} c
 * @param {string} task_id
 * @returns {Promise<void>}
 */
async function submitUploadTask(c, task_id) {
    await send(c, "OidbSvcTrpcTcp.0x93d1_1", {
        1: checkString(task_id, "upload task id"),
        2: 6,
    });
}

/**
 * 由服务端生成原生闪传卡片，不自行构造带签名的 Markdown。
 * @param {import("../ref").Client} c
 * @param {string} fileset_id
 * @param {import("../../").FlashTransferMessageTarget | import("../../").FlashTransferMessageTarget[]} targets
 * @returns {Promise<import("../../").FlashTransferMessageStatus[]>}
 */
async function sendMessage(c, fileset_id, targets) {
    checkOnline(c);
    fileset_id = checkString(fileset_id, "fileset id");
    targets = Array.isArray(targets) ? targets : [targets];
    if (!targets.length)
        throw new TypeError("message targets must be a non-empty array");
    const peers = targets.map(target => {
        if (target?.type === "group") {
            const id = String(target.target);
            if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 0xffffffffffffffffn ||
                typeof target.target === "number" && !Number.isSafeInteger(target.target))
                throw new TypeError("invalid flash transfer group id");
            return { 1: 2, 3: { 1: BigInt(id) } };
        }
        if (target?.type !== "private")
            throw new TypeError("message target type must be private or group");
        let uid = target.target;
        if (typeof uid === "number") {
            checkInteger(uid, "user id", 1);
            uid = getNTMediaScene.call(c, uid, true)?.[201]?.[2];
        }
        if (typeof uid !== "string" || !uid.startsWith("u_") || uid.length <= 2)
            throw new TypeError("flash transfer requires a known user UID");
        return { 1: 1, 2: { 1: uid } };
    });
    const key = peer => Number(peer[1]) + ":" + text(peer[peer[1] === 1 ? 2 : 3]?.[1]);
    const ids = new Set(peers.map(key));
    if (ids.size !== peers.length)
        throw new TypeError("duplicate flash transfer message target");
    const rsp = await send(c, "OidbSvcTrpcTcp.0x93d7_1", { 1: peers, 2: fileset_id });
    const statuses = list(rsp[1]);
    const byTarget = new Map();
    for (const status of statuses) {
        const peer = status[3];
        if (!peer || ![1, 2].includes(peer[1]) || !Number.isInteger(status[1] || 0) ||
            !ids.has(key(peer)) || byTarget.has(key(peer)))
            throw new FlashTransferError(-1, "invalid flash transfer message status");
        byTarget.set(key(peer), {
            target: { type: peer[1] === 1 ? "private" : "group", target: text(peer[peer[1] === 1 ? 2 : 3]?.[1]) },
            result: Number(status[1] || 0),
            message: text(status[2]),
        });
    }
    if (byTarget.size !== peers.length)
        throw new FlashTransferError(-1, "incomplete flash transfer message statuses");
    const result = peers.map(peer => byTarget.get(key(peer)));
    if (c.stat)
        c.stat.sent_msg_cnt += result.filter(status => status.result === 0).length;
    const failed = result.find(status => status.result !== 0);
    if (failed) {
        const error = new FlashTransferError(failed.result, failed.message || "flash transfer message failed");
        error.send_status = result;
        throw error;
    }
    return result;
}

/**
 * 每批最多 200 个节点；5 是批次序号，6 是总批次数。
 * @param {import("../ref").Client} c
 * @param {Pick<import("../../").FlashTransferTask, "fileset_id" | "task_id">} task
 * @param {import("../../").FlashTransferMetadata[]} files
 * @returns {Promise<import("../../").FlashTransferFile[]>}
 */
async function addFiles(c, task, files) {
    const fileset_id = checkString(task.fileset_id, "fileset id");
    const task_id = checkString(task.task_id, "upload task id");
    if (!Array.isArray(files) || !files.length)
        throw new TypeError("files must be a non-empty array");
    const encoded = files.map((file, index) => encodeFile(file, index, fileset_id));
    const ids = new Set(encoded.map(file => file[2]));
    if (ids.size !== files.length)
        throw new TypeError("duplicate client file id");
    const count = Math.ceil(files.length / 200);
    for (let seq = 0; seq < count; ++seq) {
        const batch = encoded.slice(seq * 200, (seq + 1) * 200);
        const request_seq = seq + 1;
        const rsp = await send(c, "OidbSvcTrpcTcp.0x93d0_1", {
            1: 1, 2: task_id, 3: fileset_id, 4: batch, 5: request_seq, 6: count,
        });
        if (Number(rsp[1] || 0) !== request_seq || rsp[2] && text(rsp[2]) !== task_id || rsp[3] && text(rsp[3]) !== fileset_id)
            throw new FlashTransferError(-1, "add files response does not match its upload task");
        for (const failure of list(rsp[5])) {
            if (failure[2])
                throw new FlashTransferError(Number(failure[2]), "add file failed: " + text(failure[1]));
        }
        const returned = new Set();
        for (const file of list(rsp[4])) {
            const cli_fileid = text(file[2]);
            const node = batch.find(item => item[2] === cli_fileid);
            if (!node || returned.has(cli_fileid) || file[1] && text(file[1]) !== fileset_id)
                throw new FlashTransferError(-1, "add files returned an unexpected file");
            returned.add(cli_fileid);
            for (const tag in file) {
                if (/^\d+$/.test(tag))
                    node[tag] = file[tag];
            }
        }
    }
    await send(c, "OidbSvcTrpcTcp.0x93db_1", { 1: task_id, 2: "" });
    return encoded.map(parseFile);
}

/**
 * 编码文件集及文件节点的上传业务透传信息。
 * @param {Pick<import("../../").FlashTransferTask, "fileset_id">} task
 * @param {import("../../").FlashTransferFile} file
 * @returns {Uint8Array}
 */
function getBizTransInfo(task, file) {
    const fileset_id = checkString(task.fileset_id, "fileset id");
    if (file.fileset_id && file.fileset_id !== fileset_id)
        throw new TypeError("file does not belong to this fileset");
    return pb.encode({
        1: fileset_id,
        2: fileset_id,
        3: checkString(file.cli_fileid, "client file id"),
        4: checkInteger(file.depth, "file depth"),
        5: file.is_cover ? 1 : 0,
        6: 0,
        7: checkInteger(file.file_type, "file type"),
        8: text(file.srv_fileid),
        9: file.is_cover_original ? 1 : 0,
        10: 0, 11: 0, 12: 0, 13: 0, 14: 0,
    });
}

/**
 * 使用同一套 NT 请求头和上传响应解析，文件业务使用 app_type=22、scene_type=5。
 * @param {import("../ref").Client} c
 * @param {import("../../").FlashTransferUploadSource} source
 * @param {Uint8Array | import("../ref").Proto} biz_trans_info
 * @param {number} [app_type=22]
 * @returns {Promise<import("../../").FlashTransferUploadTicket>}
 */
async function applyUpload(c, source, biz_trans_info, app_type = 22) {
    const data = fileInfo(source);
    const rsp = await send(c, "OidbSvcTrpcTcp.0x12a9_100", {
        1: getNTMediaHead.call(c, { 103: app_type, 200: 5 }, true, 4),
        2: {
            1: { 1: data, 2: 0 },
            2: 0, 3: 0, 4: 0, 5: 0,
            6: {
                1: { 1: 0, 2: "" },
                2: { 3: Buffer.alloc(0) },
                3: { 11: Buffer.alloc(0), 12: Buffer.alloc(0) },
                4: { 1: "" },
                10: 0,
            },
            7: 0, 8: 0, 9: bytes(biz_trans_info),
        },
    });
    checkMediaHead(rsp, 100);
    const ticket = parseNTMediaUpload(rsp, data[3]);
    const appid = Number(ticket.info[1][7] || 0);
    if (ticket.ukey && (!Number.isSafeInteger(appid) || appid <= 0 || appid > 0xffffffff))
        throw new FlashTransferError(-1, "upload response has no store appid");
    const storage = list(ticket.upload[7]).filter(item => !item[1]).pop();
    return {
        ...ticket,
        app_type,
        appid,
        biz_trans_info: bytes(ticket.upload[12]).length ? bytes(ticket.upload[12]) : bytes(biz_trans_info),
        storage_type: Number(storage?.[2] || 0),
        storage_info: bytes(storage?.[3]),
    };
}

/**
 * 文件完成同步使用命令 103，消息体字段 12；不能用图片发送完成消息代替。
 * @param {import("../ref").Client} c
 * @param {import("../../").FlashTransferUploadTicket} ticket
 * @returns {Promise<void>}
 */
async function completeFile(c, ticket) {
    const node = ticket.info[1];
    const rsp = await send(c, "OidbSvcTrpcTcp.0x12a9_103", {
        1: getNTMediaHead.call(c, { 103: ticket.app_type || 22, 200: 5 }, true, 4, 103),
        12: {
            // 7、8 是响应中的应用标识，IndexNode 请求只回传 1–6。
            1: { 1: node[1], 2: node[2], 3: node[3] || 0, 4: node[4] || 0, 5: node[5] || 0, 6: node[6] || 0 },
            2: { 1: 2 },
            3: { 1: 0, 2: 0, 3: 0, 4: "" },
            4: { 1: ticket.storage_type, 2: ticket.storage_info },
            10: ticket.biz_trans_info,
        },
    });
    checkMediaHead(rsp, 103);
    const complete = rsp[12];
    if (!complete)
        throw new FlashTransferError(-1, "file completion response has no completion body");
    const business = complete[2];
    if (business?.[1])
        throw new FlashTransferError(Number(business[1]), text(business[2]));
}

module.exports = { FlashTransferError, checkOnline, createFileSet, addFiles, getBizTransInfo, applyUpload, completeFile, submitUploadTask, sendMessage };
