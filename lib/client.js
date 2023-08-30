/**
 * api
 */
"use strict";
const version = require("../package.json");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { randomBytes } = require("crypto");
const log4js = require("log4js");
const Network = require("./client-net");
const { getApkInfo, getDeviceInfo } = require("./device");
const { timestamp, md5, BUF0 } = require("./common");
const { onlineListener, offlineListener, packetListener, networkErrorListener } = require("./oicq");
const frdlst = require("./core/friendlist");
const sysmsg = require("./core/sysmsg");
const troop = require("./core/troop");
const nessy = require("./core/nessy");
const { WtLogin } = require("./wtlogin/wt");
const chat = require("./message/chat");
const multi = require("./message/multi");
const { Gfs } = require("./message/file");
const { getErrorMessage, TimeoutError } = require("./exception");

function buildApiRet(retcode, data = null, error = null) {
    data = data ? data : null;
    error = error ? error : null;
    const status = retcode ? (retcode === 1 ? "async" : "failed") : "ok";
    return {
        retcode, data, status, error
    };
}

const platforms = {
    1: "Android",
    2: "aPad",
    3: "Watch",
    4: "MacOS",
    5: "iPad",
    6: "Android_FIX",
    7: "Android_8933",
    8: "aPad_8933",
    9: "iPad_8933",
    10: "TIM_3.5.1",
    11: "Android_8958",
    12: "aPad_8958",
    13: "Android_8963",
    14: "aPad_8963",
    15: "Android_8968",
    16: "aPad_8968",
    17: "Android_8970",
    18: "aPad_8970",
    19: "Android_8973",
    20: "aPad_8973",
    21: "Android_8975",
    22: "aPad_8975",
};

/** 客户端已上线状态 */
const STATUS_ONLINE = Symbol("ONLINE");
/** socket未连接状态 */
const STATUS_OFFLINE = Symbol("OFFLINE");
/** socket已连接，但客户端未上线状态 */
const STATUS_PENDING = Symbol("PENDING");

class Client extends EventEmitter {

