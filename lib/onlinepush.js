/**
 * 群消息事件入口
 * 好友事件和群事件(禁言、踢人等)
 */
"use strict";
const pb = require("./algo/pb");
const jce = require("./algo/jce");
const sysmsg = require("./core/sysmsg");
const { parseC2CMsg ,parseGroupMsg, parseDiscussMsg } = require("./message/parser");
const { genC2CMessageId, genGroupMessageId, log, uin2code } = require("./common");
const { updateFL, uid2uin } = require("./core/friendlist");

/**
 * OnlinePush回执
 * @this {import("./ref").Client}
 * @param {number} svrip
 * @param {number} seq
 * @param {Buffer[]} rubbish 
 */
function handleOnlinePush(svrip, seq, rubbish = []) {
    const resp = jce.encodeStruct([
        this.uin, rubbish, svrip & 0xffffffff, null, 0
    ]);
    const extra = {
        req_id: seq,
        service: "OnlinePush",
        method: "SvcRespPushMsg",
    };
    const body = jce.encodeWrapper({ resp }, extra);
    this.writeUni("OnlinePush.RespPush", body);
}

const status_map = {
    1: 11,
    3: 31,
    4: 41,
    5: 50,
    6: 60,
    7: 70,
};

/**
 * @type {({[k: number]: (this: import("./ref").Client, data: import("./ref").Proto, time: number) => void})}
 */
const sub0x27 = {
    80: function (data, time) {
        return; //改个群名称还这么多个推送，屎山
        const o = data[12];
        const group_id = o[3];
        if (!o[4])
            return;
        const group_name = String(o[2][2]);
        try {
            this.gl.get(group_id).group_name = group_name;
        } catch (e) { }
        this.em("notice.group.setting", {
            group_id, time,
            user_id: o[4],
            group_name,
        });
    },
    5: async function (data, time) {
        let user_id = data[14][1];
        let nickname = "";
        if (typeof user_id !== "number") {
            return; //似乎还有老的推送，暂时没必要转换
            if (this.config.useNT) {
                //nt uid
                user_id = await uid2uin.call(this, String(user_id));
            } else {
                return;
            }
        }
        try {
            nickname = this.fl.get(user_id).nickname;
            this.fl.delete(user_id);
        } catch (e) { }
        this.logger.info(`更新了好友列表，删除了好友 ${user_id}(${nickname})`);
        this.em("notice.friend.decrease", {
            user_id, nickname, time
        });
    },
    20: function (data, time) {
        // 20002昵称 20009性别 20031生日 23109农历生日 20019说明 20032地区 24002故乡 27372在线状态
        const user_id = data[8][1];
        let o = data[8][2];
        if (Array.isArray(o)) {
            o = o[0];
        }
        let key, value;
        if (o[1] === 20002) {
            key = "nickname";
            value = String(o[2]);
        } else if (o[1] === 20009) {
            key = "sex";
            value = ["unknown", "male", "female"][o[2].toBuffer()[0]];
        } else if (o[1] === 20031) {
            key = "age";
            value = new Date().getFullYear() - o[2].toBuffer().readUInt16BE();
        } else if (o[1] === 20019) {
            key = "description";
            value = String(o[2]);
        } else if (o[1] === 27372 && user_id === this.uin) {
            const status = o[2].toBuffer()[o[2].toBuffer().length - 1];
            const old_status = this.online_status, new_status = status_map[status] || 11;
            this.online_status = new_status;
            if (old_status !== new_status)
                this.em("sync.status", { old_status, new_status });
            return
        } else {
            return;
        }
        try {
            this.fl.get(user_id)[key] = value;
        } catch (e) { }
        if (user_id === this.uin) {
            this[key] = value;
            this.em("sync.profile", { [key]: value });
        } else {
            const e = { user_id, time };
            e[key] = value;
            this.em("notice.friend.profile", e);
        }
    },
    60: function (data, time) {
        const user_id = data[10][1];
        const sign = String(data[10][2]);
        try {
            this.fl.get(user_id).signature = sign;
        } catch (e) { }
        if (user_id === this.uin) {
            this.signature = sign;
            this.em("sync.profile", { signature: sign });
        } else {
            this.em("notice.friend.profile", {
                user_id, signature: sign, time
            });
        }
    },
    40: function (data, time) {
        try {
            const o = data[9][1], user_id = o[2];
            const remark = String(o[3]);
            // 0好友备注 1群备注
            if (o[1] === 1) {
                this.gl.get(user_id).group_remark = remark;
                this.em("sync.remark", { sub_type: "group", group_id: user_id, remark });
            } else {
                this.fl.get(user_id).remark = remark;
                this.em("sync.remark", { sub_type: "private", user_id, remark });
            }
        } catch (e) { }
    },
    21: function (data, time) {
        if (data[11][1] === 0) {
            this.em("sync.profile", { avatar: true });
        } else if (data[11][1] === 1) {
            this.em("notice.group.setting", {
                group_id: data[11][3], time,
                user_id: data[11][4],
                avatar: true,
            });
        }
    }
};

