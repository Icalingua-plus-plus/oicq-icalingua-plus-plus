"use strict";
const axios = require("axios");
const pb = require("../algo/pb");
const schema = require("./favorites-schema");
const { gunzipSync } = require("zlib");
const { TimeoutError } = require("../exception");

const URL = "https://collector.weiyun.com/collector.fcg";
const APPID = 30244;
const LIMIT = 16 * 1024 * 1024;
const sequences = new WeakMap();

/**
 * 构造微云收藏请求帧，写入 16 字节大端帧头及 Protobuf 载荷。
 * @param {Object<number, any>} head MsgHead 字段
 * @param {Object<number, any>} body MsgBody 字段
 * @returns {Buffer}
 */
function pack(head, body) {
    head = Buffer.from(pb.encode(head));
    body = Buffer.from(pb.encode(body));
    const frame = Buffer.alloc(16 + head.length + body.length);
    frame.writeUInt32BE(0x20130329, 0);
    frame.writeUInt16BE(1, 4);
    frame.writeUInt32BE(frame.length, 6);
    frame.writeUInt32BE(body.length, 10);
    head.copy(frame, 16);
    body.copy(frame, 16 + head.length);
    return frame;
}

/**
 * 校验收藏响应帧的标识、版本及长度，解码消息头与消息体。
 * @param {Buffer | Uint8Array} frame 完整的二进制响应帧
 * @returns {{head: import("./ref").Proto, body: import("./ref").Proto}}
 */
function unpack(frame) {
    frame = Buffer.from(frame);
    if (frame.length < 16 || frame.length > LIMIT || frame.readUInt32BE(0) !== 0x20130329 ||
        ![1, 2].includes(frame.readUInt16BE(4)) || frame.readUInt32BE(6) !== frame.length ||
        frame.readUInt16BE(14) !== 0)
        throw new Error("Invalid favorites response frame");
    const end = frame.length - frame.readUInt32BE(10);
    if (end <= 16 || end > frame.length)
        throw new Error("Invalid favorites response lengths");
    const head = pb.decode(frame.subarray(16, end));
    const body = pb.decode(frame.subarray(end));
    if (!head || !body)
        throw new Error("Invalid favorites protobuf response");
    return { head, body };
}

const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = value => value === undefined ? "" : String(value);
function fields(value) {
    const out = {};
    for (const key in value)
        if (/^\d+$/.test(key)) out[key] = value[key];
    return out;
}
/**
 * 按收藏字段表转换为命名对象，保留字节内容并避免 uint64 精度丢失。
 * @param {keyof typeof schema} name 字段表中的消息名称
 * @param {import("./ref").Proto} value 已解码的 Protobuf 消息
 * @returns {Object<string, any>}
 */