    status = STATUS_OFFLINE;
    online_status = 0;
    nickname = "";
    age = 0;
    sex = "unknown";
    needSignCmd = [
        "ConnAuthSvr.fast_qq_login",
        "ConnAuthSvr.sdk_auth_api",
        "ConnAuthSvr.sdk_auth_api_emp",
        "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoBarrage",
        "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoComment",
        "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoFollow",
        "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoLike",
        "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoPush",
        "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoReply",
        "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.PublishFeed",
        "FeedCloudSvr.trpc.videocircle.circleprofile.CircleProfile.SetProfile",
        "friendlist.addFriend",
        "friendlist.AddFriendReq",
        "friendlist.ModifyGroupInfoReq",
        "MessageSvc.PbSendMsg",
        "MsgProxy.SendMsg",
        "OidbSvc.0x4ff_9",
        "OidbSvc.0x4ff_9_IMCore",
        "OidbSvc.0x56c_6",
        "OidbSvc.0x6d9_4",
        "OidbSvc.0x758",
        "OidbSvc.0x758_0",
        "OidbSvc.0x758_1",
        //"OidbSvc.0x88d_0",
        "OidbSvc.0x89a_0",
        "OidbSvc.0x89b_1",
        "OidbSvc.0x8a1_0",
        "OidbSvc.0x8a1_7",
        "OidbSvc.0x8ba",
        "OidbSvc.0x9fa",
        "OidbSvc.oidb_0x758",
        "OidbSvcTrpcTcp.0x101e_1",
        "OidbSvcTrpcTcp.0x101e_2",
        "OidbSvcTrpcTcp.0x1100_1",
        "OidbSvcTrpcTcp.0x1105_1",
        "OidbSvcTrpcTcp.0x1107_1",
        "OidbSvcTrpcTcp.0x55f_0",
        "OidbSvcTrpcTcp.0x6d9_4",
        "OidbSvcTrpcTcp.0xf55_1",
        "OidbSvcTrpcTcp.0xf57_1",
        "OidbSvcTrpcTcp.0xf57_106",
        "OidbSvcTrpcTcp.0xf57_9",
        "OidbSvcTrpcTcp.0xf65_1",
        "OidbSvcTrpcTcp.0xf65_10",
        "OidbSvcTrpcTcp.0xf67_1",
        "OidbSvcTrpcTcp.0xf67_5",
        "OidbSvcTrpcTcp.0xf6e_1",
        "OidbSvcTrpcTcp.0xf88_1",
        "OidbSvcTrpcTcp.0xf89_1",
        "OidbSvcTrpcTcp.0xfa5_1",
        "ProfileService.getGroupInfoReq",
        "ProfileService.GroupMngReq",
        "QChannelSvr.trpc.qchannel.commwriter.ComWriter.DoComment",
        "QChannelSvr.trpc.qchannel.commwriter.ComWriter.DoReply",
        "QChannelSvr.trpc.qchannel.commwriter.ComWriter.PublishFeed",
        "SQQzoneSvc.addComment",
        "SQQzoneSvc.addReply",
        "SQQzoneSvc.forward",
        "SQQzoneSvc.like",
        "SQQzoneSvc.publishmood",
        "SQQzoneSvc.shuoshuo",
        "trpc.group_pro.msgproxy.sendmsg",
        "trpc.login.ecdh.EcdhService.SsoNTLoginPasswordLoginUnusualDevice",
        "trpc.o3.ecdh_access.EcdhAccess.SsoEstablishShareKey",
        "trpc.o3.ecdh_access.EcdhAccess.SsoSecureA2Access",
        "trpc.o3.ecdh_access.EcdhAccess.SsoSecureA2Establish",
        "trpc.o3.ecdh_access.EcdhAccess.SsoSecureAccess",
        "trpc.o3.report.Report.SsoReport",
        "trpc.passwd.manager.PasswdManager.SetPasswd",
        "trpc.passwd.manager.PasswdManager.VerifyPasswd",
        "trpc.qlive.relationchain_svr.RelationchainSvr.Follow",
        "trpc.qlive.word_svr.WordSvr.NewPublicChat",
        "trpc.qqhb.qqhb_proxy.Handler.sso_handle",
        "trpc.springfestival.redpacket.LuckyBag.SsoSubmitGrade",
        "wtlogin.device_lock",
        "wtlogin.exchange_emp",
        "wtlogin.login",
        "wtlogin.name2uin",
        "wtlogin.qrlogin",
        "wtlogin.register",
        "wtlogin.trans_emp",
        "wtlogin_device.login",
        "wtlogin_device.tran_sim_emp",
    ];

    fl = new Map; //friendList
    sl = new Map; //strangerList
    gl = new Map; //groupList
    gml = new Map; //groupMemberList

    seq_id = 1145 + Math.round(Math.random() * 1419);
    handlers = new Map; //存放响应包的回调
    seq_cache = new Map; //一分钟内的缓存

    sig = {
        srm_token: BUF0,
        tgt: BUF0,
        tgt_key: BUF0,
        st_key: BUF0,
        st_web_sig: BUF0,
        t103: BUF0,
        t543: BUF0,
        t547: BUF0,
        skey: BUF0,
        d2: BUF0,
        d2key: BUF0,
        sig_key: BUF0,
        ticket_key: BUF0,
        device_token: BUF0,
        emp_time: timestamp(),
        time_diff: 0,
        _ksid: BUF0,
        qsign_token_time: 0,
    };
    _cookies = { };

    sync_finished = false;
    sync_cookie;
    const1 = randomBytes(4).readUInt32BE();
    const2 = randomBytes(4).readUInt32BE();
    const3 = randomBytes(1)[0];

    _stat = {
        start_time: timestamp(),
        lost_times: 0,
        recv_pkt_cnt: 0,
        sent_pkt_cnt: 0,
        lost_pkt_cnt: 0,
        recv_msg_cnt: 0,
        sent_msg_cnt: 0,
        msg_cnt_per_min: 0,
        remote_ip: "",
        remote_port: 0,
    };