/**
 * @type {({[k: number]: (this: import("./ref").Client, buf: Buffer, time: number) => void})}
 */
const push528 = {
    0x8A: async function (buf, time) {
        let data = pb.decode(buf)[1];
        if (Array.isArray(data))
            data = data[0];
        let user_id = data[1], operator_id = data[1], flag = 0;
        if (user_id === this.uin) {
            user_id = data[2];
            flag = 1;
        }
        if (this.config.useNT) {
            //nt uid
            user_id = String(user_id), operator_id = String(operator_id);
            user_id = await uid2uin.call(this, user_id);
            operator_id = await uid2uin.call(this, operator_id);
        }
        this.em("notice.friend.recall", {
            user_id, operator_id, message_id: genC2CMessageId(user_id, data[3], data[6], data[5], flag), time
        });
    },
    0x8B: function (buf, time) {
        return push528[0x8A].call(this, buf, time);
    },
    0xB3: async function (buf, time) {
        const data = pb.decode(buf)[2];
        let user_id = data[1], nickname = String(data[5]);
        if (typeof user_id !== "number") {
            return; //似乎还有老的推送，暂时没必要转换
            if (this.config.useNT) {
                //nt uid
                user_id = await uid2uin.call(this, String(user_id));
            } else {
                return;
            }
        }
        this.fl.set(user_id, {
            user_id, nickname,
            sex: "unknown",
            age: 0,
            area: "unknown",
            remark: nickname,
            uid: "",
        });
        this.sl.delete(user_id);
        this.getStrangerInfo(user_id).then(() => {
            this.logger.info(`更新了好友列表，新增了好友 ${user_id}(${nickname})`);
            this.em("notice.friend.increase", {
                user_id, nickname, time
            });
            updateFL.call(this);
        });
    },
    0xD4: function (buf, time) {
        const group_id = pb.decode(buf)[1];
        this.getGroupInfo(group_id, true);
    },
    0x3B: function (buf, time) {
        const data = pb.decode(buf);
        const group_id = data[2];
        this.em("notice.group.setting", {
            group_id, time,
            enable_show_title: data[3] > 0,
        });
    },
    0x27: function (buf, time) {
        let data = pb.decode(buf)[1];
        if (Array.isArray(data))
            data = data[0];
        if (typeof sub0x27[data[2]] === "function")
            sub0x27[data[2]].call(this, data, time);
    },
    0x122: function (buf, time, uin) {
        const data = pb.decode(buf);
        const eve = { time };
        Object.assign(eve, parsePoke.call(this, data));
        eve.user_id = uin;
        this.em("notice.friend.poke", eve);
    },
    0x115: async function (buf, time) {
        const data = pb.decode(buf);
        let user_id = data[1];
        if (typeof user_id !== "number") {
            if (this.config.useNT) {
                //nt uid
                user_id = await uid2uin.call(this, String(user_id));
            } else {
                return;
            }
        }
        const end = data[3][4] === 2;
        this.em("internal.input", { user_id, end });
    },
    0x08: async function (buf, time) {
        if (!this.config.useNT) return;
        const data = pb.decode(buf);
        const events = Array.isArray(data[1]) ? data[1] : [data[1]];
        for (let event of events) {
            const uid = String(event[1] || "");
            if (!uid) continue;
            const timestamp = event[2];
            const user_id = await uid2uin.call(this, uid);
            this.em("sync.readed", {
                sub_type: "private",
                user_id,
                timestamp,
            });
        }
    },
};

