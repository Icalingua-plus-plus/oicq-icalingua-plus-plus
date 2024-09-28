/**
 * 聊天记录获取协议
 */
"use strict";
const pb = require("../algo/pb");

const ERROR_MSG_NOT_EXISTS = new Error("msg not exists");
const ERROR_UID_NOT_FOUND = new Error("cannot find uid by uin");
const ERROR_USER_NOT_FOUND = new Error("cannot find user by uin");

/**
 * @this {import("../ref").Client}
 * @param {number} user_id 
 * @param {number} time 
 * @param {number} num 
 * @param {number} random 
 * @returns {Promise<import("../ref").Msg[]>}
 */
async function getC2CMsgs(user_id, time, num, random = 0) {
    const body = pb.encode({
        1: user_id,
        2: time,
        3: random,
        4: num
    });
    const blob = await this.sendUni("MessageSvc.PbGetOneDayRoamMsg", body);
    const o = pb.decode(blob);
    if (o[1] > 0)
        throw ERROR_MSG_NOT_EXISTS;
    return Array.isArray(o[6]) ? o[6] : [o[6]];
}

/**
 * @this {import("../ref").Client}
 * @param {number} user_id 
 * @param {number} time 
 * @param {number} num 
 * @param {number} random 
 * @returns {Promise<import("../ref").Msg[]>}
 */
async function getNTC2CMsgs(user_id, time, num, random = 0) {
    const uid = this.uin2uid_map.get(user_id);
    if (!uid) throw ERROR_UID_NOT_FOUND;
    const body = pb.encode({
        1: uid,
        2: time,
        3: random,
        4: num,
        5: 1
    });
    const blob = await this.sendUni("trpc.msg.register_proxy.RegisterProxy.SsoGetRoamMsg", body);
    const o = pb.decode(blob);
    if (!o[7])
        throw ERROR_MSG_NOT_EXISTS;
    return Array.isArray(o[7]) ? o[7] : [o[7]];
}

/**
 * @this {import("../ref").Client}
 * @param {number} group_id 
 * @param {number} from_seq 
 * @param {number} to_seq 
 * @returns {Promise<import("../ref").Msg[]>}
 */
async function getGroupMsgs(group_id, from_seq, to_seq) {
    const body = pb.encode({
        1: group_id,
        2: from_seq,
        3: to_seq,
        6: 0
    });
    const blob = await this.sendUni("MessageSvc.PbGetGroupMsg", body);
    const o = pb.decode(blob);
    if (o[1] > 0)
        throw ERROR_MSG_NOT_EXISTS;
    return Array.isArray(o[6]) ? o[6] : [o[6]];
}

/**
 * @this {import("../ref").Client}
 * @param {number} group_id 
 * @returns {Promise<number>}
 */
async function getLastSeq(group_id) {
    const body = pb.encode({
        1: this.apk.subid,
        2: {
            1: group_id,
            2: {
                22: 0
            },
        },
    });
    const blob = await this.sendOidb("OidbSvc.0x88d_0", body);
    const o = pb.decode(blob)[4][1][3];
    if (!o)
        throw ERROR_MSG_NOT_EXISTS;
    return o[22];
}

module.exports = {
    getC2CMsgs, getGroupMsgs, getLastSeq, getNTC2CMsgs
};
