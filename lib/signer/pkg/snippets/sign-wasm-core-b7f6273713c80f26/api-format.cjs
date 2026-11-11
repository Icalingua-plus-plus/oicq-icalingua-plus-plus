"use strict";
function uin(input, raw = false) {
    if (typeof input === "number" && (!Number.isSafeInteger(input) || input < 0))
        throw RangeError("uin must be a non-negative safe integer");
    if (
        !["string", "number", "bigint"].includes(typeof input) ||
        !/^\d+$/.test(String(input))
    )
        throw TypeError("uin must be a non-negative decimal integer");
    const n = BigInt(input);
    if (n > 0x7fffffffffffffffn) throw RangeError("uin exceeds int64 range");
    return raw ? String(input) : n.toString();
}
function bytes(input) {
    if (input === undefined) return "";
    if (!(input instanceof Uint8Array))
        throw TypeError("expected Buffer or Uint8Array");
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString(
        "hex",
    );
}
function guid(input) {
    const value = typeof input === "string" ? input.toLowerCase() : bytes(input);
    if (!/^[0-9a-f]{32}$/.test(value))
        throw RangeError("guid must be exactly 16 bytes");
    return value;
}
function prepareRequest(method, input, raw) {
    if (method === "register" || method === "identity") {
        if (
            typeof input.androidid !== "string" ||
            !/^[0-9a-f]{16}$/i.test(input.androidid)
        )
            throw TypeError("androidid must be 16 hexadecimal characters");
        const triple = {
            uin: raw,
            androidid: input.androidid.toLowerCase(),
            guid: guid(input.guid),
        };
        if (method === "identity") return JSON.stringify(triple);
        if (typeof input.qua !== "string" || !input.qua)
            throw TypeError("qua must be nonempty");
        if (input.force !== undefined && typeof input.force !== "boolean")
            throw TypeError("force must be boolean");
        return JSON.stringify({
            ...triple,
            qua: input.qua,
            force: input.force || false,
        });
    }
    if (method === "unregister") return JSON.stringify({ uin: uin(input) });
    if (!input || typeof input !== "object")
        throw TypeError("request must be an object");
    const value = { uin: uin(input.uin) };
    if (method === "energy") {
        if (input.salt === undefined)
            throw TypeError("energy requires an explicit salt");
        if (input.body !== undefined)
            throw TypeError("energy uses salt instead of body");
        if (
            input.cmd !== undefined &&
            input.data !== undefined &&
            input.cmd !== input.data
        )
            throw TypeError("energy cmd and data disagree");
        value.cmd =
            input.cmd === undefined
                ? input.data === undefined
                    ? ""
                    : input.data
                : input.cmd;
        if (typeof value.cmd !== "string") throw TypeError("cmd must be a string");
        value.salt = bytes(input.salt);
    } else if (method === "sign") {
        if (input.salt !== undefined) throw TypeError("use energy for salt");
        if (typeof input.cmd !== "string" || !input.cmd)
            throw TypeError("cmd must be nonempty");
        value.cmd = input.cmd;
        value.body = bytes(input.body);
    } else throw TypeError("unknown public method");
    if (input.seq !== undefined) {
        if (
            !Number.isInteger(input.seq) ||
            input.seq < -0x80000000 ||
            input.seq > 0x7fffffff
        )
            throw RangeError("seq must be int32");
        value.seq = input.seq;
    }
    if (input.token !== undefined) value.token = bytes(input.token);
    return JSON.stringify(value);
}
function finishResult(text) {
    const result = JSON.parse(text);
    if (result && typeof result === "object") {
        for (const key of ["sign", "extra", "token"])
            if (key in result) result[key] = Buffer.from(result[key], "hex");
        return Object.freeze(result);
    }
    return result;
}
exports.prepareRequest = prepareRequest;
exports.finishResult = finishResult;