function parsePoke(data) {
    let user_id, target_id, operator_id, action, suffix = "", icon = "";
    for (let o of data[7]) {
        const name = String(o[1]), val = String(o[2]);
        switch (name) {
        case "action_str":
        case "alt_str1":
            action = action || val;
            break;
        case "uin_str1":
            operator_id = parseInt(val);
            break;
        case "uin_str2":
            user_id = parseInt(val);
            break;
        case "suffix_str":
            suffix = val;
            break;
        }
    }
    if (!operator_id)
        operator_id = this.uin;
    if (!user_id)
        user_id = this.uin;
    target_id = user_id;
    return { user_id, target_id, operator_id, action, suffix };
}

function parseSign(data) {
    let user_id = this.uin, nickname = "", sign_text = "";
    for (let o of data[7]) {
        const name = String(o[1]), val = String(o[2]);
        switch (name) {
        case "user_sign":
            sign_text = sign_text || val;
            break;
        case "mqq_uin":
            user_id = parseInt(val);
            break;
        case "mqq_nick":
            nickname = val;
            break;
        }
    }
    return { user_id, nickname, sign_text };
}

/**
 * @this {import("./ref").Client}
 * @param {number} group_id 
 * @param {string} field 
 * @param {boolean} enable 
 * @param {number} time 
 */
function onGroupSetting(group_id, field, enable, time) {
    if (!field) return;
    const e = {
        group_id, time
    };
    e[field] = !!enable;
    this.em("notice.group.setting", e);
}

/**
 * @type {({[k: number]: (this: import("./ref").Client, group_id: number, buf: Buffer, time: number) => void})}
 */
