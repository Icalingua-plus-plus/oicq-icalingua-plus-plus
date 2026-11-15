
let imports = {};
imports['./snippets/sign-wasm-core-b7f6273713c80f26/host.cjs'] = require('./snippets/sign-wasm-core-b7f6273713c80f26/host.cjs');
imports['./snippets/sign-wasm-core-b7f6273713c80f26/worker-host.cjs'] = require('./snippets/sign-wasm-core-b7f6273713c80f26/worker-host.cjs');
imports['__wbindgen_placeholder__'] = module.exports;
const { prepareRequest } = require(String.raw`./snippets/sign-wasm-core-b7f6273713c80f26/api-format.cjs`);
const { functionSource, randomBytes } = require(String.raw`./snippets/sign-wasm-core-b7f6273713c80f26/host.cjs`);

let heap = new Array(128).fill(undefined);

heap.push(undefined, null, true, false);

function getObject(idx) { return heap[idx]; }

let WASM_VECTOR_LEN = 0;

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.ops_20e3_claim_metric_dispatch_1de.buffer);
    }
    return cachedUint8ArrayMemory0;
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.ops_20e3_claim_metric_dispatch_1de.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.ops_20e3_claim_metric_dispatch_1de.buffer);
    }
    return cachedDataViewMemory0;
}

let heap_next = heap.length;

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.ops_ff35_pool_ticket_dispatch_243(addHeapObject(e));
    }
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    const mem = getDataViewMemory0();
    for (let i = 0; i < array.length; i++) {
        mem.setUint32(ptr + 4 * i, addHeapObject(array[i]), true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

const ChannelFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.ops_d6e4_ticket_envelope_dispatch_32b(ptr >>> 0, 1));

class Channel {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ChannelFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.ops_d6e4_ticket_envelope_dispatch_32b(ptr, 0);
    }
    constructor() {
        const ret = wasm.ops_b455_epoch_slot_dispatch_666();
        this.__wbg_ptr = ret >>> 0;
        ChannelFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {any[]} args
     * @returns {string}
     */
    begin(args) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.ops_ae01_claim_cursor_dispatch_372(-16);
            const ptr0 = passArrayJsValueToWasm0(args, wasm.ops_3e3b_router_scope_dispatch_e9e);
            const len0 = WASM_VECTOR_LEN;
            wasm.ops_0790_frame_router_dispatch_fd2(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.ops_ae01_claim_cursor_dispatch_372(16);
            wasm.ops_d4a8_bundle_handle_dispatch_a6b(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {string} method
     * @param {string} request
     * @param {string} data
     * @returns {string}
     */
    exchange(method, request, data) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.ops_ae01_claim_cursor_dispatch_372(-16);
            const ptr0 = passStringToWasm0(method, wasm.ops_3e3b_router_scope_dispatch_e9e, wasm.ops_7a5e_session_frame_dispatch_951);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(request, wasm.ops_3e3b_router_scope_dispatch_e9e, wasm.ops_7a5e_session_frame_dispatch_951);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(data, wasm.ops_3e3b_router_scope_dispatch_e9e, wasm.ops_7a5e_session_frame_dispatch_951);
            const len2 = WASM_VECTOR_LEN;
            wasm.ops_194c_token_stream_dispatch_8eb(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.ops_ae01_claim_cursor_dispatch_372(16);
            wasm.ops_d4a8_bundle_handle_dispatch_a6b(deferred5_0, deferred5_1, 1);
        }
    }
}
if (Symbol.dispose) Channel.prototype[Symbol.dispose] = Channel.prototype.free;

exports.Channel = Channel;

exports.__wbg_String_20af51921102d310 = function() { return handleError(function (arg0, arg1) {
    const ret = String(getObject(arg1));
    const ptr1 = passStringToWasm0(ret, wasm.ops_3e3b_router_scope_dispatch_e9e, wasm.ops_7a5e_session_frame_dispatch_951);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments) };

exports.__wbg_functionSource_274b4108b04fd0d9 = function() { return handleError(function (arg0, arg1) {
    const ret = functionSource(getObject(arg1));
    const ptr1 = passStringToWasm0(ret, wasm.ops_3e3b_router_scope_dispatch_e9e, wasm.ops_7a5e_session_frame_dispatch_951);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments) };

exports.__wbg_getPrototypeOf_94b87668bc49416b = function() { return handleError(function (arg0) {
    const ret = Object.getPrototypeOf(getObject(arg0));
    return addHeapObject(ret);
}, arguments) };

exports.__wbg_get_225a1050d3045606 = function() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(getObject(arg0), getObject(arg1));
    return addHeapObject(ret);
}, arguments) };

exports.__wbg_get_baca40458815338f = function() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(getObject(arg0), getObject(arg1));
    return addHeapObject(ret);
}, arguments) };

