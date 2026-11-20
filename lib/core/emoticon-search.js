"use strict";

const pb = require("../algo/pb");

const SEARCH_COMMAND = "OidbSvcTrpcTcp.0x9038_1";
const EMPTY_SESSION = Buffer.alloc(0);
const SCENE_MAGNIFIER = 1;
const SCENE_MAGNIFIER_COMPOSE = 6;
const AIO_UNDEFINED = 0;
const AIO_C2C = 1;
const AIO_GROUP = 2;

function decodePoint(point) {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(point?.[1] ?? 0, 0);
    bytes.writeUInt32LE(point?.[2] ?? 0, 4);
    return { x: bytes.readFloatLE(0), y: bytes.readFloatLE(4) };
}

function decodeColor(color) {
    return { red: color[1] ?? 0, green: color[2] ?? 0, blue: color[3] ?? 0, alpha: color[4] ?? 0 };
}

function decodeImageSize(value = 0) {
    // The shared decoder reads varints as signed int64.
    return value < 0 ? BigInt.asUintN(64, BigInt(value)) : value;
}

function decodeSearchItem(item) {
    const compose = item[19];
    const mall = item[20];
    const channel = item[21];
    const result = {
        resource_id: String(item[1] ?? ""),
        image: {
            md5: String(item[2] ?? ""),
            width: item[3] ?? 0,
            height: item[4] ?? 0,
            url: String(item[5] ?? ""),
            size: decodeImageSize(item[6]),
        },
        thumbnail: {
            md5: String(item[7] ?? ""),
            width: item[8] ?? 0,
            height: item[9] ?? 0,
            url: String(item[10] ?? ""),
            size: decodeImageSize(item[11]),
        },
        image_other: String(item[12] ?? ""),
        package_id: String(item[13] ?? ""),
        package_type: String(item[14] ?? ""),
        source_url: String(item[15] ?? ""),
        source_icon_url: String(item[16] ?? ""),
        source_name: String(item[17] ?? ""),
        emoji_type: item[18] ?? 0,
    };

    if (compose) {
        result.text_compose = {};
        if (compose[1]) {
            result.text_compose.bounding_box = {
                top_left: decodePoint(compose[1][1]),
                bottom_right: decodePoint(compose[1][2]),
            };
        }
        if (compose[2]) result.text_compose.text_color = decodeColor(compose[2]);
        if (compose[3]) result.text_compose.shadow_color = decodeColor(compose[3]);
    }
    if (mall) {
        result.mall = {
            pack_id: mall[1] ?? 0,
            pic_id: String(mall[2] ?? ""),
            jump_url: String(mall[3] ?? ""),
            name: String(mall[4] ?? ""),
        };
    }
    if (channel) {
        result.channel = {
            feed_id: String(channel[1] ?? ""),
            pic_id: String(channel[2] ?? ""),
            jump_url: String(channel[3] ?? ""),
        };
    }
    return result;
}

function decodeItems(items) {
    if (!items) return [];
    return (Array.isArray(items) ? items : [items]).map(decodeSearchItem);
}

/**
 * 请求 QQNT 表情搜索结果。
 * @this {import("./ref").Client}
 * @param {string} keyword 搜索词
 * @param {import("../../index").EmoticonSearchOptions} [options] 分页和会话选项
 * @returns {import("./ref").ProtocolResponse}
 */
async function searchEmoticons(keyword, options = {}) {
    if (typeof keyword !== "string" || !keyword.trim())
        throw new TypeError("keyword must be a non-empty string");

    const { session_info = EMPTY_SESSION, group_id, guest_uid, compose_only = false } = options;
    if (!(session_info instanceof Uint8Array))
        throw new TypeError("session_info must be a Uint8Array");
    if (group_id !== undefined && (!Number.isSafeInteger(group_id) || group_id <= 0))
        throw new RangeError("group_id must be a positive integer");
    if (guest_uid !== undefined && (typeof guest_uid !== "string" || !guest_uid.trim()))
        throw new TypeError("guest_uid must be a non-empty string");
    if (group_id !== undefined && guest_uid !== undefined)
        throw new TypeError("group_id and guest_uid are mutually exclusive");

    const page_size = options.page_size ?? (session_info.length ? 24 : 32);
    if (!Number.isInteger(page_size) || page_size < 1 || page_size > 0xffffffff)
        throw new RangeError("page_size must be a positive uint32");

    const aio_type = group_id ? AIO_GROUP : guest_uid ? AIO_C2C : AIO_UNDEFINED;
    // EmojiHotPicSearchReqBody in QQ Android 9.3.50 libkernel.so (0x16fe908).
    const body = pb.encode({
        1: this.uin,
        2: keyword,
        3: page_size,
        4: 0, // session_info is the continuation cursor.
        5: session_info.length ? session_info : undefined,
        6: compose_only ? SCENE_MAGNIFIER_COMPOSE : SCENE_MAGNIFIER,
        7: aio_type,
        8: guest_uid ?? "",
        9: group_id ?? 0,
        10: 0,
        11: 0,
        12: 1,
        13: Number(aio_type !== AIO_UNDEFINED),
    });
    const rsp = await this.sendOidbSvcTrpcTcp(SEARCH_COMMAND, body, true);
    if (!rsp || typeof rsp.toBuffer !== "function")
        throw new Error("missing emoticon search response body");

    // The transport decodes the OIDB envelope. Decode its inner message for this RPC.
    const bytes = rsp.toBuffer();
    const data = pb.decode(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    if (!data) throw new Error("invalid emoticon search response body");

    const result = data[1] ?? 0;
    if (result !== 0) return { result, emsg: String(data[2] ?? "") };

    const next_session = data[6]?.toBuffer() ?? EMPTY_SESSION;
    return {
        result: 0,
        data: {
            items: decodeItems(data[3]),
            session_info: next_session,
            has_more: Boolean(data[5]) && next_session.length > 0,
            compose_items: decodeItems(data[7]),
            allow_compose: Boolean(data[8]),
            other: String(data[4] ?? ""),
        },
    };
}

module.exports = { searchEmoticons };