const push732 = {
    0x0C: function (group_id, buf, time) {
        const operator_id = buf.readUInt32BE(6);
        const user_id = buf.readUInt32BE(16);
        let duration = buf.readUInt32BE(20);
        try {
            if (user_id === 0) {
                duration = duration ? 0xffffffff : 0;
                this.gl.get(group_id).shutup_time_whole = duration;
            }
            else if (user_id === this.uin)
                this.gl.get(group_id).shutup_time_me = duration ? (time + duration) : 0;
            this.gml.get(group_id).get(user_id).shutup_time = duration ? (time + duration) : 0;
        } catch (e) { }
        this.em("notice.group.ban", {
            group_id, operator_id, user_id, duration, time
        });
    },
    0x11: async function (group_id, buf, time) {
        const data = pb.decode(buf.slice(7))[11];
        let operator_id = data[1];
        const msg = Array.isArray(data[3]) ? data[3][0] : data[3];
        let user_id = msg[6];
        if (this.config.useNT) {
            //nt uid
            await this.getGroupMemberList(group_id);
            user_id = String(user_id), operator_id = String(operator_id);
            user_id = await uid2uin.call(this, user_id);
            operator_id = await uid2uin.call(this, operator_id);
        }
        const message_id = genGroupMessageId(group_id, user_id, msg[1], msg[3], msg[2], Array.isArray(data[3]) ? data[3].length : 1);
        this.em("notice.group.recall", {
            group_id, user_id, operator_id, message_id, time
        });
    },
    0x14: function (group_id, buf, time) {
        const data = pb.decode(buf.slice(7))[26];
        try {
            const eve = { group_id, time };
            Object.assign(eve, parsePoke.call(this, data));
            if (eve.action)
                this.em("notice.group.poke", eve);
        } catch { }
        try {
            const sign = { group_id, time };
            Object.assign(sign, parseSign.call(this, data));
            if (sign.sign_text)
                this.em("notice.group.sign", sign);
        } catch { }
    },
    0x15: function (group_id, buf, time) {
        if (buf[5] !== 0) return;
        const data = pb.decode(buf.slice(7))[33];
        try {
            const seq = data[2];
            const random = data[3];
            const add = data[4] === 1;
            const user_id = data[5];
            const operator_id = data[6];
            const user_name = String(data[10]);
            const operator_name = String(data[9]);
            this.em("notice.group.essence", {
                group_id, seq, random, add, user_id, user_name, operator_id, operator_name, time
            });
        } catch { }
    },
    0x06: function (group_id, buf, time) {
        if (buf[5] !== 1) return;
        onGroupSetting.call(this, group_id, "enable_guest", buf[10] > 0, time);
    },
    0x0E: function (group_id, buf, time) {
        if (buf[5] !== 1) return;
        const duration = buf.readInt32BE(10);
        if (buf[14] === 0)
            onGroupSetting.call(this, group_id, "enable_anonymous", duration === 0, time);
        else {
            const nickname = String(buf.slice(15, 15 + buf[14]));
            const operator_id = buf.readUInt32BE(6);
            this.em("notice.group.ban", {
                group_id, operator_id,
                user_id: 80000000, nickname,
                duration, time
            });
        }
    },
    0x0F: function (group_id, buf, time) {
        if (buf[12] === 1)
            var field = "enable_upload_album";
        else if (buf[12] === 2)
            var field = "enable_upload_file";
        var enable = buf[8] === 0x0 || buf[8] === 0x20;
        onGroupSetting.call(this, group_id, field, enable, time);
    },
    0x10: function (group_id, buf, time) {
        if (buf[6] === 0x22) {
            let field;
            if (buf[buf.length - 2] === 0x08)
                field = "enable_show_honor";
            if (buf[buf.length - 2] === 0x10)
                field = "enable_show_level";
            let enable = buf[buf.length - 1] === 0;
            return onGroupSetting.call(this, group_id, field, enable, time);
        }
        if (buf[6] === 0x26) {
            // 改群分类 <Buffer 44 25 6e 9f 10 00 26 08 18 10 96 8a e3 fa 05 18 ff ff ff ff 0f 20 9f dd 95 a1 04 68 17 a8 01 f5 ef e8 b1 01 f2 01 06 18 8c 04 40 9a 4e>
        }
        const sub = pb.decode(buf.slice(7));
        if (sub[5] && sub[5][2]) {
            let str = String(sub[5][2]);
            if (str.includes("获得群主授予的")) {
                const user_id = sub[5][5];
                str = str.substr(0, str.length - 2);
                let title = str.substr(str.lastIndexOf("获得群主授予的") + 7);
                const _title = title;
                if (title.startsWith("<{") && title.endsWith("}>")) {
                    title = title.substr(1, title.length - 2);
                    try {
                        const parsed = JSON.parse(title);
                        if (parsed.text) {
                            title = parsed.text;
                        }
                    } catch (e) {
                        title = "";
                    }
                }
                if (!title) return;
                str = str.substr(0, str.length - _title.length - 7);
                let nickname = str.substr(2);
                if (nickname.startsWith("<{") && nickname.endsWith("}>")) {
                    nickname = nickname.substr(1, nickname.length - 2);
                    try {
                        const parsed = JSON.parse(nickname);
                        if (parsed.text) {
                            nickname = parsed.text;
                        }
                    } catch (e) {
                        nickname = "";
                    }
                }
                if (!nickname) return;
                try {
                    this.gml.get(group_id).get(user_id).title = title;
                    this.gml.get(group_id).get(user_id).title_expire_time = -1;
                } catch (e) { }
                return this.em("notice.group.title", {
                    group_id, user_id,
                    nickname, title
                });
            }

            let field, enable;
            if (sub[13] === 12) {
                try {
                    this.gl.get(group_id).group_name = str;
                } catch (e) { }
                return this.em("notice.group.setting", {
                    group_id, time,
                    user_id: sub[21],
                    group_name: str,
                });
            } else if (str.includes("坦白说")) {
                field = "enable_confess";
                enable = str.includes("开启");
            } else if (str.includes("临时会话")) {
                field = "enable_temp_chat";
                enable = str.includes("允许");
            } else if (str.includes("新的群聊")) {
                field = "enable_new_group";
                enable = str.includes("允许");
            } else {
                return;
            }
            return onGroupSetting.call(this, group_id, field, enable, time);
        }
    },
    0x01: function (group_id, buf, time) {
        if (!this.config.useNT) return;
        const data = pb.decode(buf);
        this.em("sync.readed", {
            sub_type: "group",
            group_id: data[1],
            seqid: data[4],
        });
    },
};

/**
 * @this {import("./ref").Client}
 */
function onlinePushListener(blob, seq) {
    const nested = jce.decode(blob);
    const list = nested[2];
    const rubbish = [];
    for (let v of list) {
        rubbish.push(jce.encodeNested([
            this.uin, v[1], v[3], v[8], 0, 0, 0, 0, 0, 0, 0
        ]));
        if (!this.sync_finished) continue;
        const time = v[5];
        if (v[2] === 528) {
            const decoded = jce.decodeNested(v[6]);
            const type = decoded[0], buf = decoded[10];
            if (typeof push528[type] === "function")
                push528[type].call(this, buf, time, v[0]);
        }
        if (v[2] === 732) {
            const group_id = v[6].readUInt32BE();
            const type = v[6][4];
            if (typeof push732[type] === "function")
                push732[type].call(this, group_id, v[6], time);
        }
    }
    handleOnlinePush.call(this, nested[3], seq, rubbish);
}

