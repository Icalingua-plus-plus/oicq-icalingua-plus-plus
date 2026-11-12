/**
 * QQNT 图片和语音上传
 */
"use strict";
const { createHash, randomBytes } = require("crypto");
const pb = require("../algo/pb");
const { int32ip2str, highwayUploadStream } = require("../service");

const BLOCK_SIZE = 1024 * 1024;

function rotateLeft(value, bits) {
    return (value << bits) | (value >>> (32 - bits));
}

// Highway 要求每 1 MiB 的未填充 SHA-1 状态（小端），最后附上标准 SHA-1。
function updateSha1State(state, block, words) {
    for (let offset = 0; offset < block.length; offset += 64) {
        for (let i = 0; i < 16; ++i)
            words[i] = block.readUInt32BE(offset + i * 4);
        for (let i = 16; i < 80; ++i)
            words[i] = rotateLeft(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);

        let [a, b, c, d, e] = state;
        for (let i = 0; i < 80; ++i) {
            let round;
            if (i < 20)
                round = ((b & c) | (~b & d)) + 0x5a827999;
            else if (i < 40)
                round = (b ^ c ^ d) + 0x6ed9eba1;
            else if (i < 60)
                round = ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc;
            else
                round = (b ^ c ^ d) + 0xca62c1d6;
            const next = (rotateLeft(a, 5) + round + e + words[i]) | 0;
            e = d;
            d = c;
            c = rotateLeft(b, 30);
            b = a;
            a = next;
        }
        state[0] += a;
        state[1] += b;
        state[2] += c;
        state[3] += d;
        state[4] += e;
    }
}

async function hashNTMedia(readable, size) {
    const sha1 = createHash("sha1");
    const sha1Stream = [];
    const block = size >= BLOCK_SIZE ? Buffer.allocUnsafe(BLOCK_SIZE) : null;
    const state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
    const words = new Uint32Array(80);
    let filled = 0;
    for await (const chunk of readable) {
        sha1.update(chunk);
        if (!block)
            continue;
        for (let offset = 0; offset < chunk.length;) {
            const length = Math.min(BLOCK_SIZE - filled, chunk.length - offset);
            chunk.copy(block, filled, offset, offset + length);
            filled += length;
            offset += length;
            if (filled === BLOCK_SIZE) {
                updateSha1State(state, block, words);
                const digest = Buffer.allocUnsafe(20);
                state.forEach((word, i) => digest.writeUInt32LE(word, i * 4));
                sha1Stream.push(digest);
                filled = 0;
            }
        }
    }
    const digest = sha1.digest();
    sha1Stream.push(digest);
    return { sha1: digest, sha1Stream };
}

/** @this {import("../ref").Client} */
function getNTMediaScene(target, c2c) {
    if (!c2c)
        return { 202: { 1: target } };
    const group = !this.fl.has(target) && (this.sl.get(target)?.group_id ||
        [...this.gml].find(([, members]) => members instanceof Map && members.has(target))?.[0]);
    const uid = (target === this.uin && this.uid) || this.uin2uid_map.get(target) ||
        this.fl.get(target)?.uid || (group && this.gml.get(group)?.get?.(target)?.uid);
    if (uid) {
        return {
            201: {
                1: 2,
                2: uid,
                3: group ? { 3: { 3: group, 4: uid } } : null,
            },
        };
    }
}

/** @this {import("../ref").Client} */
function getNTMediaHead(scene, c2c, type, command = 100) {
    return {
        1: { 1: this.seq_id + 1, 2: command },
        2: { 101: 2, 102: type, 103: 0, 200: c2c ? 1 : 2, ...scene },
        3: { 1: 2 },
    };
}

function parseNTMediaUpload(rsp, sha1) {
    const head = rsp?.[1];
    if (head?.[2])
        throw new Error(`QQNT 媒体上传申请失败 (${head[2]}): ${head[3] || ""}`);
    const upload = rsp?.[2];
    const infos = upload?.[6]?.[1];
    const info = (Array.isArray(infos) ? infos : [infos]).find(value =>
        String(value?.[1]?.[1]?.[3]).toLowerCase() === sha1);
    if (!info?.[1]?.[2])
        throw new Error("QQNT 媒体上传响应缺少匹配的文件信息");
    return { upload, info, ukey: String(upload[1] ?? "") };
}

/** @this {import("../ref").Client} */
async function requestNTMedia(scene, c2c, type, file, ext) {
    const service = type === 1 ? (c2c ? "11c5" : "11c4") : (c2c ? "126d" : "126e");
    const body = pb.encode({
        1: getNTMediaHead.call(this, scene, c2c, type),
        2: {
            1: { 1: file, 2: 0 },
            2: 1,
            3: 0,
            4: randomBytes(4).readUInt32BE(),
            5: c2c ? 1 : 2,
            6: { [type]: ext, 10: 0 },
            7: 0,
            8: 0,
            9: {},
        },
    });
    const rsp = await this.sendOidbSvcTrpcTcp(`OidbSvcTrpcTcp.0x${service}_100`, body, true);
    return parseNTMediaUpload(rsp, file[3]);
}

/** @this {import("../ref").Client} */
async function uploadNTMedia({ upload, info, ukey }, media, cmd) {
    const servers = Array.isArray(upload[3]) ? upload[3] : [upload[3]];
    const ext = pb.encode({
        1: String(info[1][2]),
        2: ukey,
        5: {
            1: servers.filter(Boolean).map(server => ({
                1: { 1: 1, 2: int32ip2str(server[1]) },
                2: server[2],
            })),
        },
        6: info,
        10: BLOCK_SIZE,
        11: { 1: media.sha1Stream },
    });
    await highwayUploadStream.call(this, media.readable, {
        cmd, md5: media.md5, size: media.size, ext, requireAck: true,
    });
}

module.exports = { hashNTMedia, getNTMediaScene, getNTMediaHead, parseNTMediaUpload, requestNTMedia, uploadNTMedia };