    blacklist = new Set;

    storage = {};

    _socket = new Network(this);
    _wt = new WtLogin(this);

    get [Symbol.toStringTag]() {
        return "OicqClient";
    }
    get uin() {
        return this._uin;
    }
    get stat() {
        this._stat.msg_cnt_per_min = this._calcMsgCnt();
        this._stat.remote_ip = this._socket.remoteAddress;
        this._stat.remote_port = this._socket.remotePort;
        return this._stat;
    }
    get bkn() {
        let bkn = 5381;
        for (let v of this.sig.skey)
            bkn = bkn + (bkn << 5) + v;
        bkn &= 2147483647;
        return bkn;
    }
    cookies = new Proxy(this._cookies, {
        get: (obj, domain) => {
            const cookie = `uin=o${this.uin}; skey=${this.sig.skey};`;
            if (!obj[domain])
                return cookie;
            return `${cookie} p_uin=o${this.uin}; p_skey=${obj[domain]};`;
        }
    });

    /**
     * @param {number} uin 
     * @param {import("./ref").ConfBot} config 
     */
    constructor(uin, config) {
        super();
        this._uin = uin;

        config = {
            platform: 1,
            log_level: "info",
            kickoff: false,
            brief: false,
            ignore_self: true,
            resend: true,
            reconn_interval: 5,
            internal_cache_life: 3600,
            auto_server: true,
            data_dir: path.join(require.main ? require.main.path : process.cwd(), "data"),
            ffmpeg_path: "ffmpeg",
            ffprobe_path: "ffprobe",
            ...config
        };
        this.config = config;
        this.dir = createDataDir(config.data_dir, uin);
        this.logger = log4js.getLogger(`[${platforms[config.platform]||"Android"}:${uin}]`);
        this.logger.level = config.log_level;

        this.logger.mark("----------");
        this.logger.mark(`Package Version: oicq-icalingua-plus-plus@${version.version} (Released on ${version.upday})`);
        this.logger.mark("View Changelogs：https://github.com/Icalingua-plus-plus/oicq-icalingua-plus-plus/commits");
        this.logger.mark("----------");

        const filepath = path.join(this.dir, `device-${uin}.json`);
        if (!fs.existsSync(filepath))
            this.logger.mark("创建了新的设备文件：" + filepath);
        this.device = getDeviceInfo(filepath, this.uin);
        this.apk = getApkInfo(config.platform);

        this.on("internal.offline", offlineListener);
        this.on("internal.login", onlineListener);
        this.on("internal.packet", packetListener);
        this.on("internal.network", networkErrorListener);
    }

    /**
     * 连接服务器并执行回调
     * 如果已经连接则立刻执行回调
     * @private
     * @param {Function} cb 
     */
    _connect(cb) {
        if (this.status !== STATUS_OFFLINE)
            return cb();
        this._socket.join(() => {
            this.status = STATUS_PENDING;
            cb();
        });
    }

    /**
     * 调用api前的一层封装
     * @private
     * @param {Function} fn 
     * @param {Array} params 
     */
    async _useProtocol(fn, params) {
        if (!this.isOnline() || !this.sync_finished) {
            this.logger.error("Invoke failed, because -> client is not online")
            return buildApiRet(104, null, { code: -1, message: "client not online" });
        }
        try {
            const rsp = await fn.apply(this, params);
            if (!rsp)
                return buildApiRet(1);
            if (rsp.result !== 0)
                return buildApiRet(102, null,
                    {
                        code: rsp.result,
                        message: rsp.emsg ? rsp.emsg : getErrorMessage(fn, rsp.result)
                    }
                );
            else
                return buildApiRet(0, rsp.data);
        } catch (e) {
            this.logger.error("Invoke failed, because -> " + e.message);
            if (e instanceof TimeoutError)
                return buildApiRet(103, null, { code: -1, message: "packet timeout" });
            this.logger.debug(e);
            return buildApiRet(100, null, { code: -1, message: e.message });
        }
    }