/**
 * @this {import("./ref").Client}
 */
function onlinePushTransListener(blob, seq) {
    const push = pb.decode(blob);
    handleOnlinePush.call(this, push[11], seq);
    if (!this.sync_finished) return;
    const time = push[8];
    const buf = push[10].toBuffer();
    const group_id = buf.readUInt32BE();
    if (push[3] === 44) {
        if (buf[5] === 0 || buf[5] === 1) {
            const user_id = buf.readUInt32BE(6);
            const set = buf[10] > 0;
            (async () => {
                try {
                    (await this.getGroupMemberInfo(group_id, user_id)).data.role = (set ? "admin" : "member");
                } catch (e) { }
                this.em("notice.group.admin", {
                    group_id, user_id, set, time
                });
            })();
        } else if (buf[5] === 0xFF) {
            const operator_id = buf.readUInt32BE(6);
            const user_id = buf.readUInt32BE(10);
            (async () => {
                try {
                    this.gl.get(group_id).owner_id = user_id;
                    (await this.getGroupMemberInfo(group_id, operator_id)).data.role = "member";
                    (await this.getGroupMemberInfo(group_id, user_id)).data.role = "owner";
                } catch (e) { }
                this.em("notice.group.transfer", {
                    group_id, operator_id, user_id, time
                });
            })();
        }
    }
    if (push[3] === 34) {

        const user_id = buf.readUInt32BE(5);
        let operator_id, dismiss = false, member, group;
        try {
            member = this.gml.get(group_id).get(user_id);
        } catch { }
        if (buf[9] === 0x82 || buf[9] === 0x2) {
            operator_id = user_id;
            try {
                this.gml.get(group_id).delete(user_id);
            } catch { }
        } else {
            operator_id = buf.readUInt32BE(10);
            if (buf[9] === 0x01 || buf[9] === 0x81)
                dismiss = true;
            if (user_id === this.uin) {
                group = this.gl.get(group_id);
                this.gl.delete(group_id);
                this.gml.delete(group_id);
                this.logger.info(`更新了群列表，删除了群：${group_id}`);
            } else {
                try {
                    this.gml.get(group_id).delete(user_id);
                } catch { }
                this.logger.info(`${user_id}离开了群${group_id}`);
            }
        }
        try {
            this.gl.get(group_id).member_count--;
        } catch { }
        this.em("notice.group.decrease", {
            group_id, user_id, operator_id, dismiss, member, group, time
        });
    }
}

/**
 * @this {import("./ref").Client}
 */
async function c2cMsgSyncListener(blob, seq) {
    const proto = pb.decode(blob);
    handleOnlinePush.call(this, proto[2], seq);
    try {
        const data = await parseC2CMsg.call(this, proto[1], true);
        data.user_id = proto[1][1][2];
        this.em("sync.message." + data.sub_type, data);
    } catch (e) {
        this.logger.debug(e);
    }
}

/**
 * @this {import("./ref").Client}
 */
async function groupMsgListener(blob, seq) {
    if (!this.sync_finished)
        return;
    try {
        /**
         * @type {import("./ref").Msg}
         */
        let msg = pb.decode(blob)[1];

        //生成消息id
        const head = msg[1], content = msg[2], body = msg[3];
        if (head[9][2] === 127) return;
        const user_id = head[1], time = head[6], seq = head[5];
        const group_id = head[9][1], random = body[1][1][3];
        const message_id = genGroupMessageId(group_id, user_id, seq, random, time, content[1]);

        if (content[1] > 1) {
            //重组分片消息
            if (content[2] === 0)
                this.emit(`interval.${group_id}.${body[1][1][3]}`, message_id);
            msg = rebuildFragments(msg);
            if (!msg)
                return;
        } else {
            //非分片消息
            this.emit(`interval.${group_id}.${body[1][1][3]}`, message_id);
        }

        ++this.stat.recv_msg_cnt;

        //解析消息
        const data = await parseGroupMsg.call(this, msg, true);
        if (data && data.raw_message) {
            if (data.user_id === this.uin && this.config.ignore_self)
                return;
            data.reply = (message, auto_escape = false) => this.sendGroupMsg(data.group_id, message, auto_escape);
            data.message_id = message_id;
            const sender = data.sender;
            this.logger.info(`recv from: [Group: ${data.group_name}(${data.group_id}), Member: ${sender.card ? sender.card : sender.nickname}(${data.user_id})] ` + data.raw_message);
            this.em("message.group." + data.sub_type, data);
        }
    } catch (e) {
        // this.logger.debug(e);
    }
}