function decode(name, value) {
    const out = {};
    for (const [key, [tag, type]] of Object.entries(schema[name])) {
        const repeated = type.endsWith("[]");
        const kind = repeated ? type.slice(0, -2) : type;
        const convert = v => {
            if (kind === "string") return String(v);
            if (kind === "bytes") return v.toBase64();
            if (kind === "bool") return Boolean(v);
            if (kind === "u64") {
                const n = BigInt.asUintN(64, BigInt(v));
                return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n.toString();
            }
            if (kind === "double") {
                const bytes = Buffer.alloc(8);
                bytes.writeBigUInt64LE(BigInt.asUintN(64, BigInt(v)));
                return bytes.readDoubleLE();
            }
            if (kind === "number") return Number(v);
            return decode(kind, v);
        };
        if (repeated) out[key] = list(value && value[tag]).map(convert);
        else if (value && value[tag] !== undefined) out[key] = convert(value[tag]);
    }
    return out;
}
function object(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${name} must be an object`);
    return value;
}
function uint(value, name, max = 0xffffffff) {
    if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
    if (!Number.isSafeInteger(value) || value < 0 || value > max)
        throw new Error(`Invalid ${name}`);
    return value;
}
function string(value, name, empty = false) {
    if (typeof value !== "string" || (!empty && !value.length))
        throw new Error(`Invalid ${name}`);
    return value;
}
function ids(value, name = "cid") {
    const out = Array.isArray(value) ? value : [value];
    if (!out.length || out.length > 10) throw new Error(`${name} must contain 1 to 10 values`);
    return out.map(v => string(v, name));
}
function url(value) {
    string(value, "url");
    const parsed = new global.URL(value);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("url must use HTTP or HTTPS");
    return value;
}
function error(result, emsg) { return { result, emsg }; }
function success(data) { return { result: 0, data }; }

/**
 * 发送微云收藏请求并校验响应；业务错误通过 ProtocolResponse 返回。
 * @param {import("./ref").Client} client 持有微云票据的客户端
 * @param {number} cmd 收藏业务命令号，同时用作消息体字段号
 * @param {Object<number, any>} payload 对应业务命令的 Protobuf 请求字段
 * @returns {import("./ref").ProtocolResponse}
 */
async function request(client, cmd, payload) {
    const key = client._cookies && client._cookies["weiyun.com"];
    if (!key || !key.length) throw new Error("Missing weiyun.com p_skey; log in again to request the favorites ticket");
    const pskey = String(key);
    if (/[\r\n;]/.test(pskey)) throw new Error("Invalid weiyun.com p_skey");
    const seq = ((sequences.get(client) || 0) + 1) >>> 0 || 1;
    sequences.set(client, seq);
    const version = text(client.apk && client.apk.ver).split(".");
    const head = {
        1: client.uin, 2: seq, 3: 1, 4: cmd, 5: APPID,
        6: Number(text(client.apk && client.apk.version).split(".")[3]) || 0,
        7: 1, 10: 27, 11: Buffer.from(pskey),
        14: Number(version[0]) || 0, 15: Number(version[1]) || 0,
    };
    let response;
    try {
        response = await axios.post(URL, pack(head, { 1: { [cmd]: payload } }), {
            headers: {
                "Content-Type": "application/octet-stream",
                "Accept-Encoding": "gzip",
                Cookie: `uin=${client.uin};vt=27;vi=${pskey};appid=${APPID}`,
            },
            responseType: "arraybuffer", timeout: 15000, maxRedirects: 0,
            maxContentLength: LIMIT, maxBodyLength: LIMIT,
        });
    } catch (e) {
        if (e.code === "ECONNABORTED" || e.code === "ETIMEDOUT") throw new TimeoutError();
        // Axios errors contain request headers and the ticket-bearing protobuf body.
        throw new Error("Favorites HTTPS request failed" + (e.response ? ` (HTTP ${e.response.status})` : ""));
    }
    const httpCode = response.headers && response.headers["user-returncode"];
    if (httpCode !== undefined && String(httpCode) !== "0")
        return error(Number(httpCode) || -1, `Favorites User-ReturnCode: ${httpCode}`);
    const result = unpack(response.data);
    if (result.head[4] !== cmd || result.head[2] !== seq || result.head[3] !== 2)
        throw new Error("Mismatched favorites response");
    if (result.head[101] && result.head[101] !== 215000)
        return error(Number(BigInt.asIntN(32, BigInt(result.head[101]))), text(result.head[103] || result.head[102]) || "Favorites request rejected");
    const body = result.body[2] && result.body[2][cmd];
    if (!body) throw new Error("Missing favorites response body");
    return success(body);
}

/**
 * 获取一页收藏摘要，时间与游标使用服务端返回的毫秒值。
 * @this {import("./ref").Client}
 * @param {import("../../").FavoriteListOptions} [options={}] 筛选条件与分页参数，默认每页 20 条
 * @returns {import("./ref").ProtocolResponse}
 */
async function getFavoriteList(options = {}) {
    object(options, "options");
    if (options.page_size !== undefined && uint(options.page_size, "page_size", 100) === 0) throw new Error("page_size must be positive");
    const result = await request(this, 20000, {
        1: uint(options.type ?? 0, "type"), 2: uint(options.bid ?? 0, "bid"),
        3: uint(options.category ?? 0, "category"),
        4: uint(options.start_time ?? 0, "start_time", Number.MAX_SAFE_INTEGER),
        5: uint(options.order_type ?? 0, "order_type", 1),
        6: uint(options.start_pos ?? 0, "start_pos", Number.MAX_SAFE_INTEGER),
        7: uint(options.page_size ?? 20, "page_size", 100),
        8: uint(options.sync_policy ?? 0, "sync_policy"), 9: 0,
    });
    if (result.result) return result;
    const data = decode("GetCollectionListMsgRsp", result.data);
    // 215000 signals an incomplete sync page in the APK, not a fatal error.
    if (data.result && data.result !== 215000) return error(data.result, "Favorites list request rejected");
    return success(data);
}
/**
 * 获取指定收藏的原始完整详情，供读取与保留未知字段的编辑流程使用。
 * @param {import("./ref").Client} client 已登录的客户端
 * @param {string} cid 收藏 ID
 * @returns {import("./ref").ProtocolResponse}
 */
async function fullInfo(client, cid) {
    string(cid, "cid");
    const result = await request(client, 20013, { 1: [cid] });
    if (result.result) return result;
    const found = list(result.data[1]).find(item => text(item[1] && item[1][1]) === cid);
    if (!found) return error(-1, "Favorite not found");
    return success(found);
}
/**
 * 获取收藏完整详情，富文本同时返回解压后的 HTML。
 * @this {import("./ref").Client}
 * @param {string} cid 收藏 ID
 * @returns {import("./ref").ProtocolResponse}
 */
async function getFavorite(cid) {
    const result = await fullInfo(this, cid);
    if (result.result) return result;
    const data = decode("CollectionFullInfo", result.data);
    const rich = data.content && data.content.rich_media_content;
    const summary = data.collection.summary && data.collection.summary.rich_media_summary;
    if (rich && rich.raw_data !== undefined && summary && [1, 2].includes(summary.content_type)) {
        const raw = Buffer.from(rich.raw_data, "base64");
        data.html = (summary.content_type === 2 ? gunzipSync(raw, { maxOutputLength: LIMIT }) : raw).toString();
    }
    return success(data);
}
/**
 * 增加文本、链接或 HTML 收藏，返回收藏 ID 与收藏时间。
 * @this {import("./ref").Client}
 * @param {import("../../").FavoriteInput | string} favorite 收藏内容，字符串按文本收藏处理
 * @returns {import("./ref").ProtocolResponse}
 */
async function addFavorite(favorite) {
    if (typeof favorite === "string") favorite = { type: "text", text: favorite };
    object(favorite, "favorite");
    const now = Date.now();
    const common = {
        1: uint(favorite.bid ?? 1, "bid"), 2: uint(favorite.category ?? 2, "category"),
        3: { 1: 1, 2: this.uin, 3: String(this.uin) }, 4: now, 5: now,
        9: 0, 10: uint(favorite.custom_group_id ?? 0, "custom_group_id"),
    };
    let cmd, payload;
    if (favorite.type === "text" || favorite.type === undefined) {
        const content = string(favorite.text, "text");
        cmd = 20003;
        payload = { 1: common, 2: { 1: content.slice(0, 200), 2: 0 }, 3: { 1: content, 2: 0 } };
    } else if (favorite.type === "link") {
        cmd = 20004;
        payload = { 1: common, 2: {
            1: url(favorite.url), 2: string(favorite.title ?? favorite.url, "title", true),
            3: string(favorite.publisher ?? "", "publisher", true),
            4: string(favorite.brief ?? "", "brief", true),
        } };
    } else if (favorite.type === "rich") {
        cmd = 20009;
        payload = { 1: common, 2: {
            1: string(favorite.title ?? "", "title", true),
            3: string(favorite.brief ?? "", "brief", true), 5: 1, 8: 1,
        }, 3: { 2: Buffer.from(string(favorite.html, "html")) } };
    } else throw new Error("Only text, link and rich favorites can be added");
    const result = await request(this, cmd, payload);
    if (result.result) return result;
    if (!text(result.data[1])) throw new Error("Missing created favorite cid");
    return success({ cid: String(result.data[1]), collect_time: result.data[2] === undefined ? 0 : text(result.data[2]) });
}
/**
 * 读取当前详情后合并修改，保留未指定的元数据、资源和未知字段。
 * @this {import("./ref").Client}
 * @param {string} cid 收藏 ID
 * @param {import("../../").FavoriteChanges} changes 需要更新的正文、摘要或元数据字段
 * @returns {import("./ref").ProtocolResponse}
 */
async function editFavorite(cid, changes) {
    object(changes, "changes");
    const allowed = ["text", "html", "url", "title", "publisher", "brief", "category", "custom_group_id", "star_mark"];
    if (!Object.values(changes).some(v => v !== undefined) || Object.keys(changes).some(k => !allowed.includes(k)))
        throw new Error("Unsupported or empty favorite changes");
    for (const key of ["category", "custom_group_id"])
        if (changes[key] !== undefined) uint(changes[key], key);
    if (changes.star_mark !== undefined && typeof changes.star_mark !== "boolean") throw new Error("star_mark must be boolean");
    if (changes.text !== undefined) string(changes.text, "text");
    if (changes.html !== undefined) string(changes.html, "html");
    if (changes.url !== undefined) url(changes.url);
    for (const key of ["title", "publisher", "brief"])
        if (changes[key] !== undefined) string(changes[key], key, true);
    const result = await fullInfo(this, cid);
    if (result.result) return result;
    const collection = fields(result.data[1]);
    const content = fields(result.data[2]);
    const summary = fields(collection[15]);
    if (changes.text !== undefined) {
        if (collection[2] !== 1) throw new Error("text can only edit a text favorite");
        summary[1] = { ...fields(summary[1]), 1: changes.text.slice(0, 200) };
        content[1] = { ...fields(content[1]), 1: changes.text };
    }
    if (changes.html !== undefined || (collection[2] === 8 && ["title", "publisher", "brief"].some(k => changes[k] !== undefined))) {
        if (collection[2] !== 8) throw new Error("html can only edit a rich favorite");
        const rich = fields(summary[8]);
        for (const [key, tag] of [["title", 1], ["brief", 3], ["publisher", 7]])
            if (changes[key] !== undefined) rich[tag] = changes[key];
        if (changes.html !== undefined) {
            rich[5] = 1;
            content[8] = { ...fields(content[8]), 2: Buffer.from(changes.html) };
        }
        summary[8] = rich;
    }
    if (changes.url !== undefined || (collection[2] !== 8 && ["title", "publisher", "brief"].some(k => changes[k] !== undefined))) {
        if (collection[2] !== 6) throw new Error("Link fields can only edit a link favorite");
        const link = fields(summary[2]);
        for (const [key, tag] of [["url", 1], ["title", 2], ["publisher", 3], ["brief", 4]])
            if (changes[key] !== undefined) link[tag] = changes[key];
        summary[2] = link;
    }
    if (collection[15] || Object.keys(summary).length) collection[15] = summary;
    if (changes.category !== undefined) collection[8] = uint(changes.category, "category");
    if (changes.custom_group_id !== undefined) collection[20] = uint(changes.custom_group_id, "custom_group_id");
    if (changes.star_mark !== undefined) collection[16] = Number(changes.star_mark);
    const payload = { 1: collection };
    if (result.data[2] !== undefined || changes.text !== undefined || changes.html !== undefined) payload[2] = content;
    const updated = await request(this, 20012, payload);
    return updated.result ? updated : success({ cid, modify_time: text(updated.data[1]) });
}

/**
 * 解析 packed 或 unpacked 的批量状态，按输入顺序关联每项结果。
 * @param {import("./ref").Proto | number | bigint | (number | bigint)[] | undefined} value 响应中的逐项结果字段
 * @param {(string | number)[]} input 请求中的收藏或分组 ID，顺序须与响应一致
 * @returns {import("../../").FavoriteItemResults}
 */
function itemResults(value, input) {
    let results = list(value);
    // Protobuf accepts both packed and unpacked repeated int32 results.
    if (results.length === 1 && results[0] && typeof results[0].toBuffer === "function") {
        const bytes = results[0].toBuffer();
        results = [];
        let n = 0n, shift = 0n;
        for (const byte of bytes) {
            n |= BigInt(byte & 127) << shift;
            if (byte < 128) { results.push(Number(BigInt.asIntN(32, n))); n = shift = 0n; }
            else { shift += 7n; if (shift >= 70n) throw new Error("Invalid favorites item results"); }
        }
        if (shift) throw new Error("Truncated favorites item results");
    }
    if (results.length !== input.length) throw new Error("Missing favorites item results");
    const items = input.map((id, i) => ({ id, result: Number(BigInt.asIntN(32, BigInt(results[i]))) }));
    return { success: items.every(item => item.result === 0), results: items };
}
/**
 * 删除 1~10 条收藏，需检查返回数据的 success 及逐项 result。
 * @this {import("./ref").Client}
 * @param {string | string[]} cid 单个收藏 ID 或收藏 ID 列表
 * @returns {import("./ref").ProtocolResponse}
 */
async function deleteFavorite(cid) {
    const input = ids(cid);
    const result = await request(this, 20002, { 1: input });
    return result.result ? result : success(itemResults(result.data[1], input));
}
/**
 * 获取收藏分组及分组同步信息。
 * @this {import("./ref").Client}
 * @returns {import("./ref").ProtocolResponse}
 */
async function getFavoriteGroups() {
    const result = await request(this, 20021, { 1: 0, 2: 0 });
    return result.result ? result : success(decode("GetCustomGroupMsgRsp", result.data));
}
/**
 * 增加收藏分组，返回分组 ID 与创建时间。
 * @this {import("./ref").Client}
 * @param {string} name 非空分组名称
 * @returns {import("./ref").ProtocolResponse}
 */
async function addFavoriteGroup(name) {
    const result = await request(this, 20022, { 1: string(name, "name") });
    return result.result ? result : success({ custom_group_id: result.data[1], create_time: result.data[2] });
}
/**
 * 修改收藏分组名称，返回修改时间。
 * @this {import("./ref").Client}
 * @param {number} custom_group_id 分组 ID
 * @param {string} name 新的非空分组名称
 * @returns {import("./ref").ProtocolResponse}
 */
async function editFavoriteGroup(custom_group_id, name) {
    const result = await request(this, 20023, { 1: uint(custom_group_id, "custom_group_id"), 2: string(name, "name") });
    return result.result ? result : success({ modify_time: result.data[1] });
}
/**
 * 删除 1~10 个收藏分组，返回删除时间和逐项处理结果。
 * @this {import("./ref").Client}
 * @param {number | number[]} custom_group_id 单个分组 ID 或分组 ID 列表
 * @returns {import("./ref").ProtocolResponse}
 */
async function deleteFavoriteGroup(custom_group_id) {
    const input = Array.isArray(custom_group_id) ? custom_group_id : [custom_group_id];
    if (!input.length || input.length > 10) throw new Error("custom_group_id must contain 1 to 10 values");
    const values = input.map(v => uint(v, "custom_group_id"));
    const result = await request(this, 20024, { 1: values });
    return result.result ? result : success({ ...itemResults(result.data[2], values), del_time: result.data[1] });
}
/**
 * 设置 1~10 条收藏的所属分组，返回逐项处理结果。
 * @this {import("./ref").Client}
 * @param {string | string[]} cid 单个收藏 ID 或收藏 ID 列表
 * @param {number} custom_group_id 目标分组 ID
 * @returns {import("./ref").ProtocolResponse}
 */
async function setFavoriteGroup(cid, custom_group_id) {
    const input = ids(cid);
    const result = await request(this, 20025, { 1: input, 2: uint(custom_group_id, "custom_group_id") });
    return result.result ? result : success(itemResults(result.data[1], input));
}
/**
 * 获取收藏空间总量与已用量，单位为字节。
 * @this {import("./ref").Client}
 * @returns {import("./ref").ProtocolResponse}
 */
async function getFavoriteSpace() {
    const result = await request(this, 20020, {});
    if (result.result) return result;
    const data = decode("GetCollectorUserInfoRsp", result.data);
    return success({ total_space: data.toatal_space ?? 0, used_space: data.used_space ?? 0 });
}

module.exports = {
    getFavoriteList, getFavorite, addFavorite, editFavorite, deleteFavorite,
    getFavoriteGroups, addFavoriteGroup, editFavoriteGroup, deleteFavoriteGroup, setFavoriteGroup, getFavoriteSpace,
};
