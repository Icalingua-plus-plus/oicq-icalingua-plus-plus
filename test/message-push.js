"use strict";

const assert = require("assert");
const pb = require("../lib/algo/pb");
const { groupMsgListener, NTMsgListener, infoSyncPushListener } = require("../lib/onlinepush");
const { parseC2CMsg } = require("../lib/message/parser");
const { getOneMsg } = require("../lib/message/chat");
const { genGroupMessageId, genC2CMessageId } = require("../lib/common");

function client() {
    const events = [];
    return {
        events,
        uin: 10001,
        sync_finished: true,
        config: { brief: true },
        stat: { recv_msg_cnt: 0 },
        fl: new Map([[10001, { nickname: "self" }], [10002, { nickname: "sender" }]]),
        gl: new Map([[20001, { group_name: "group" }]]),
        gml: new Map(),
        uid2uin_map: new Map(),
        uin2uid_map: new Map(),
        logger: { info() {}, debug() {}, warn() {} },
        msgExists() {},
        getGroupInfo() {},
        async getGroupMemberInfo() { return {}; },
        emit(name, data) { events.push([name, data]); },
        em(name, data) { events.push([name, data]); },
    };
}

function body(text, random = 81) {
    return { 1: { 1: { 2: 100, 3: random, 9: "font" }, 2: { 1: { 1: text } } } };
}

function encodePacket(packet) {
    return Buffer.from(pb.encode(packet));
}

function groupPacket(nt, text, seq, index, count) {
    const group = { 1: 20001, 4: "card" };
    return nt ? {
        1: { 1: 10002, 2: "u_sender", 4: 12, 8: group },
        2: { 1: 82, 5: seq, 6: 100, 7: count, 8: index, 9: 42 },
        3: body(text),
    } : {
        1: { 1: 10002, 5: seq, 6: 100, 9: group, 11: 12 },
        2: { 1: count, 2: index, 3: 42 },
        3: body(text),
    };
}