/**
 * @this {import("./ref").Client}
 */
async function discussMsgListener(blob, seq) {
    ++this.stat.recv_msg_cnt;
    const o = pb.decode(blob);
    handleOnlinePush.call(this, o[2], seq);
    if (!this.sync_finished)
        return;
    try {
        const data = await parseDiscussMsg.call(this, o[1]);
        if (data && data.raw_message) {
            if (data.user_id === this.uin && this.config.ignore_self)
                return;
            data.reply = (message, auto_escape = false) => this.sendDiscussMsg(data.discuss_id, message, auto_escape);
            const sender = data.sender;
            this.logger.info(`recv from: [Discuss: ${data.discuss_name}(${data.discuss_id}), Member: ${sender.card}(${data.user_id})] ` + data.raw_message);
            this.em("message.discuss", data);
        }
    } catch (e) {
        this.logger.debug(e);
    }
}

const FRAG = new Map;

/**
 * Fuck Tencent
 * 1.是最后一个分片，返回组装好的消息
 * 2.不是最后一个分片，返回空
 * @param {import("./ref").Msg} msg 
 * @returns {import("./ref").Msg}
 */
function rebuildFragments(msg) {
    const head = msg[1], content = msg[2], body = msg[3];
    const cnt = content[1], index = content[2], div = content[3];
    const id = head[1] + "-" + head[2] + "-" + div;
    if (!FRAG.has(id)) {
        FRAG.set(id, {3: new Array(cnt)});
        setTimeout(() => {
            FRAG.delete(id);
        }, 5000);
    }
    const comb = FRAG.get(id);
    comb[3][index] = body;
    if (index === 0) {
        comb[1] = head;
        comb[2] = content;
    }
    if (!comb[3].includes(undefined)) {
        const new_body = {
            1: {
                1: body[1][1],
                2: []
            }
        };
        for (let v of comb[3]) {
            if (v[1][2])
                new_body[1][2].push(v[1][2]);
        }
        new_body[1][2] = new_body[1][2].flat();
        comb[3] = new_body;
        FRAG.delete(id);
        return comb;
    }
}

/**
 * @this {import("./ref").Client}
 */
