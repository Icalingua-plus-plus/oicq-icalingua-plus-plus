"use strict";
const path = require("node:path"),
    { Worker } = require("node:worker_threads");
const { Channel } = require("./pkg/sign_wasm_core.js");
const { prepareRequest, finishResult } = require("./api-format.cjs");
function converted(e) {
    if (e instanceof Error) return e;
    let d;
    try {
        d = JSON.parse(String(e));
    } catch {
        return Error(String(e));
    }
    const T =
        d.kind === "TypeError"
            ? TypeError
            : d.kind === "RangeError"
                ? RangeError
                : Error,
        r = new T(d.message);
    if (d.code) r.code = d.code;
    return r;
}
class SigningSystem {
    #channel;
    #worker;
    #tail = Promise.resolve();
    #pending = new Map();
    #next = 0;
    #fatal = null;
    #closed = false;
    constructor(...args) {
        if (args.some((v) => v !== undefined))
            throw TypeError("no configuration options");
    }
    #start() {
        if (this.#worker) return;
        this.#worker = new Worker(path.join(__dirname, "worker-entry.cjs"), {
            workerData: { root: __dirname },
        });
        this.#worker.on("message", (m) => {
            const p = this.#pending.get(m.id);
            if (!p) return;
            this.#pending.delete(m.id);
            if (!this.#pending.size) this.#worker.unref();
            m.error ? p.reject(converted(m.error)) : p.resolve(m.data);
        });
        const fail = (e) => {
            this.#fatal = converted(e);
            for (const p of this.#pending.values()) p.reject(this.#fatal);
            this.#pending.clear();
        };
        this.#worker.on("error", fail);
        this.#worker.on("exit", (code) => {
            if (!this.#closed) fail(Error("worker exited: " + code));
        });
        this.#worker.unref();
    }
    #send(method, request, data = "") {
        if (this.#fatal) return Promise.reject(this.#fatal);
        this.#start();
        return new Promise((resolve, reject) => {
            const id = ++this.#next;
            this.#pending.set(id, { resolve, reject });
            try {
                this.#worker.ref();
                this.#worker.postMessage({ id, method, request, data });
            } catch (e) {
                this.#pending.delete(id);
                if (!this.#pending.size) this.#worker.unref();
                reject(e);
            }
        });
    }
    #enqueue(fn) {
        const p = this.#tail.then(async () => {
            if (this.#closed) throw Error("system closed");
            if (this.#fatal) throw this.#fatal;
            try {
                return await fn();
            } catch (e) {
                throw converted(e);
            }
        });
        this.#tail = p.catch(() => { });
        return p;
    }
    register(...args) {
        return this.#enqueue(async () => {
            if (!this.#channel) this.#channel = new Channel();
            const packet = JSON.parse(this.#channel.begin(args));
            return finishResult(
                await this.#send("register", packet.request, packet.data),
            );
        });
    }
    #operation(method, args) {
        return this.#enqueue(async () => {
            const request = ["clear", "size", "signVersion"].includes(method)
                ? "{}"
                : prepareRequest(method, args[0], "");
            return finishResult(await this.#send(method, request));
        });
    }
    sign(...args) {
        return this.#operation("sign", args);
    }
    energy(...args) {
        return this.#operation("energy", args);
    }
    unregister(...args) {
        return this.#operation("unregister", args);
    }
    clear(...args) {
        return this.#operation("clear", args);
    }
    get size() {
        return this.#operation("size", []);
    }
    get signVersion() {
        return this.#operation("signVersion", []);
    }
    async close() {
        if (this.#closed) return;
        this.#closed = true;
        this.#fatal = Error("system closed");
        for (const p of this.#pending.values()) p.reject(this.#fatal);
        this.#pending.clear();
        if (this.#worker) await this.#worker.terminate();
        await this.#tail;
        if (this.#channel) this.#channel.free();
    }
}
function createSigningSystem(...args) {
    return new SigningSystem(...args);
}
const defaultSystem = createSigningSystem();
module.exports = {
    SigningSystem,
    createSigningSystem,
    ...Object.fromEntries(
        ["register", "sign", "energy", "unregister", "clear"].map((k) => [
            k,
            defaultSystem[k].bind(defaultSystem),
        ]),
    ),
};