    /**
     * 计算每分钟消息数
     * @private
     */
    _calcMsgCnt() {
        let cnt = 0;
        for (let [time, set] of this.seq_cache) {
            if (timestamp() - time >= 60)
                this.seq_cache.delete(time);
            else
                cnt += set.size;
        }
        return cnt;
    }

    ///////////////////////////////////////////////////

    login(password) {
        if (this.isOnline())
            return;
        if (password) {
            let password_md5;
            if (typeof password === "string")
                password_md5 = Buffer.from(password, "hex");
            else if (password instanceof Uint8Array)
                password_md5 = Buffer.from(password);
            if (password_md5 && password_md5.length === 16)
                this.password_md5 = password_md5;
            else
                this.password_md5 = md5(String(password));
        }
        this._connect(() => {
            this._wt.syncTimeDiff();
            this._wt.passwordLogin();
        });
    }

    captchaLogin() { }

    sliderLogin(ticket) {
        this._connect(() => {
            this._wt.sliderLogin(ticket);
        });
    }

    sendSMSCode() {
        this._connect(() => {
            this._wt.sendSMSCode();
        });
    }

    submitSMSCode(code) {
        this._connect(() => {
            this._wt.submitSMSCode(code);
        });
    }

    terminate() {
        if (this.status === STATUS_ONLINE)
            this.status = STATUS_PENDING;
        this._socket.destroy();
    }

    async logout() {
        if (this.isOnline()) {
            try {
                await this._wt.register(true);
            } catch { }
        }
        this.terminate();
        await new Promise(resolve => this.once("internal.logout", resolve));
    }

    isOnline() {
        return this.status === STATUS_ONLINE;
    }

    ///////////////////////////////////////////////////

    setOnlineStatus(status) {
        return this._useProtocol(nessy.setStatus, arguments);
    }

    getFriendList() {
        return buildApiRet(0, this.fl);
    }
    getStrangerList() {
        return buildApiRet(0, this.sl);
    }
    getGroupList() {
        return buildApiRet(0, this.gl);
    }

    async reloadFriendList() {
        const ret = await this._useProtocol(frdlst.initFL, arguments);
        this.sync_finished = true;
        this.pbGetMsg();
        return ret;
    }
    async reloadGroupList() {
        const ret = await this._useProtocol(frdlst.initGL, arguments);
        this.sync_finished = true;
        this.pbGetMsg();
        return ret;
    }

    getGroupMemberList(group_id, no_cache = false) {
        return this._useProtocol(frdlst.getGML, arguments);
    }
    getStrangerInfo(user_id, no_cache = false) {
        return this._useProtocol(frdlst.getSI, arguments);
    }
    getGroupInfo(group_id, no_cache = false) {
        return this._useProtocol(frdlst.getGI, arguments);
    }
    getGroupMemberInfo(group_id, user_id, no_cache = false) {
        return this._useProtocol(frdlst.getGMI, arguments);
    }

    ///////////////////////////////////////////////////

    sendJsonMsg(recv_id, json, group, sign) {
        return this._useProtocol(chat.sendJsonMsg, [recv_id, json, group, sign]);
    }
    sendPrivateMsg(user_id, message = "", auto_escape = false) {
        return this._useProtocol(chat.sendMsg, [user_id, message, auto_escape, 0]);
    }
    sendFile(user_id, file, name, process) {
        return this._useProtocol(chat.sendFile, [user_id, file, name, process]);
    }
    sendGroupMsg(group_id, message = "", auto_escape = false) {
        return this._useProtocol(chat.sendMsg, [group_id, message, auto_escape, 1]);
    }
    sendDiscussMsg(discuss_id, message = "", auto_escape = false) {
        return this._useProtocol(chat.sendMsg, [discuss_id, message, auto_escape, 2]);
    }
    sendTempMsg(group_id, user_id, message = "", auto_escape = false) {
        return this._useProtocol(chat.sendTempMsg, arguments);
    }
    deleteMsg(message_id) {
        return this._useProtocol(chat.recallMsg, arguments);
    }
    reportReaded(message_id) {
        return this._useProtocol(chat.reportReaded, arguments);
    }
    getMsg(message_id) {
        return this._useProtocol(chat.getOneMsg, arguments);
    }
    getChatHistory(message_id, count = 10) {
        return this._useProtocol(chat.getMsgs, arguments);
    }
    getForwardMsg(id, fileName = "MultiMsg") {
        return this._useProtocol(chat.getForwardMsg, arguments);
    }
    makeForwardMsg(fakes, dm = false, target = 0) {
        return this._useProtocol(multi.makeForwardMsg, arguments);
    }