async function NTMsgListener(blob, seq) {
    const o = pb.decode(blob);
    const type = o[1][2] ? o[1][2][1] : 114514;
    //this.logger.debug("NT message type", type);
    switch (type) {
        case 82: //群聊消息
            if (!this.sync_finished) return;
            try {
                const msg = groupNTMsgConverter.call(this, o[1]);
                //生成消息id
                const head = msg[1], content = msg[2], body = msg[3];
                if (head[9][2] === 127) return;
                const user_id = head[1], time = head[6], seq = head[5];
                const group_id = head[9][1], random = body[1][1][3];
                const message_id = genGroupMessageId(group_id, user_id, seq, random, time, content[1]);
                //懒得搞分片消息了
                this.emit(`interval.${group_id}.${body[1][1][3]}`, message_id);
                ++this.stat.recv_msg_cnt;
                //解析消息
                const data = await parseGroupMsg.call(this, msg, true);
                if (data && data.raw_message) {
                    if (data.user_id === this.uin && this.config.ignore_self)
                        return;
                    data.reply = (message, auto_escape = false) => this.sendGroupMsg(data.group_id, message, auto_escape);
                    data.message_id = message_id;
                    const sender = data.sender;
                    this.logger.info(`recv from: [Group: ${data.group_name}(${data.group_id}), Member: ${sender.card ? sender.card : sender.nickname}(${data.user_id})] ` + data.raw_message);
                    this.em("message.group." + data.sub_type, data);
                }
            } catch (e) {
                // this.logger.debug(e);
            }
            break;
        case 33: //群员入群
        case 38: //建群
        case 85: //群申请被同意
            break;
        case 141: //陌生人
        case 166: //好友
        case 167: //单向好友
        case 208: //好友语音
        case 529: //离线文件
            ++this.stat.recv_msg_cnt;
            if (!this.sync_finished) return;
            try {
                const msg = c2cNTMsgConverter.call(this, o[1]);
                const data = await parseC2CMsg.call(this, msg, true);
                if (data.user_id === this.uin) {
                    data.user_id = msg[1][2];
                    this.em("sync.message." + data.sub_type, data);
                } else {
                    if (data && data.raw_message) {
                        data.reply = (message, auto_escape = false) => this.sendPrivateMsg(data.user_id, message, auto_escape);
                        this.logger.info(`recv from: [Private: ${data.user_id}(${data.sub_type})] ` + data.raw_message);
                        this.em("message.private." + data.sub_type, data);
                    }
                }
            } catch (e) {
                this.logger.debug(e);
            }
            break;
        case 84: //群请求
        case 87: //群邀请
        case 525: //群请求(来自群员的邀请)
            if (!this.sync_finished) return;
            return sysmsg.getNewGroup.call(this);
        case 187: //好友请求
        case 191: //单向好友增加
            if (!this.sync_finished) return;
            return sysmsg.getNewFriend.call(this);
        case 528: //push528
            try {
                const type = o[1][2][3], buf = o[1][3][2].toBuffer(), time = o[1][2][6];
                if (!this.sync_finished) throw new Error("sync not finished");
                if (typeof push528[type] === "function")
                    push528[type].call(this, buf, time, o[1][1][1]);
            } catch (e) {
                this.logger.debug(e);
            }
            if (o[4]) {
                this.writeUni("trpc.msg.olpush.OlPushService.SsoPushAck", pb.encode({
                    1: o[4],
                }));
            }
            break;
        case 732: //push732
            try {
                const group_uin = o[1][1][1];
                const group_id = uin2code(group_uin);
                const type = o[1][2][3], buf = o[1][3][2].toBuffer(), time = o[1][2][6];
                const no_parse = [0x0C, 0x10]; //这些也会推送jce的老包，就不管其只有uid的nt推送了
                if (no_parse.includes(type)) break;
                if (!this.sync_finished) throw new Error("sync not finished");
                if (typeof push732[type] === "function")
                    push732[type].call(this, group_id, buf, time);
            } catch (e) {
                this.logger.debug(e);
            }
            if (o[4]) {
                this.writeUni("trpc.msg.olpush.OlPushService.SsoPushAck", pb.encode({
                    1: o[4],
                }));
            }
            break;
        case 114514: // 1919810
            // 部分消息没有content
            break;
        default:
            this.logger.warn("Unknown NT message type", type);
            break;
    }
}

/**
 * @this {import("./ref").Client}
 */
function groupNTMsgConverter(msg) {
    const headerNT = msg[1], contentNT = msg[2], bodyNT = msg[3];
    const header = pb.decode(headerNT.toBuffer()), content = pb.decode(contentNT.toBuffer()), body = pb.decode(bodyNT.toBuffer());

    const uin = headerNT[1], uid = String(headerNT[2] || "");
    if (uin && uid && !this.uin2uid_map.has(uin)) {
        this.uid2uin_map.set(uid, uin);
        this.uin2uid_map.set(uin, uid);
    }

    header[9] = headerNT[8];
    header[6] = contentNT[6];
    header[5] = contentNT[5];
    header[11] = headerNT[4];

    content[1] = contentNT[7];

    return {
        1: header,
        2: content,
        3: body,
    };
}

/**
 * @this {import("./ref").Client}
 */
function c2cNTMsgConverter(msg) {
    const headerNT = msg[1], contentNT = msg[2], bodyNT = msg[3];
    const header = pb.decode(headerNT.toBuffer()), content = pb.decode(contentNT.toBuffer()), body = pb.decode(bodyNT.toBuffer());

    const uin = headerNT[1], uid = String(headerNT[2] || "");
    if (uin && uid && !this.uin2uid_map.has(uin)) {
        this.uid2uin_map.set(uid, uin);
        this.uin2uid_map.set(uin, uid);
    }

    header[2] = headerNT[5];
    header[3] = contentNT[1];
    header[4] = contentNT[3];
    header[5] = contentNT[5];
    header[6] = contentNT[6];
    header[7] = contentNT[12];

    return {
        1: header,
        2: {
            4: contentNT[10], //auto_reply
        },
        3: body,
    };
}

/**
 * @this {import("./ref").Client}
 */