exports.__wbg_ownKeys_403962ad5ad90ff0 = function() { return handleError(function (arg0, arg1) {
    const ret = Reflect.ownKeys(getObject(arg1));
    const ptr1 = passArrayJsValueToWasm0(ret, wasm.ops_3e3b_router_scope_dispatch_e9e);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments) };

exports.__wbg_parse_bb36544c0786706d = function() { return handleError(function (arg0, arg1) {
    const ret = JSON.parse(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
}, arguments) };

exports.__wbg_prepareRequest_f783e7282fe1a886 = function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
    const ret = prepareRequest(getStringFromWasm0(arg1, arg2), getObject(arg3), getStringFromWasm0(arg4, arg5));
    const ptr1 = passStringToWasm0(ret, wasm.ops_3e3b_router_scope_dispatch_e9e, wasm.ops_7a5e_session_frame_dispatch_951);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments) };

exports.__wbg_randomBytes_84a9b6d49aa47663 = function(arg0, arg1) {
    const ret = randomBytes(arg1 >>> 0);
    const ptr1 = passArray8ToWasm0(ret, wasm.ops_3e3b_router_scope_dispatch_e9e);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
};

exports.__wbg_set_4ac27c2f5a451c3a = function() { return handleError(function (arg0, arg1, arg2) {
    const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
    return ret;
}, arguments) };

exports.__wbg_wbindgenisfunction_8cee7dce3725ae74 = function(arg0) {
    const ret = typeof(getObject(arg0)) === 'function';
    return ret;
};

exports.__wbg_wbindgenisnull_f3037694abe4d97a = function(arg0) {
    const ret = getObject(arg0) === null;
    return ret;
};

exports.__wbg_wbindgenisobject_307a53c6bd97fbf8 = function(arg0) {
    const val = getObject(arg0);
    const ret = typeof(val) === 'object' && val !== null;
    return ret;
};

exports.__wbg_wbindgenisundefined_c4b71d073b92f3c5 = function(arg0) {
    const ret = getObject(arg0) === undefined;
    return ret;
};

exports.__wbg_wbindgenjsvaleq_e6f2ad59ccae1b58 = function(arg0, arg1) {
    const ret = getObject(arg0) === getObject(arg1);
    return ret;
};

exports.__wbg_wbindgennumberget_f74b4c7525ac05cb = function(arg0, arg1) {
    const obj = getObject(arg1);
    const ret = typeof(obj) === 'number' ? obj : undefined;
    getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
};

exports.__wbg_wbindgenstringget_0f16a6ddddef376f = function(arg0, arg1) {
    const obj = getObject(arg1);
    const ret = typeof(obj) === 'string' ? obj : undefined;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.ops_3e3b_router_scope_dispatch_e9e, wasm.ops_7a5e_session_frame_dispatch_951);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
};

exports.__wbg_wbindgenthrow_451ec1a8469d7eb6 = function(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
};

exports.__wbg_wbindgentypeof_1f52ea6c1d1d7e17 = function(arg0) {
    const ret = typeof getObject(arg0);
    return addHeapObject(ret);
};

exports.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return addHeapObject(ret);
};

exports.__wbindgen_object_clone_ref = function(arg0) {
    const ret = getObject(arg0);
    return addHeapObject(ret);
};

exports.__wbindgen_object_drop_ref = function(arg0) {
    takeObject(arg0);
};

const wasmModule = (() => {
    const wasmPath = `${__dirname}/sign_wasm_core_bg.wasm.br`;
    let bytes = require('node:zlib').brotliDecompressSync(require('node:fs').readFileSync(wasmPath));
    try { return new WebAssembly.Module(bytes); }
    finally {
        const backing = bytes.buffer;
        bytes.fill(0);
        if (bytes.byteOffset === 0 && bytes.byteLength === backing.byteLength && typeof backing.transfer === 'function') {
            try { backing.transfer(0); } catch {}
        }
        bytes = null;
    }
})();
const wasm = exports.__wasm = new WebAssembly.Instance(wasmModule, imports).exports;


wasm.ops_dfc7_scope_metric_dispatch_0ec();