    ///////////////////////////////////////////////////

    setGroupAnonymousBan(group_id, flag, duration = 1800) {
        return this._useProtocol(troop.muteAnonymous, arguments);
    }
    setGroupAnonymous(group_id, enable = true) {
        return this._useProtocol(troop.setAnonymous, arguments);
    }
    setGroupWholeBan(group_id, enable = true) {
        return this.setGroupSetting(group_id, "shutupTime", enable ? 0xffffffff : 0);
    }
    setGroupName(group_id, group_name) {
        return this.setGroupSetting(group_id, "ingGroupName", String(group_name));
    }
    sendGroupNotice(group_id, content) {
        return this.setGroupSetting(group_id, "ingGroupMemo", String(content));
    }
    setGroupSetting(group_id, k, v) {
        return this._useProtocol(troop.setting, arguments);
    }
    setGroupAdmin(group_id, user_id, enable = true) {
        return this._useProtocol(troop.setAdmin, arguments);
    }
    setGroupSpecialTitle(group_id, user_id, special_title = "", duration = -1) {
        return this._useProtocol(troop.setTitle, arguments);
    }
    setGroupCard(group_id, user_id, card = "") {
        return this._useProtocol(troop.setCard, arguments);
    }
    setGroupKick(group_id, user_id, reject_add_request = false) {
        return this._useProtocol(troop.kickMember, arguments);
    }
    setGroupBan(group_id, user_id, duration = 1800) {
        return this._useProtocol(troop.muteMember, arguments);
    }
    setGroupLeave(group_id, is_dismiss = false) {
        return this._useProtocol(troop.quitGroup, arguments);
    }
    sendGroupPoke(group_id, user_id) {
        return this._useProtocol(troop.pokeMember, arguments);
    }
    sendGroupSign(group_id) {
        return this._useProtocol(troop.groupSign, arguments);
    }
    setGroupRemark(group_id, remark = "") {
        return this._useProtocol(troop.setGroupRemark, arguments);
    }

    ///////////////////////////////////////////////////

    setFriendAddRequest(flag, approve = true, remark = "", block = false) {
        return this._useProtocol(sysmsg.friendAction, arguments);
    }
    setGroupAddRequest(flag, approve = true, reason = "", block = false) {
        return this._useProtocol(sysmsg.groupAction, arguments);
    }
    getSystemMsg() {
        return this._useProtocol(sysmsg.getSysMsg, arguments);
    }

    addGroup(group_id, comment = "") {
        return this._useProtocol(troop.addGroup, arguments);
    }
    addFriend(group_id, user_id, comment = "") {
        return this._useProtocol(troop.addFriend, arguments);
    }
    deleteFriend(user_id, block = true) {
        return this._useProtocol(troop.delFriend, arguments);
    }
    inviteFriend(group_id, user_id) {
        return this._useProtocol(troop.inviteFriend, arguments);
    }
    setFriendRemark(user_id, remark = "") {
        return this._useProtocol(troop.setFriendRemark, arguments);
    }