async function infoSyncPushListener(blob, seq) {
    const o = pb.decode(blob);
    const type = o[3];
    switch (type) {
        case 2:
            try {
                const group_message_sync = o[7]; //群消息
                if (group_message_sync && group_message_sync[3]) {
                    const groups = Array.isArray(group_message_sync[3]) ? group_message_sync[3] : [group_message_sync[3]];
                    for (let group of groups) {
                        const group_id = group[3];
                        const from_seq = group[4];
                        const to_seq = group[5];
                        const msgs = Array.isArray(group[6]) ? group[6] : [group[6]];
                        for (let i = msgs.length - 1; i >= 0; i--) {
                            const msg = msgs[i];
                            await NTMsgSync.call(this, Buffer.from(pb.encode({ 1: msg })), seq);
                        }
                    }
                }
                const olpush_sync = o[8]; //push732 push528 私聊消息
                if (olpush_sync && olpush_sync[4]) {
                    const olpushs_groups = Array.isArray(olpush_sync[4]) ? olpush_sync[4] : [olpush_sync[4]];
                    for (let groups of olpushs_groups) {
                        const olpushs = Array.isArray(groups[8]) ? groups[8] : [groups[8]];
                        for (let i = olpushs.length - 1; i >= 0; i--) {
                            const olpush = olpushs[i];
                            await NTMsgSync.call(this, Buffer.from(pb.encode({ 1: olpush })), seq);
                        }
                    }
                }
                const guild_sync = o[9]; //频道，用不上
            } catch (e) {
                this.logger.warn("NT同步消息失败");
                this.logger.debug(e);
            }
            break;
        case 5:
            //群消息列表同步
            try {
                const list = Array.isArray(o[6]) ? o[6] : [o[6]];
                const chats = [];
                for (let chat of list) {
                    chats.push({
                        group_id: chat[1],
                        group_name: String(chat[9]),
                        unread_count: chat[2] - chat[3] - 1,
                        last_seq: chat[2],
                        last_unread_seq: chat[3],
                    })
                }
                this.em("new_tech_sync.group_list", chats);
            } catch (e) {
                this.logger.warn("群消息列表同步失败");
                this.logger.debug(e);
            }
            break;
        default:
            break;
    }
}

/**
 * @this {import("./ref").Client}
 */
async function NTMsgSync(blob, seq) {
    const o = pb.decode(blob);
    const type = o[1][2][1];
    this.logger.debug("NT message type", type);
    switch (type) {
        case 82: //群聊消息
            try {
                const msg = groupNTMsgConverter.call(this, o[1]);
                //生成消息id
                const head = msg[1], content = msg[2], body = msg[3];
                if (head[9][2] === 127) return;
                const user_id = head[1], time = head[6], seq = head[5];
                const group_id = head[9][1], random = body[1][1][3];
                const message_id = genGroupMessageId(group_id, user_id, seq, random, time, content[1]);
                //懒得搞分片消息了
                //解析消息
                const data = await parseGroupMsg.call(this, msg, true);
                if (data && data.raw_message) {
                    if (data.user_id === this.uin && this.config.ignore_self)
                        return;
                    data.reply = (message, auto_escape = false) => this.sendGroupMsg(data.group_id, message, auto_escape);
                    data.message_id = message_id;
                    const sender = data.sender;
                    this.logger.info(`nt sync message: [Group: ${data.group_name}(${data.group_id}), Member: ${sender.card ? sender.card : sender.nickname}(${data.user_id})] ` + data.raw_message);
                    this.em("new_tech_sync.group." + data.sub_type, data);
                }
            } catch (e) {
                // this.logger.debug(e);
            }
            break;
        case 141: //陌生人
        case 166: //好友
        case 167: //单向好友
        case 208: //好友语音
        case 529: //离线文件
            try {
                const msg = c2cNTMsgConverter.call(this, o[1]);
                const data = await parseC2CMsg.call(this, msg, true);
                if (data.user_id === this.uin) {
                    data.user_id = msg[1][2];
                    this.em("new_tech_sync.private." + data.sub_type, data);
                } else {
                    if (data && data.raw_message) {
                        data.reply = (message, auto_escape = false) => this.sendPrivateMsg(data.user_id, message, auto_escape);
                        this.logger.info(`nt sync message: [Private: ${data.user_id}(${data.sub_type})] ` + data.raw_message);
                        this.em("new_tech_sync.private." + data.sub_type, data);
                    }
                }
            } catch (e) {
                this.logger.debug(e);
            }
            break;
        default:
            break;
    }
}

module.exports = {
    onlinePushListener, onlinePushTransListener, c2cMsgSyncListener, groupMsgListener, discussMsgListener,
    NTMsgListener, infoSyncPushListener, c2cNTMsgConverter, groupNTMsgConverter,
};
