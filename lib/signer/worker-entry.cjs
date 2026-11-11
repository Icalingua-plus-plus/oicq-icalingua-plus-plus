"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { Channel } = require(workerData.root + "/pkg/sign_wasm_core.js");
const channel = new Channel();
parentPort.on("message", (m) => {
    try {
        const data = channel.exchange(m.method, m.request, m.data || "");
        parentPort.postMessage({ id: m.id, data });
    } catch (e) {
        parentPort.postMessage({ id: m.id, error: String(e) });
    }
});
