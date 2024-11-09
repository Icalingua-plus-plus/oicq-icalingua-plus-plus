/**
 * protobuf组包解包
 */
"use strict";
// const pb = require("protobufjs");
const pb = require("./protobuf.min");

class Proto {
    /**
     * @param {Buffer} bytes 
     * @param {import("../ref").Proto} decoded 
     */
    constructor(bytes, decoded) {
        if (decoded)
            Reflect.setPrototypeOf(this, decoded);
        this._raw = bytes;
    }
    toString() {
        return String(this._raw);
    }
    toHex() {
        return this._raw.toString("hex");
    }
    toBase64() {
        return this._raw.toString("base64");
    }
    toBuffer() {
        return this._raw;
    }
    toJSON() {
        return pb2Object(this);
    }
    [Symbol.toPrimitive]() {
        return this.toString();
    }
}

/**
 * @param {pb.Writer} writer 
 * @param {number} tag 
 * @param {any} value 
 */
function _encode(writer, tag, value) {
    if (value === null || value === undefined)
        return;
    let type = 2;
    if (typeof value === "number") {
        type = Number.isInteger(value) ? 0 : 1;
    } else if (typeof value === "string") {
        value = Buffer.from(value);
    } else if (value instanceof Uint8Array) {
        //
    } else if (value instanceof Proto) {
        value = value.toBuffer();
    } else if (typeof value === "object") {
        value = encode(value);
    } else if (typeof value === "bigint") {
        const tmp = new pb.util.Long();
        tmp.unsigned = false;
        tmp.low = Number(value & 0xffffffffn);
        tmp.high = Number((value & 0xffffffff00000000n) >> 32n);
        value = tmp;
        type = 0;
    } else {
        return;
    }
    const head = tag << 3 | type;
    writer.uint32(head);
    switch (type) {
    case 0:
        if (value < 0)
            writer.sint64(value);
        else
            writer.int64(value);
        break;
    case 2:
        writer.bytes(value);
        break;
    case 1:
        writer.double(value);
        break;
    }
}

/**
 * @param {import("../ref").Proto} o 
 * @returns {Uint8Array}
 */
function encode(o) {
    Reflect.setPrototypeOf(o, null);
    const writer = new pb.Writer();
    for (let tag in o) {
        const value = o[tag];
        tag = parseInt(tag);
        if (Array.isArray(value)) {
            for (let v of value)
                _encode(writer, tag, v);
        } else {
            _encode(writer, tag, value);
        }
    }
    return writer.finish();
}

/**
 * @param {pb.Long} long 
 */
function long2int(long) {
    if (long.high === 0) {
        return long.low >>> 0;
    }
    const bigint = (BigInt(long.high) << 32n) | (BigInt(long.low) & 0xffffffffn);
    const int = long.toNumber();
    return Number.isSafeInteger(int) ? int : bigint;
}

/**
 * @param {Buffer} buf 
 * @returns {import("../ref").Proto}
 */
function decode(buf) {
    const data = new Proto(buf);
    const reader = new pb.Reader(buf);
    while (reader.pos < reader.len) {
        const k = reader.uint32();
        const tag = k >> 3, type = k & 0b111;
        let value, decoded;
        switch (type) {
        case 0:
            value = long2int(reader.int64());
            break;
        case 1:
            value = long2int(reader.fixed64());
            break;
        case 2:
            value = reader.bytes();
            try {
                decoded = decode(value);
            } catch { }
            value = new Proto(value, decoded);
            break;
        case 5:
            value = reader.fixed32();
            break;
        default:
            return;
        }
        if (Array.isArray(data[tag])) {
            data[tag].push(value);
        } else if (Reflect.has(data, tag)) {
            data[tag] = [data[tag]];
            data[tag].push(value);
        } else {
            data[tag] = value;
        }
    }
    return data;
}

/**
 * 
 * @param {any} pb 
 * @returns {object}
 */
function pb2Object(pb) {
    if (!(pb instanceof Proto)) return pb
    const keys = Object.keys(pb)
    if (keys.length === 1 && keys[0] === '_raw') {
        let pb1
        try {
            pb1 = decode(pb.toBuffer())
        } catch {
            pb1 = null
        }
        if (!pb1) {
            return {
                type: "Buffer",
                hex: pb.toHex(),
                str: pb.toString(),
            }
        }
        pb = pb1
    }
    if (!pb) return pb
    const result = {}
    for (const k of Object.keys(pb)) {
        if (!/^\d+$/.test(k)) continue
        const key = Number(k)
        if (Array.isArray(pb[key])) result[key] =  pb[key].map(pb2Object)
        else if (pb[key] instanceof Proto) result[key] = pb[key].toJSON()
        else if (pb[key] && typeof pb[key] === "object") result[key] = pb2Object(pb[key])
        else if (pb[key] && typeof pb[key] === "bigint") result[key] = { bigint: pb[key].toString() }
        else if (Buffer.isBuffer(pb[key])) result[key] = {
            type: "Buffer",
            hex: pb[key].toString("hex"),
            str: pb[key].toString(),
        }
        else result[key] = pb[key]
    }
    return result
}

module.exports = {
    encode, decode,
};