    sendLike(user_id, times = 1) {
        return this._useProtocol(nessy.sendLike, arguments);
    }
    setNickname(nickname) {
        return this._useProtocol(troop.setProfile, [0x14E22, String(nickname)]);
    }
    setDescription(description = "") {
        return this._useProtocol(troop.setProfile, [0x14E33, String(description)]);
    }
    setGender(gender) {
        gender = parseInt(gender);
        if (![0, 1, 2].includes(gender))
            return buildApiRet(100);
        return this._useProtocol(troop.setProfile, [0x14E29, Buffer.from([gender])]);
    }
    async setBirthday(birthday) {
        try {
            birthday = String(birthday).replace(/[^\d]/g, "");
            const buf = Buffer.alloc(4);
            buf.writeUInt16BE(parseInt(birthday.substr(0, 4)));
            buf.writeUInt8(parseInt(birthday.substr(4, 2)), 2);
            buf.writeUInt8(parseInt(birthday.substr(6, 2)), 3);
            return this._useProtocol(troop.setProfile, [0x16593, buf]);
        } catch (e) {
            return buildApiRet(100);
        }
    }
    setSignature(signature = "") {
        return this._useProtocol(troop.setSignature, arguments);
    }
    getSignature() {
        return this._useProtocol(troop.getSignature, arguments);
    }
    setPortrait(file) {
        return this._useProtocol(troop.setPortrait, arguments);
    }
    setGroupPortrait(group_id, file) {
        return this._useProtocol(troop.setGroupPortrait, arguments);
    }
    getLevelInfo(user_id) {
        return this._useProtocol(nessy.getLevelInfo, arguments);
    }

    getRoamingStamp(no_cache = false) {
        return this._useProtocol(nessy.getRoamingStamp, arguments);
    }

    getGroupNotice(group_id) {
        return this._useProtocol(troop.getGroupNotice, arguments);
    }

    preloadImages(files) {
        return this._useProtocol(chat.preloadImages, arguments);
    }

    ///////////////////////////////////////////////////

    async getCookies(domain) {
        const cookies = this.cookies[domain];
        if (!cookies)
            return buildApiRet(100, null, { code: -1, message: "unknown domain" });
        return buildApiRet(0, { cookies });
    }

    async getCsrfToken() {
        return buildApiRet(0, { token: this.bkn });
    }

    /**
     * @param {String} type "image" or "record" or undefined
     */
    async cleanCache(type = "") {
        let file, cmd;
        switch (type) {
        case "image":
        case "record":
            file = path.join(this.dir, "..", type, "*");
            cmd = os.platform().includes("win") ? "del /q " : "rm -f ";
            exec(cmd + '"' + file + '"', (err, stdout, stderr) => {
                if (err)
                    return this.logger.error(err);
                if (stderr)
                    return this.logger.error(stderr);
                this.logger.info(type + " cache clear");
            });
            break;
        case "":
            this.cleanCache("image");
            this.cleanCache("record");
            break;
        default:
            return buildApiRet(100, null, { code: -1, message: "unknown type (image, record, or undefined)" });
        }
        return buildApiRet(1);
    }

    canSendImage() {
        return buildApiRet(0, { yes: true });
    }
    canSendRecord() {
        return buildApiRet(0, { yes: true });
    }
    getVersionInfo() {
        return buildApiRet(0, version);
    }
    getStatus() {
        return buildApiRet(0, {
            online: this.isOnline(),
            status: this.online_status,
            remote_ip: this._socket.remoteAddress,
            remote_port: this._socket.remotePort,
            msg_cnt_per_min: this._calcMsgCnt(),
            statistics: this.stat,
            config: this.config
        });
    }
    getLoginInfo() {
        return buildApiRet(0, {
            user_id: this.uin,
            nickname: this.nickname,
            age: this.age, sex: this.sex
        });
    }
    acquireGfs(group_id) {
        return new Gfs(this, group_id);
    }
}

function createDataDir(dir, uin) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { mode: 0o755, recursive: true });
    const img_path = path.join(dir, "image");
    const ptt_path = path.join(dir, "record");
    const uin_path = path.join(dir, String(uin));
    if (!fs.existsSync(img_path))
        fs.mkdirSync(img_path);
    if (!fs.existsSync(ptt_path))
        fs.mkdirSync(ptt_path);
    if (!fs.existsSync(uin_path))
        fs.mkdirSync(uin_path, { mode: 0o755 });
    return uin_path;
}

module.exports = {
    Client,
    STATUS_ONLINE, STATUS_OFFLINE, STATUS_PENDING
};

require("./client-ext");