describe("message push", () => {
    for (const nt of [false, true]) {
        it(`reassembles ${nt ? "NT" : "legacy"} group fragments in order`, async () => {
            const c = client();
            const listener = nt ? NTMsgListener : groupMsgListener;
            await listener.call(c, encodePacket({ 1: groupPacket(nt, "lo", 31, 1, 2) }));
            assert.deepStrictEqual(c.events, []);
            await listener.call(c, encodePacket({ 1: groupPacket(nt, "hel", 30, 0, 2) }));
            const id = genGroupMessageId(20001, 10002, 30, 81, 100, 2);
            assert.deepStrictEqual(c.events[0], ["interval.20001.81", id]);
            const [event, data] = c.events[1];
            assert.strictEqual(event, "message.group.normal");
            assert.strictEqual(data.message_id, id);
            assert.strictEqual(data.raw_message, "hello");
            assert.strictEqual(data.sender.card, "card");
            assert.strictEqual(data.sender.subid, 12);
            assert.strictEqual(c.stat.recv_msg_cnt, 1);
            assert.strictEqual(c.uid2uin_map.get("u_sender"), nt ? 10002 : undefined);
        });

        it(`reassembles a ${nt ? "NT" : "legacy"} group message with an omitted first index without emitting a send receipt`, async () => {
            const c = client();
            const listener = nt ? NTMsgListener : groupMsgListener;
            await listener.call(c, encodePacket({ 1: groupPacket(nt, "hel", 30, undefined, 2) }));
            assert.deepStrictEqual(c.events, []);
            await listener.call(c, encodePacket({ 1: groupPacket(nt, "lo", 31, 1, 2) }));
            assert.strictEqual(c.events.length, 1);
            assert.strictEqual(c.events[0][0], "message.group.normal");
            assert.strictEqual(c.events[0][1].raw_message, "hello");
        });
    }

    it("keeps the legacy group event ID and font from the packet that completes reassembly", async () => {
        const c = client();
        const first = groupPacket(false, "hel", 30, 0, 2);
        const last = groupPacket(false, "lo", 31, 1, 2);
        last[3][1][1][9] = "last font";
        await groupMsgListener.call(c, encodePacket({ 1: first }));
        assert.deepStrictEqual(c.events, [
            ["interval.20001.81", genGroupMessageId(20001, 10002, 30, 81, 100, 2)],
        ]);
        await groupMsgListener.call(c, encodePacket({ 1: last }));
        const [event, data] = c.events[1];
        assert.strictEqual(event, "message.group.normal");
        assert.strictEqual(data.message_id, genGroupMessageId(20001, 10002, 31, 81, 100, 2));
        assert.strictEqual(data.seqid, 30);
        assert.strictEqual(data.font, "last font");
        assert.strictEqual(data.raw_message, "hello");
    });

    it("uses the completing NT group fragment's event ID and rich-text attributes", async () => {
        const c = client();
        const first = groupPacket(true, "hel", 30, 0, 2);
        const last = groupPacket(true, "lo", 31, 1, 2);
        last[3][1][1][9] = "last font";
        await NTMsgListener.call(c, encodePacket({ 1: first }));
        await NTMsgListener.call(c, encodePacket({ 1: last }));
        const [event, data] = c.events[1];
        assert.strictEqual(event, "message.group.normal");
        assert.deepStrictEqual(c.events[0], ["interval.20001.81", genGroupMessageId(20001, 10002, 30, 81, 100, 2)]);
        assert.strictEqual(data.message_id, genGroupMessageId(20001, 10002, 31, 81, 100, 2));
        assert.strictEqual(data.seqid, 30);
        assert.strictEqual(data.font, "last font");
        assert.strictEqual(data.raw_message, "hello");
    });

    it("parses legacy and NT private envelopes into the same event data", async () => {
        const c = client();
        const legacy = pb.decode(encodePacket({
            1: { 1: 10002, 2: 10001, 3: 141, 5: 30, 6: 99, 7: 81, 8: { 4: 20001 } },
            2: { 4: 1 },
            3: body("hello"),
        }));
        const expected = await parseC2CMsg.call(c, legacy);
        await NTMsgListener.call(c, encodePacket({ 1: {
            1: { 1: 10002, 2: "u_sender", 5: 10001, 7: { 4: 20001 } },
            2: { 1: 141, 5: 30, 6: 99, 10: 1, 12: 81 },
            3: body("hello"),
        } }));
        const [event, { reply, ...data }] = c.events[0];
        assert.strictEqual(event, "message.private.group");
        assert.strictEqual(typeof reply, "function");
        assert.deepStrictEqual(data, expected);
        assert.strictEqual(data.auto_reply, true);
        assert.strictEqual(data.sender.group_id, 20001);
        assert.strictEqual(data.message_id, genC2CMessageId(10002, 30, 81, 100, 0));
    });

    it("keeps self-sent NT private fragments in their respective conversations", async () => {
        const c = client();
        async function push(peer, seq, index, text) {
            await NTMsgListener.call(c, encodePacket({ 1: {
                1: { 1: 10001, 2: "u_self", 5: peer },
                2: { 1: 166, 5: seq, 6: 100, 7: 2, 8: index, 9: 42, 12: 81 },
                3: body(text),
            } }));
        }
        await push(10002, 30, 0, "hello ");
        await push(10003, 32, 0, "goodbye ");
        assert.deepStrictEqual(c.events, []);
        await push(10002, 31, 1, "world");
        await push(10003, 33, 1, "world");
        assert.deepStrictEqual(c.events.map(([name, data]) => [name, data.user_id, data.raw_message]), [
            ["sync.message.friend", 10002, "hello world"],
            ["sync.message.friend", 10003, "goodbye world"],
        ]);
    });

    it("loads a single NT private history message by its random value", async () => {
        const c = client();
        c.uin2uid_map.set(10002, "u_sender");
        c.parseEventType = () => ({});
        const commands = [];
        c.sendUni = async command => {
            commands.push(command);
            return encodePacket({ 7: [
                {
                    1: { 1: 10002, 2: "u_sender", 5: 10001 },
                    2: { 1: 166, 5: 30, 6: 100, 12: 81 },
                    3: body("matching history"),
                },
                {
                    1: { 1: 10001, 2: "u_self", 5: 10002 },
                    2: { 1: 166, 5: 31, 6: 100, 12: 82 },
                    3: body("other message"),
                },
            ] });
        };
        const id = genC2CMessageId(10002, 30, 81, 100, 0);
        const result = await getOneMsg.call(c, id);
        assert.deepStrictEqual(commands, ["trpc.msg.register_proxy.RegisterProxy.SsoGetRoamMsg"]);
        assert.strictEqual(result.result, 0);
        assert.strictEqual(result.data.message_id, id);
        assert.strictEqual(result.data.raw_message, "matching history");
        assert.strictEqual(c.uid2uin_map.get("u_self"), 10001);
    });

    it("dispatches already decoded NT group and self-sent private sync messages", async () => {
        const c = client();
        await infoSyncPushListener.call(c, encodePacket({
            3: 2,
            7: { 3: { 6: groupPacket(true, "group sync", 30, 0, 1) } },
            8: { 4: { 8: {
                1: { 1: 10001, 2: "u_self", 5: 10002 },
                2: { 1: 166, 5: 31, 6: 100, 12: 81 },
                3: body("private sync"),
            } } },
        }));
        assert.deepStrictEqual(c.events.map(([name, data]) => [name, data.user_id, data.raw_message]), [
            ["new_tech_sync.group.normal", 10002, "group sync"],
            ["new_tech_sync.private.friend", 10002, "private sync"],
        ]);
        assert.strictEqual(c.stat.recv_msg_cnt, 0);
        assert.strictEqual(c.uin2uid_map.get(10001), "u_self");
    });
});
