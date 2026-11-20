// Project: https://github.com/takayama-lily/oicq

/// <reference types="node" />

import { EventEmitter } from 'events';
import { OutgoingHttpHeaders } from 'http';
import * as log4js from 'log4js';

export type Uin = number;

/** 大多数情况下你无需关心这些配置项，因为默认配置就是最常用的，除非你需要一些与默认不同的规则 */
export interface ConfBot {

    /** 日志等级，默认info (往屏幕打印日志会降低性能，若消息量巨大建议修改此参数或重定向) */
    log_level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off",
    /** 1:安卓手机(默认) 2:aPad 3:安卓手表 4:MacOS 5:iPad 6:安卓修复8.8.88 7:安卓手机8.9.33 8:aPad8.9.33*/
    platform?: number,
    /** 被踢下线是否在3秒后重新登陆，默认false */
    kickoff?: boolean,
    /** 群聊是否屏蔽自己的发言，默认true */
    ignore_self?: boolean,
    /** 被风控时是否尝试用分片发送，默认true */
    resend?: boolean,
    /** raw_message里是否不使用CQ码字符串，而是使用简短易读的形式(如："[图片][表情]")，可以加快解析速度，默认false */
    brief?: boolean,
    /** 数据存储文件夹，需要可写权限，默认主模块下的data文件夹 */
    data_dir?: string,

    //触发system.offline.network事件后的重连间隔秒数，默认5(秒)，不建议设置低于3(秒)
    //设置为0则不会自动重连，然后你可以监听此事件自己处理
    reconn_interval?: number,

    //一些内部缓存(如群员详细资料、群详细资料等)的生命周期，默认3600(秒)
    //即使不用相关API(使用`no_cache=true`)强制刷新数据，超过这个时间后内部也会自动刷新
    internal_cache_life?: number,

    /** 自动选择最优服务器(默认true)，关闭后会一直使用`msfwifi.3g.qq.com`进行连接 */
    auto_server?: boolean;

    /** 手动指定ip和port，不推荐使用，大多数情况下你应该使用auto_server */
    remote_ip?: string,
    remote_port?: number,

    /** ffmpeg */
    ffmpeg_path?: string,
    ffprobe_path?: string,

    /** 获取头部sign和Tlv544的qsign服务器地址，用于解决登录45和发送消息风控 */
    sign_api_addr?: string,

    /** qsign服务器的key */
    sign_api_key?: string,

    /** 强制使用算法计算T544，而不使用qsign(算法为8.9.50的0C05，混用版本可能导致风控) */
    force_algo_T544?: boolean,

    /** 使用 NT 上线包，部分消息暂未支持 */
    useNT?: boolean,

    /** 使用 NT 协议上传图片，默认 false，运行时修改从下一次上传生效 */
    useNTImage?: boolean,

    /** 强制使用旧版WT登录，即使当前APK支持NT登录 */
    forceWt?: boolean,

    /** 指定APK信息，覆盖默认的协议参数 */
    apk_info?: {
        id?: string,
        nt?: boolean,
        platform?: string,
        name?: string,
        version?: string,
        ver?: string,
        sign?: Buffer,
        buildtime?: number,
        appid?: number,
        subid?: number,
        bitmap?: number,
        sigmap?: number,
        sdkver?: string,
        ssover?: number,
        qua?: string,
    }
}

export interface Statistics {
    readonly start_time: number, //启动时刻
    readonly lost_times: number, //断线次数
    readonly recv_pkt_cnt: number, //收到包总数
    readonly sent_pkt_cnt: number, //发送包总数
    readonly lost_pkt_cnt: number, //丢包总数
    readonly recv_msg_cnt: number, //收到消息总数
    readonly sent_msg_cnt: number, //发送消息总数
    readonly msg_cnt_per_min: number, //每分钟消息数
    readonly remote_ip: string,
    readonly remote_port: number,
}

/** @deprecated */
export interface Status {
    online: boolean,
    status: number, //在线状态
    remote_ip?: number,
    remote_port?: number,
    msg_cnt_per_min: number, //每分钟消息数
    statistics: Statistics,
    config: ConfBot,
}

/** @deprecated */
export type LoginInfo = StrangerInfo;

export type GroupRole = "owner" | "admin" | "member";
export type Gender = "male" | "female" | "unknown";

//////////

export interface RetError {
    code: number,
    message: string,
}
interface RetSuccess<T> {
    retcode: 0,
    status: "ok",
    data: T,
    error: null,
}
interface RetAsync {
    retcode: 1,
    status: "async",
    data: null,
    error: null,
}
interface RetFailure {
    retcode: 100 | 102 | 103 | 104, //100error 102failed 103timeout 104offline
    status: "failed",
    data: null,
    error: RetError,
}
export type Ret<T = null> = RetSuccess<T> | RetAsync | RetFailure;
export type RetCommon = Ret;

//////////

/** 陌生人资料 */
export interface StrangerInfo {
    readonly user_id: number, //账号
    readonly nickname: string, //昵称
    readonly sex: Gender, //性别
    readonly age: number, //年龄
    readonly area?: string, //地区
    readonly signature?: string, //个性签名
    readonly description?: string, //个人说明
    readonly group_id?: number, //临时会话群号
    readonly uid?: string,
}
/** 好友资料 */
export interface FriendInfo extends StrangerInfo {
    readonly remark: string //好友备注
}
/** 群资料 */
export interface GroupInfo {
    readonly group_id: number, //群号
    readonly group_name: string, //群名
    readonly group_remark: string, // 群备注
    readonly member_count: number, //群员数
    readonly max_member_count: number, //最大群员数
    readonly owner_id: number, //群主账号
    readonly last_join_time: number, //最后入群时间
    readonly last_sent_time: number, //最后发言时间
    readonly shutup_time_whole: number, //全员禁言到期时间
    readonly shutup_time_me: number, //我的禁言到期时间
    readonly create_time: number, //创建时间
    readonly grade: number, //群等级
    readonly max_admin_count: number, //最大管理员数
    readonly active_member_count: number, //活跃群员数
    readonly update_time: number, //当前群资料的最后更新时间
}
/** 群员基础资料 */
export interface MemberBaseInfo {
    readonly user_id: number,
    readonly nickname: string,
    readonly card: string, //群名片
    readonly sex: Gender,
    readonly age: number,
    readonly area: string,
    readonly level: number, //等级
    readonly role: GroupRole, //权限
    readonly title: string, //头衔
    readonly subid: number,
    readonly uid?: string,
}
/** 群员资料 */
export interface MemberInfo extends MemberBaseInfo {
    readonly group_id: number,
    // readonly user_id: number,
    // readonly nickname: string,
    // readonly card: string,
    // readonly sex: Gender,
    // readonly age: number,
    // readonly area: string,
    readonly join_time: number, //入群时间
    readonly last_sent_time: number, //最后发言时间
    // readonly level: number,
    readonly rank: string,
    // readonly role: GroupRole,
    /** @deprecated */
    readonly unfriendly: boolean,
    // readonly title: string,
    readonly title_expire_time: number, //头衔过期时间
    /** @deprecated */
    readonly card_changeable: boolean,
    readonly shutup_time: number, //禁言到期时间
    readonly update_time: number, //此群员资料的最后更新时间
}

////////// Message Elements

/**
 * 使用cqhttp风格的消息元素类型
 * @see https://github.com/botuniverse/onebot/blob/main/specs/interface/message/segments.md 在此基础上进行了扩展
 */
export type MessageElem = TextElem | AtElem | FaceElem | BfaceElem | MfaceElem |
    ImgPttElem | LocationElem | MusicElem | ShareElem | JsonElem | XmlElem |
    AnonymousElem | ReplyElem | NodeElem | ShakeElem | PokeElem | FileElem | VideoElem |
    MiraiElem | RawElem | MarkdownElem | ButtonElem | FlashTransferElem;

export type Sendable = string | MessageElem | Iterable<MessageElem | string>

/** 一般文本 */
export interface TextElem {
    type: "text",
    data: {
        text: string
    }
}

export interface AtElem {
    type: "at",
    data: {
        qq: number | "all",
        text?: string, //at失败时显示的文本
        dummy?: boolean, //假at
    }
}

/** 经典表情 */
export interface FaceElem {
    type: "face" | "sface",
    data: {
        id: number,
        text?: string,
        qlottie?: string,
        extra?: string, //携带额外参数的json
    }
}

/** 原创表情 */
export interface BfaceElem {
    type: "bface",
    data: {
        file: string,
        text: string,
        width?: number,
        height?: number,
        type?: "png" | "gif",
    }
}

/** 魔法表情 */
export interface MfaceElem {
    type: "rps" | "dice", //猜拳和骰子
    data: {
        id: number,
    }
}

/**
 * @typedef MediaFile 为string时等同于[CQ:image]中的file参数
 * string支持以下写法：
 *   http(s):// 
 *   base64:// 
 *   /tmp/example.jpg  本地绝对路径
 *   example.jpg  本地相对(于启动目录的)路径
 *   file:///  
 *   protobuf://  仅用于语音和视频的转发
 */
export type MediaFile = string | Uint8Array | ArrayBuffer | SharedArrayBuffer;

/** 图片，闪照，语音 */
export interface ImgPttElem {
    type: "image" | "flash" | "record",
    data: {
        file: MediaFile,
        cache?: boolean, //file为网络资源时是否使用缓存
        timeout?: number, //file为网络资源时请求超时时间
        headers?: OutgoingHttpHeaders, //file为网络资源时请求头
        url?: string, //仅接收
        type?: "image" | "flash" | "face",
        brief?: string, //传统语音预览文案
    }
}

/** 视频 */
export interface VideoElem {
    type: "video",
    data: {
        file: string, //发送仅支持本地文件路径或转发
        url?: string, //仅接收
    }
}

/** 地点分享 */
export interface LocationElem {
    type: "location",
    data: {
        address: string,
        lat: number, //经纬度
        lng: number, //经纬度
        name?: string,
        id?: string,
    }
}

export type MusicType = "qq" | "163" | "migu" | "kugou" | "kuwo";
/** 音乐分享 */
export interface MusicElem {
    type: "music",
    data: {
        type: MusicType,
        id: string,
    }
}

/** 链接分享 */
export interface ShareElem {
    type: "share",
    data: {
        url: string,
        title: string,
        content?: string,
        image?: string,
    }
}

export interface JsonElem {
    type: "json",
    data: {
        data: any, // a json string or a json object
        text?: string,
    }
}

export interface XmlElem {
    type: "xml",
    data: {
        data: string,
        type?: number, //type为35的是合并转发
        text?: string,
    }
}

/** 匿名消息 */
export interface AnonymousElem {
    type: "anonymous",
    data?: {
        ignore?: boolean, //匿名失败时是否继续发送，default: true
    }
}

/** 回复 */
export interface ReplyElem {
    type: "reply",
    data: {
        id: string, //message_id
        text?: string, //消息文本内容，当获取原消息失败时使用
        message?: MessageElem[], //原消息链，当获取原消息失败时使用
    }
}

export interface NodeElem {
    type: "node",
    data: {
        id: string,
    }
}

/** 窗口抖动 */
export interface ShakeElem {
    type: "shake",
}

/** 戳一戳 */
export interface PokeElem {
    type: "poke",
    data: {
        type: number, //0~6
        id?: number,
    }
}

/** 该元素仅mirai系的客户端可解析，官方客户端无法识别 */
export interface MiraiElem {
    type: "mirai",
    data: {
        data: string,
    }
}

/** Markdown消息 */
export interface MarkdownElem {
    type: "markdown",
    data: {
        markdown: string
        config?: {
            unknown: number,
            time: number,
            token?: string,
        }
    }
}

/** 收到的 QQ 闪传卡片；发送请使用 sendFlashTransferMsg 或 FlashTransfer.send。 */
export interface FlashTransferElem {
    type: "qfile";
    data: {
        fileset_id: string;
        name?: string;
        file_size?: number | string;
        expire_time?: number | string;
        summary?: string;
        thumbnail?: {
            fileid: string;
            url: string;
            urls: { type: number; url: string }[];
        };
    };
}

/** Markdown按钮消息 */
export interface ButtonElem {
    type: "button",
    data: {
        /** 机器人appid */
        appid: number,
        rows: {
            buttons: Button[]
        }[]
    }
}

export interface Button {
    /** 按钮ID：在一个keyboard消息内设置唯一 */
    id?: string;
    render_data: {
        /** 按钮上的文字 */
        label: string;
        /** 点击后按钮的上文字 */
        visited_label: string;
        /** 按钮样式：0 灰色线框，1 蓝色线框 */
        style: number;
    };
    action: {
        /** 设置 0 跳转按钮：http 或 小程序 客户端识别 scheme，设置 1 回调按钮：回调后台接口, data 传给后台，设置 2 指令按钮：自动在输入框插入 @bot data */
        type: number;
        permission: {
            /** 0 指定用户可操作，1 仅管理者可操作，2 所有人可操作，3 指定身份组可操作（仅频道可用） */
            type: number;
            /** 有权限的用户 id 的列表 */
            specify_user_ids?: Array<string>;
            /** 有权限的身份组 id 的列表（仅频道可用） */
            specify_role_ids?: Array<string>;
        };
        /** 操作相关的数据 */
        data: string;
        /** 指令按钮可用，指令是否带引用回复本消息，默认 false。支持版本 8983 */
        reply?: boolean;
        /** 指令按钮可用，点击按钮后直接自动发送 data，默认 false。支持版本 8983 */
        enter?: boolean;
        /** 本字段仅在指令按钮下有效，设置后后会忽略 action.enter 配置。
        设置为 1 时 ，点击按钮自动唤起启手Q选图器，其他值暂无效果。
        （仅支持手机端版本 8983+ 的单聊场景，桌面端不支持） */
        anchor?: number;
        /** 【已弃用】可操作点击的次数，默认不限 */
        click_limit?: number;
        /** 【已弃用】指令按钮可用，弹出子频道选择器，默认 false */
        at_bot_show_channel_list?: boolean;
        /** 客户端不支持本action的时候，弹出的toast文案 */
        unsupport_tips: string;
    };
}

/** 该元素为需要直接发送的原始消息体，JSON 格式 */
export interface RawElem {
    type: "raw",
    data: {
        data: string,
    }
}

/** 文件(仅接受) */
export interface FileElem {
    type: "file",
    data: {
        name: string,
        url: string,
        size: number,
        md5: string,
        duration: number,
        /** @deprecated */
        busid: number,
        /** @deprecated */
        fileid: string,
        fid: string,
    }
}

////////// Events

export interface CommonEventData {
    self_id: number,
    time: number,
    post_type: "system" | "request" | "message" | "notice" | "sync" | string,
    sub_type?: string,
}

// system events
export interface CommonSystemEventData extends CommonEventData {
    post_type: "system",
}
export interface QrcodeEventData extends CommonSystemEventData {
    system_type: "login",
    sub_type: "qrcode", //收到二维码
    image: Buffer,
}
export interface SliderEventData extends CommonSystemEventData {
    system_type: "login",
    sub_type: "slider", //收到滑动验证码
    url: string, //滑动地址
}
export interface DeviceEventData extends CommonSystemEventData {
    system_type: "login",
    sub_type: "device", //收到设备锁验证请求
    url: string, //验证地址
    phone: string, //密保手机
}
export interface LoginAuthDevice {
    guid: string,
    qimei: string,
    qimei36: string,
    subappid: string,
    platform: string,
    brand: string,
    model: string,
    bssid: string,
    devInfo: string,
    sysVersion: string,
}
export interface LoginAuthEventData extends CommonSystemEventData {
    system_type: "login",
    sub_type: "auth", //登录频繁时的身份验证
    url: string, //验证地址
    device: LoginAuthDevice,
}
export interface LoginErrorEventData extends CommonSystemEventData {
    system_type: "login",
    sub_type: "error", //登录遇到错误
    code: number, //错误码
    message: string, //错误消息
}
export interface OnlineEventData extends CommonSystemEventData {
    system_type: "online", //上线
}
export interface OfflineEventData extends CommonSystemEventData {
    system_type: "offline", //掉线
    sub_type: "network" | "kickoff" | "frozen" | "unknown",
    message: string, //掉线原因
}

// request events
interface CommonRequestEventData extends CommonEventData {
    post_type: "request",
    user_id: number,
    nickname: string,
    flag: string, //同意或拒绝时传入
}
export interface FriendAddEventData extends CommonRequestEventData {
    request_type: "friend",
    sub_type: "add" | "single", //加好友请求
    comment: string, //附加信息
    source: string, //来源(如"条件查找")
    age: number,
    sex: Gender,
}
export interface GroupAddEventData extends CommonRequestEventData {
    request_type: "group",
    sub_type: "add", //加群请求
    group_id: number,
    group_name: string,
    comment: string, //附加信息
    inviter_id?: number, //邀请者(来自群员的邀请时)
    tips: string, //如"该帐号存在风险，请谨慎操作"
}
export interface GroupInviteEventData extends CommonRequestEventData {
    request_type: "group",
    sub_type: "invite", //群邀请
    group_id: number,
    group_name: string,
    role: GroupRole, //邀请者权限
}

// message events
interface CommonMessageEventData extends CommonEventData {
    post_type: "message",
    message: MessageElem[], //消息链
    raw_message: string, //字符串格式的消息
    bubble_id: number,
    message_id: string,
    user_id: number,
    font: string,
    reply(message: Sendable, auto_escape?: boolean): Promise<Ret<{ message_id: string }>>,
}
export interface PrivateMessageEventData extends CommonMessageEventData {
    message_type: "private", //私聊消息
    sub_type: "friend" | "group" | "single" | "other" | "self",
    sender: FriendInfo,
    auto_reply: boolean, //是否自动回复
}
export interface GroupMessageEventData extends CommonMessageEventData {
    message_type: "group", //群消息
    sub_type: "normal" | "anonymous",
    group_id: number,
    group_name: string,
    group_remark: string,
    anonymous: Anonymous | null, //匿名消息
    sender: MemberBaseInfo,
    atme: boolean,
    seqid: number,
    block: boolean, //是否已屏蔽
    emoji_reactions?: GroupMessageReaction[], //有表情回应汇总时才提供
}
export interface GroupMessageReaction {
    id: string;
    type: number;
    count: number;
    is_clicked: boolean;
}
export interface GroupMessageReactionDetails {
    users: Array<{ user_id: number; nickname: string; head_url: string }>;
}
export interface EmoticonSearchOptions {
    /** 上一页返回的分页会话。首次搜索时省略。 */
    session_info?: Uint8Array;
    /** 每次请求的条数。默认首屏 32 条，后续 24 条。 */
    page_size?: number;
    /** 群号。群聊和私聊上下文至多填写一个。 */
    group_id?: number;
    /** 私聊对象的 QQNT UID。 */
    guest_uid?: string;
    /** 搜索文字合成表情。 */
    compose_only?: boolean;
}

export interface EmoticonSearchImage {
    url: string;
    md5: string;
    width: number;
    height: number;
    size: number | bigint;
}

export interface EmoticonSearchPoint {
    x: number;
    y: number;
}

export interface EmoticonSearchColor {
    red: number;
    green: number;
    blue: number;
    alpha: number;
}

export interface EmoticonSearchItem {
    resource_id: string;
    image: EmoticonSearchImage;
    thumbnail: EmoticonSearchImage;
    image_other: string;
    package_id: string;
    package_type: string;
    source_url: string;
    source_icon_url: string;
    source_name: string;
    emoji_type: number;
    text_compose?: {
        bounding_box?: { top_left: EmoticonSearchPoint; bottom_right: EmoticonSearchPoint };
        text_color?: EmoticonSearchColor;
        shadow_color?: EmoticonSearchColor;
    };
    mall?: { pack_id: number; pic_id: string; jump_url: string; name: string };
    channel?: { feed_id: string; pic_id: string; jump_url: string };
}

export interface EmoticonSearchPage {
    items: EmoticonSearchItem[];
    /** 继续搜索同一个关键词时原样传回。 */
    session_info: Buffer;
    has_more: boolean;
    compose_items: EmoticonSearchItem[];
    allow_compose: boolean;
    other: string;
}
export interface Anonymous {
    id: number,
    name: string,
    flag: string,
}
export interface DiscussMessageEventData extends CommonMessageEventData {
    message_type: "discuss", //讨论组消息
    discuss_id: number,
    discuss_name: string,
    atme: boolean,
    sender: {
        user_id: number,
        nickname: string,
        card: string,
    },
}

// notice events
interface CommonFriendNoticeEventData extends CommonEventData {
    post_type: "notice",
    notice_type: "friend",
}
export interface FriendRecallEventData extends CommonFriendNoticeEventData {
    sub_type: "recall", //好友消息撤回
    user_id: number, //好友号
    operator_id: number, //撤回者(好友或自己)
    message_id: string,
}
export interface FriendProfileEventData extends CommonFriendNoticeEventData {
    sub_type: "profile", //好友资料变更
    user_id: number,
    nickname?: string,
    signature?: string,
}
export interface FriendIncreaseEventData extends CommonFriendNoticeEventData {
    sub_type: "increase", //好友增加
    user_id: number,
    nickname: string,
}
export interface FriendDecreaseEventData extends CommonFriendNoticeEventData {
    sub_type: "decrease", //好友减少
    user_id: number,
    nickname: string,
}
export interface FriendPokeEventData extends CommonFriendNoticeEventData {
    sub_type: "poke", //好友戳一戳
    user_id: number, //好友号
    operator_id: number, //poke者
    target_id: number, //被poke者
    action: string, //动作名
    suffix: string, //后缀
}

interface CommonGroupNoticeEventData extends CommonEventData {
    post_type: "notice",
    notice_type: "group",
}
export interface GroupPokeEventData extends CommonGroupNoticeEventData {
    sub_type: "poke", //群戳一戳
    group_id: number, //群号
    operator_id: number, //poke者
    user_id: number, //被poke者
    target_id: number, //被poke者
    action: string, //动作名
    suffix: string, //后缀
}
export interface GroupSignEventData extends CommonGroupNoticeEventData {
    sub_type: "sign", //群打卡
    group_id: number, //群号
    user_id: number, //打卡者
    nickname: string, //打卡者昵称
    sign_text: string, //打卡提示
}
export interface GroupEssenceEventData extends CommonGroupNoticeEventData {
    sub_type: "essence", //群精华
    group_id: number, //群号
    seq: number, //消息序号
    random: number, //消息随机数
    add: boolean, //是否是添加
    user_id: number, //消息发送者
    user_name: string, //消息发送者昵称
    operator_id: number, //操作者
    operator_name: string, //操作者昵称
}
/** 群表情回应 */
export interface GroupReactionEvent extends CommonGroupNoticeEventData {
    sub_type: "reaction"; //群表情回应
    user_id: number; //设置回应者
    id: string; //回应的表情id
    type: number; //回应的表情类型
    seq: number; //消息seq
    message_id?: string; //目标消息ID
    count?: number; //该表情当前的回应人数
    set: boolean; //设置/取消回应
}
export interface MemberIncreaseEventData extends CommonGroupNoticeEventData {
    sub_type: "increase", //群增加或群员增加
    group_id: number,
    user_id: number,
    nickname: string,
}
export interface MemberDecreaseEventData extends CommonGroupNoticeEventData {
    sub_type: "decrease", //群减少或群员减少
    group_id: number,
    operator_id: number, //踢人者
    user_id: number, //被踢者
    dismiss: boolean, //是否是解散
    member?: MemberInfo, //该群员的最后资料(有缓存时提供)
    group?: GroupInfo, //该群的最后资料(自己被踢或群解散时提供)
}
export interface GroupRecallEventData extends CommonGroupNoticeEventData {
    sub_type: "recall", //群消息撤回
    group_id: number,
    operator_id: number, //撤回者
    user_id: number, //被撤回者
    message_id: string,
}
export interface GroupAdminEventData extends CommonGroupNoticeEventData {
    sub_type: "admin", //管理员变更
    group_id: number,
    user_id: number,
    set: boolean,
}
export interface GroupMuteEventData extends CommonGroupNoticeEventData {
    sub_type: "ban", //群禁言
    group_id: number,
    operator_id: number, //禁言者
    user_id: number, //被禁言者(全员禁言为0)
    nickname?: string, //匿名者昵称(当user_id为80000000时提供)
    duration: number, //时长
}
export interface GroupTransferEventData extends CommonGroupNoticeEventData {
    sub_type: "transfer", //群转让
    group_id: number,
    operator_id: number, //旧群主
    user_id: number, //新群主
}
export interface GroupTitleEventData extends CommonGroupNoticeEventData {
    sub_type: "title", //群头衔变更
    group_id: number,
    user_id: number,
    nickname: string,
    title: string,
}
export interface GroupSettingEventData extends CommonGroupNoticeEventData {
    sub_type: "setting", //群设置变更
    group_id: number,
    group_name?: string, //群名变更
    user_id?: number, //群名变更操作人
    enable_guest?: boolean, //允许游客
    enable_anonymous?: boolean, //允许匿名
    enable_upload_album?: boolean, //允许群员上传相册
    enable_upload_file?: boolean, //允许群员上传文件
    enable_temp_chat?: boolean, //允许发起临时会话
    enable_new_group?: boolean, //允许发起新群
    enable_show_honor?: boolean, //显示群员荣誉
    enable_show_level?: boolean, //显示群员等级
    enable_show_title?: boolean, //显示群员头衔
    enable_confess?: boolean, //开关坦白说
    avatar?: boolean, //头像变更
}

//sync events 同一账号的其他客户端做了某些操作而触发的事件
export interface SyncMessageEventData extends Omit<PrivateMessageEventData, "post_type" | "message_type" | "reply"> {
    post_type: "sync",
    sync_type: "message", //同步其他客户端发送的私聊
}
export interface SyncStatusEventData extends CommonEventData {
    post_type: "sync",
    sync_type: "status", //同步在线状态
    old_status: number,
    new_status: number,
}
export interface SyncProfileEventData extends CommonEventData {
    post_type: "sync",
    sync_type: "profile", //同步个人资料
    nickname?: string,
    sex?: Gender,
    age?: number,
    signature?: string,
    description?: string,
    avatar?: boolean,
}
export interface SyncReadedEventData extends CommonEventData {
    post_type: "sync",
    sync_type: "readed", //同步已读
    sub_type: "private" | "group",
    user_id?: number,
    timestamp?: number, //私聊以时间戳分界
    group_id?: number,
    seqid?: number, //群聊以seqid分界
}
export interface SyncBlackEventData extends CommonEventData {
    post_type: "sync",
    sync_type: "black", //同步黑名单
    blacklist: number[],
}

export interface SyncRemarkEventData extends CommonEventData {
    post_type: "sync",
    sync_type: "remark",
    sub_type: "private" | "group",
    group_id?: number,
    user_id?: number,
    remark: string,
}

export type FriendNoticeEventData = FriendIncreaseEventData | FriendDecreaseEventData | FriendRecallEventData |
    FriendProfileEventData | FriendPokeEventData; //5
export type GroupNoticeEventData = GroupRecallEventData | GroupSettingEventData | GroupTitleEventData |
    GroupTransferEventData | GroupMuteEventData | GroupAdminEventData |
    MemberIncreaseEventData | MemberDecreaseEventData | GroupPokeEventData | GroupSignEventData |
    GroupEssenceEventData | GroupReactionEvent; //12

export type SystemEventData = DeviceEventData | LoginAuthEventData | SliderEventData | LoginErrorEventData | QrcodeEventData |
    OfflineEventData | OnlineEventData; //7(5+2)
export type RequestEventData = FriendAddEventData | GroupAddEventData | GroupInviteEventData; //3
export type MessageEventData = PrivateMessageEventData | GroupMessageEventData | DiscussMessageEventData; //3
export type NoticeEventData = FriendNoticeEventData | GroupNoticeEventData; //2
export type SyncEventData = SyncMessageEventData | SyncProfileEventData | SyncStatusEventData | SyncReadedEventData | SyncBlackEventData; //5
export type EventData = SystemEventData | RequestEventData | MessageEventData | NoticeEventData | SyncEventData; //5

////////// group file system

export interface GfsBaseStat {
    fid: string, //文件(夹)id
    pid: string, //父文件夹id
    name: string,
    user_id: number, //创建者
    create_time: number, //创建时间
}
export interface GfsFileStat extends GfsBaseStat {
    size: number, //文件大小(字节)
    busid: number,
    md5: string,
    sha1: string,
    duration: number, //有效时间
    download_times: number, //下载次数
}
export interface GfsDirStat extends GfsBaseStat {
    file_count: number, //文件数
    is_dir: true,
}
export type GfsStat = GfsFileStat | GfsDirStat;

/**
 * 这里面的方法是会reject的，需要catch
 * node15开始，unhandledRejection默认会升级为uncaughtException导致程序退出
 */
export class Gfs {
    private constructor();
    /** 群号 */
    readonly gid: number;
    /** 查看文件属性(尽量不要对目录使用此方法) */
    stat(fid: string): Promise<GfsStat>;
    /** 列出文件，start从0开始，limit默认100(最大) */
    ls(fid?: string, start?: number, limit?: number): Promise<GfsStat[]>;
    /** ls的别名 */
    dir: Gfs["ls"];
    /** 创建目录 */
    mkdir(name: string): Promise<GfsDirStat>;
    /** 删除文件或目录(删除目标是目录的时候会删除下面的所有文件) */
    rm(fid: string): Promise<void>; 
    /** 重命名文件或目录 */
    rename(fid: string, name: string): Promise<void>;
    /** 移动文件到其他目录 */
    mv(fid: string, pid: string): Promise<void>;
    /** 查看可用空间和文件数量 */
    df(): Promise<{
        total: number,
        used: number,
        free: number,
        file_count: number,
        max_file_count: number,
    }>;
    /** 上传文件(默认传到根目录),仅支持本地文件路径或Buffer */
    upload(file: MediaFile, pid?: string, name?: string, process?: (percentage: string) => void): Promise<GfsFileStat>;
    /** 获取文件的下载链接 */
    download(fid: string): Promise<FileElem["data"]>;
}

////////// QQ flash transfer

export interface FlashTransferOptions {
    /** 单次 HTTP 请求超时，单位毫秒，默认 30000 */
    timeout?: number;
}

export interface FlashTransferCreateOptions {
    /** 有效期，单位秒，默认 7 天；服务端仍可能受账号配额限制 */
    duration?: number;
    /** 计划上传的普通文件总数，默认 1；upload 会按实际文件自动填写 */
    total_file_count?: number;
    /** 计划上传的总字节数，默认 0；upload 会自动填写 */
    total_file_size?: number;
    /** 顶层文件及目录的数量，默认与文件总数相同；upload 会自动填写 */
    first_level_item_count?: number;
}

export interface FlashTransferTask {
    fileset_id: string;
    task_id: string;
    share_link: string;
    expire_time: number;
    expire_left_time: number;
}

export interface FlashTransferMetadata {
    cli_fileid: string;
    name: string;
    file_size: number | string;
    parent_id?: string;
    is_dir?: boolean;
    cli_file_index?: number;
    depth?: number;
    file_type?: number;
    /** 普通文件必需，十六进制摘要；目录无需填写 */
    md5?: string;
    sha1?: string;
    is_cover?: boolean;
    /** 目录直属子项数，普通文件为 0 */
    file_count?: number;
}

export interface FlashTransferUploadDirectory {
    name: string;
    /** 虚拟目录的子项；文件仍从各自的源路径读取 */
    children: FlashTransferUploadInput[];
}

export type FlashTransferUploadInput = MediaFile | { file: MediaFile; name?: string } | FlashTransferUploadDirectory;

export interface FlashTransferUploadSource {
    name: string;
    size: number;
    md5: Buffer | string;
    sha1: Buffer | string;
}

/** 客户端分片上传所需的凭证。 */
export interface FlashTransferUploadCredential {
    ukey: string;
    appid: number;
    file_id: string;
}

/** 由远程 QQ 客户端执行控制操作，文件内容在上传方本地传输。 */
export interface FlashTransferUploadController<T extends FlashTransferUploadCredential = FlashTransferUploadCredential> {
    create(name: string, options?: FlashTransferCreateOptions): Promise<FlashTransferTask>;
    addFiles(task: FlashTransferTask, files: FlashTransferMetadata[]): Promise<FlashTransferFile[]>;
    applyUpload(task: FlashTransferTask, file: FlashTransferFile, source: FlashTransferUploadSource): Promise<T>;
    completeFile(ticket: T): Promise<void>;
    submit(task_id: string): Promise<void>;
}

/** 由 applyUpload 返回，保留服务端的 IndexNode、存储参数和业务透传信息。 */
export interface FlashTransferUploadTicket {
    upload: Record<number, any>;
    info: Record<number, any>;
    ukey: string;
    app_type: number;
    /** sliceupload 使用的存储 appid */
    appid: number;
    biz_trans_info: Buffer;
    storage_type: number;
    storage_info: Buffer;
}

export interface FlashTransferUploadResult extends FlashTransferTask {
    files: FlashTransferFile[];
}

export interface FlashTransferMessageTarget {
    type: "private" | "group";
    /** 私聊接受 QQ 号（需已有 UID 缓存）或 u_ 开头的 UID；群聊接受群号 */
    target: number | string;
}

export interface FlashTransferMessageStatus {
    /** 服务端返回的目标：私聊为 UID，群号保留十进制字符串 */
    target: FlashTransferMessageTarget;
    result: number;
    message: string;
}

export interface FlashTransferFile {
    name: string;
    file_size: number | string;
    srv_fileid: string;
    cli_fileid: string;
    sha1?: string;
    physical: {
        id: string;
        [key: string]: any;
    };
    [key: string]: any;
}

export interface FlashTransferPage {
    file_list: FlashTransferFile[];
    is_end: boolean;
    pagination_info: string;
    [key: string]: any;
}

export interface FlashTransferDownload {
    url: string;
    [key: string]: any;
}

/** 与 Gfs 一样，以下方法会 reject；控制接口保留官网的 snake_case 字段。 */
export class FlashTransfer {
    private constructor();
    /** 文件在本机分片上传，创建、登记及完成提交由 control 执行；无需本机登录 QQ */
    static upload<T extends FlashTransferUploadCredential>(files: FlashTransferUploadInput | FlashTransferUploadInput[], control: FlashTransferUploadController<T>, name?: string, callback?: (percentage: string) => void, options?: FlashTransferCreateOptions & { timeout?: number }): Promise<FlashTransferUploadResult>;
    /** 分享码或 https://qfile.qq.com/q/... 链接转换为文件集 ID */
    resolve(code: string): Promise<string>;
    /** 原生创建文件集，需要在线客户端；保留 task_id 用于完成提交 */
    create(name: string, options?: FlashTransferCreateOptions): Promise<FlashTransferTask>;
    /** 完整上传文件、目录或二进制数据，需要在线客户端；进度参数为数据传输百分比 */
    upload(files: FlashTransferUploadInput | FlashTransferUploadInput[], name?: string, callback?: (percentage: string) => void, options?: FlashTransferCreateOptions): Promise<FlashTransferUploadResult>;
    /** 分批登记目录及已计算摘要的文件，返回顺序与请求一致 */
    addFiles(task: Pick<FlashTransferTask, "fileset_id" | "task_id">, files: FlashTransferMetadata[]): Promise<FlashTransferFile[]>;
    /** 底层上传申请；文件必须是 addFiles 返回的节点，source 提供其名称、大小及摘要 */
    applyUpload(task: Pick<FlashTransferTask, "fileset_id">, file: FlashTransferFile, source: FlashTransferUploadSource): Promise<FlashTransferUploadTicket & FlashTransferUploadCredential>;
    /** 分片上传或秒传成功后同步单个文件，随后才能提交整个任务 */
    completeFile(ticket: FlashTransferUploadTicket): Promise<void>;
    /** 文件级完成同步之后提交整个任务，参数是 task_id */
    submit(task_id: string): Promise<void>;
    /** 由服务端生成并发送原生闪传卡片；任一目标失败则 reject，Error.send_status 保留全部结果 */
    send(fileset_id: string, targets: FlashTransferMessageTarget | FlashTransferMessageTarget[]): Promise<FlashTransferMessageStatus[]>;
    /** 查询文件集信息 */
    stat(fileset_id: string): Promise<Record<string, any>>;
    /** 查询目录的一页文件；pagination_info 使用服务端游标，count 为 1–100 */
    dir(fileset_id: string, parent_id?: string, pagination_info?: string, count?: number): Promise<FlashTransferPage>;
    /** 按服务端游标逐页遍历当前目录 */
    files(fileset_id: string, parent_id?: string): AsyncGenerator<FlashTransferFile>;
    /** 查询多个文件集的传输进度 */
    progress(fileset_ids: string[]): Promise<Record<string, any>>;
    /** 按 srv_fileid 查询文件集内指定文件的传输进度 */
    fileProgress(fileset_id: string, srv_fileids: string[]): Promise<Record<string, any>>;
    /** 查询指定目录的文件分类信息 */
    category(fileset_id: string, parent_id?: string): Promise<Record<string, any>>;
    /** 设置用户完成官方验证码后取得的 ticket 和 randstr，供下载请求使用 */
    setCaptcha(ticket: string, randstr: string): void;
    /** 参数可以是文件元数据，或 physical.id（不是 srv_fileid） */
    getDownloadUrl(file: FlashTransferFile | string): Promise<FlashTransferDownload>;
    /** 批量获取下载信息，每批最多 30 个文件，返回顺序与输入一致 */
    getDownloadUrls(files: (FlashTransferFile | string)[]): Promise<FlashTransferDownload[]>;
    /** 下载到指定路径，验证大小和可用的 SHA1，不覆盖已有文件 */
    download(file: FlashTransferFile | string, target: string, callback?: (percentage: string) => void): Promise<{
        path: string;
        size: number;
        sha1: string;
    }>;
    /** 底层 sliceupload 数据面；自动申请凭证并提交整个任务请使用 upload */
    uploadFile(file: MediaFile, ukey: string, appid: number, name?: string, callback?: (percentage: string) => void): Promise<{
        name: string;
        size: number;
        md5: string;
        sha1: string;
    }>;
}

//////////

export type Domain = "tenpay.com"
    | "docs.qq.com"
    | "office.qq.com"
    | "connect.qq.com"
    | "vip.qq.com"
    | "mail.qq.com"
    | "qzone.qq.com"
    | "gamecenter.qq.com"
    | "mma.qq.com"
    | "game.qq.com"
    | "qqweb.qq.com"
    | "openmobile.qq.com"
    | "qun.qq.com"
    | "ti.qq.com"
    | "weiyun.com"
    | "";

export interface Sig {
    srm_token: Buffer,
    tgt: Buffer,
    tgt_key: Buffer,
    st_sig: Buffer,
    st_key: Buffer,
    st_web_sig: Buffer,
    t103: Buffer,
    t543: Buffer,
    t544: Object,
    t547: Buffer,
    t553: Buffer,
    skey: Buffer,
    d2: Buffer,
    d2key: Buffer,
    sig_key: Buffer,
    ticket_key: Buffer,
    device_token?: Buffer,
    emp_time: number,
    time_diff: number,
    _ksid: Buffer,
    qsign_token_time: number,
}

export interface EventMap {
    /**扫码登录收到二维码事件 */
    "system.login.qrcode": (this: Client, data: QrcodeEventData) => void;
    /**收到滑动验证码事件 */
    "system.login.slider": (this: Client, data: SliderEventData) => void;
    /**设备锁验证事件 */
    "system.login.device": (this: Client, data: DeviceEventData) => void;
    /**登录频繁时的身份验证事件 */
    "system.login.auth": (this: Client, data: LoginAuthEventData) => void;
    /**登录遇到错误事件 */
    "system.login.error": (this: Client, data: LoginErrorEventData) => void;
    "system.login": (this: Client, data: DeviceEventData | LoginAuthEventData | LoginErrorEventData | SliderEventData | QrcodeEventData) => void;
    /**上线事件 */
    "system.online": (this: Client, data: OnlineEventData) => void;

    /**下线事件（网络原因） */
    "system.offline.network": (this: Client, data: OfflineEventData) => void;
    /**下线事件（被踢下线） */
    "system.offline.kickoff": (this: Client, data: OfflineEventData) => void;
    /**下线事件（账号被冻结） */
    "system.offline.frozen": (this: Client, data: OfflineEventData) => void;
    /**下线事件（未知原因） */
    "system.offline.unknown": (this: Client, data: OfflineEventData) => void;
    "system.offline": (this: Client, data: OfflineEventData) => void;

    "system": (this: Client, data: SystemEventData) => void;

    /**收到好友申请事件 */
    "request.friend.add": (this: Client, data: FriendAddEventData) => void;
    /**收到好友申请事件(对方已将你加为单向好友，可回添对方) */
    "request.friend.single": (this: Client, data: FriendAddEventData) => void;
    "request.friend": (this: Client, data: FriendAddEventData) => void;
    /**收到加群申请事件 */
    "request.group.add": (this: Client, data: GroupAddEventData) => void;
    /**收到群邀请事件 */
    "request.group.invite": (this: Client, data: GroupInviteEventData) => void
    "request.group": (this: Client, data: GroupAddEventData | GroupInviteEventData) => void
    /**监听以上所有request事件 */
    "request": (this: Client, data: RequestEventData) => void;

    /**私聊消息事件 */
    "message.private.friend": (this: Client, data: PrivateMessageEventData) => void; //从双向好友
    "message.private.group": (this: Client, data: PrivateMessageEventData) => void; //从群临时会话
    "message.private.single": (this: Client, data: PrivateMessageEventData) => void; //从单向好友
    "message.private.other": (this: Client, data: PrivateMessageEventData) => void;
    "message.private.self": (this: Client, data: PrivateMessageEventData) => void; //从我的设备
    "message.private": (this: Client, data: PrivateMessageEventData) => void;

    /**群消息事件 */
    "message.group": (this: Client, data: GroupMessageEventData) => void;
    "message.group.normal": (this: Client, data: GroupMessageEventData) => void; //普通消息
    "message.group.anonymous": (this: Client, data: GroupMessageEventData) => void; //匿名消息
    /**讨论组消息事件 */
    "message.discuss": (this: Client, data: DiscussMessageEventData) => void;
    /**监听以上所有message事件 */
    "message": (this: Client, data: MessageEventData) => void;

    /**新增好友事件 */
    "notice.friend.increase": (this: Client, data: FriendIncreaseEventData) => void;
    /**好友(被)删除事件 */
    "notice.friend.decrease": (this: Client, data: FriendDecreaseEventData) => void;
    /**好友消息撤回事件 */
    "notice.friend.recall": (this: Client, data: FriendRecallEventData) => void;
    /**好友资料变更事件 */
    "notice.friend.profile": (this: Client, data: FriendProfileEventData) => void;
    /**好友戳一戳事件 */
    "notice.friend.poke": (this: Client, data: FriendPokeEventData) => void;
    /**入群・群员增加事件 */
    "notice.group.increase": (this: Client, data: MemberIncreaseEventData) => void;
    /**踢群・退群事件 */
    "notice.group.decrease": (this: Client, data: MemberDecreaseEventData) => void;
    /**群消息撤回事件 */
    "notice.group.recall": (this: Client, data: GroupRecallEventData) => void;
    /**管理员变更事件 */
    "notice.group.admin": (this: Client, data: GroupAdminEventData) => void;
    /**群禁言事件 */
    "notice.group.ban": (this: Client, data: GroupMuteEventData) => void;
    /**群转让事件 */
    "notice.group.transfer": (this: Client, data: GroupTransferEventData) => void;
    /**群头衔变更事件 */
    "notice.group.title": (this: Client, data: GroupTitleEventData) => void;
    /**群戳一戳事件 */
    "notice.group.poke": (this: Client, data: GroupPokeEventData) => void;
    /**群打卡事件 */
    "notice.group.sign": (this: Client, data: GroupSignEventData) => void;
    /**群精华事件 */
    "notice.group.essence": (this: Client, data: GroupEssenceEventData) => void;
    /**群表情回应事件 */
    "notice.group.reaction": (this: Client, data: GroupReactionEventData) => void;
    /**群设置变更事件 */
    "notice.group.setting": (this: Client, data: GroupSettingEventData) => void;
    /**监听以上所有好友notice事件 */
    "notice.friend": (this: Client, data: FriendNoticeEventData) => void;
    /**监听以上所有群notice事件 */
    "notice.group": (this: Client, data: GroupNoticeEventData) => void;
    /**监听以上所有notice事件 */
    "notice": (this: Client, data: NoticeEventData) => void;

    /**同账号其他客户端发送私聊事件 */
    "sync.message": (this: Client, data: SyncMessageEventData) => void;
    /**个人资料修改事件 */
    "sync.profile": (this: Client, data: SyncProfileEventData) => void;
    /**在线状态修改事件 */
    "sync.status": (this: Client, data: SyncStatusEventData) => void;
    /** @deprecated 黑名单修改事件 */
    "sync.black": (this: Client, data: SyncBlackEventData) => void;
    /**消息已读事件 */
    "sync.readed": (this: Client, data: SyncReadedEventData) => void;
    "sync.readed.private": (this: Client, data: SyncReadedEventData) => void;
    "sync.readed.group": (this: Client, data: SyncReadedEventData) => void;
    /**备注名修改事件 */
    "sync.remark": (this: Client, data: SyncRemarkEventData) => void;
    "sync.remark.private": (this: Client, data: SyncRemarkEventData) => void;
    "sync.remark.group": (this: Client, data: SyncRemarkEventData) => void;
    /**监听以上所有sync事件 */
    "sync": (this: Client, data: SyncEventData) => void;

    /** 实验性事件: 监听所有收到的包(已解密) */
    "internal.sso": (this: Client, data: { cmd: string, seq: number, payload: Buffer }) => void;
    /** 实验性事件: 对方正在输入 */
    "internal.input": (this: Client, data: { user_id: number, end: boolean }) => void;
}

////////// QQ favorites

/** 收藏中的 uint64：安全整数返回 number，超出安全范围返回十进制字符串。 */
export type FavoriteInteger = number | string;

export interface FavoriteCollection {
    cid: string;
    type?: number;
    status?: number;
    author?: FavoriteAuthor;
    bid?: number;
    src_app_id?: number;
    src_app_ver?: string;
    category?: number;
    create_time?: FavoriteInteger;
    collect_time?: FavoriteInteger;
    modify_time?: FavoriteInteger;
    sequence?: FavoriteInteger;
    biz_key?: string;
    biz_data_list: string[]; /** Base64 编码的原始字节。 */
    summary?: FavoriteCollectionSummary;
    star_mark?: boolean;
    star_time?: FavoriteInteger;
    share_url?: string;
    original_app_id?: number;
    custom_group_id?: number;
    security_beat?: number;
    qzone_ugc_key?: string;
}

export interface FavoriteAuthor {
    type?: number;
    num_id?: FavoriteInteger;
    str_id?: string;
    group_id?: FavoriteInteger;
    group_name?: string;
}

export interface FavoriteCollectionSummary {
    text_summary?: FavoriteTextSummary;
    link_summary?: FavoriteLinkSummary;
    gallery_summary?: FavoriteGallerySummary;
    audio_summary?: FavoriteAudioSummary;
    video_summary?: FavoriteVideoSummary;
    file_summary?: FavoriteFileSummary;
    location_summary?: FavoriteLocationSummary;
    rich_media_summary?: FavoriteRichMediaSummary;
}

export interface FavoriteTextSummary {
    brief?: string;
    has_emoji?: boolean;
}

export interface FavoriteLinkSummary {
    uri?: string;
    title?: string;
    publisher?: string;
    brief?: string;
    pic_list: FavoritePicInfo[];
    type?: number;
    resource_uri?: string;
}

export interface FavoritePicInfo {
    uri?: string;
    md5?: string; /** Base64 编码的原始字节。 */
    sha1?: string; /** Base64 编码的原始字节。 */
    name?: string;
    note?: string;
    width?: number;
    height?: number;
    size?: number;
    type?: number;
    owner?: FavoriteAuthor;
    pic_id?: string;
}

export interface FavoriteGallerySummary {
    pic_list: FavoritePicInfo[];
    notes?: string;
}

export interface FavoriteAudioSummary {
    duration?: number;
    stt?: string;
    note?: string;
}

export interface FavoriteVideoSummary {
    title?: string;
    duration?: number;
    format?: number;
    category?: number;
    preview_type?: number;
    preview_pic_info?: FavoritePicInfo;
    store_type?: number;
    store_file_info?: FavoriteFileInfo;
}

export interface FavoriteFileInfo {
    src?: number;
    uid?: FavoriteInteger;
    bid?: number;
    fid?: string;
    name?: string;
    size?: FavoriteInteger;
    md5?: string; /** Base64 编码的原始字节。 */
    sha1?: string; /** Base64 编码的原始字节。 */
    category?: number;
}

export interface FavoriteFileSummary {
    file_info?: FavoriteFileInfo;
    src_file_info?: FavoriteFileInfo;
}

export interface FavoriteLocationSummary {
    name?: string;
    latitude?: number;
    longitude?: number;
    altitude?: number;
    address?: string;
    note?: string;
}

export interface FavoriteRichMediaSummary {
    title?: string;
    sub_title?: string;
    brief?: string;
    pic_list: FavoritePicInfo[];
    content_type?: number;
    original_uri?: string;
    publisher?: string;
    rich_media_version?: number;
}

export interface FavoriteCollectionContent {
    text_content?: FavoriteTextContent;
    link_content?: FavoriteLinkContent;
    gallery_content?: FavoriteGalleryContent;
    audio_content?: FavoriteAudioContent;
    video_content?: FavoriteVideoContent;
    file_content?: FavoriteFileContent;
    location_content?: FavoriteLocationContent;
    rich_media_content?: FavoriteRichMediaContent;
}

export interface FavoriteTextContent {
    data?: string;
    has_emoji?: boolean;
}

export interface FavoriteLinkContent {
}

export interface FavoriteGalleryContent {
}

export interface FavoriteAudioContent {
    data?: string; /** Base64 编码的原始字节。 */
}

export interface FavoriteVideoContent {
}

export interface FavoriteFileContent {
}

export interface FavoriteLocationContent {
}

export interface FavoriteRichMediaContent {
    rich_media?: FavoriteRichMedia;
    raw_data?: string; /** Base64 编码的原始字节。 */
    biz_data_list: string[]; /** Base64 编码的原始字节。 */
    pic_list: FavoritePicInfo[];
    file_list: FavoriteFileInfo[];
}

export interface FavoriteRichMedia {
    sections: FavoriteSection[];
}

export interface FavoriteSection {
    items: FavoriteItem[];
}

export interface FavoriteItem {
    item_type?: number;
    parag?: FavoriteParagraph;
    anchor?: FavoriteAnchor;
    pic_info?: FavoritePicInfo;
}

export interface FavoriteParagraph {
    content?: string;
    style?: FavoriteStyle;
}

export interface FavoriteStyle {
    color?: string;
    font_family?: string;
    font_weight?: string;
    font_size?: string;
}

export interface FavoriteAnchor {
    url?: string;
    desc?: string;
}

export interface FavoriteCollectionFullInfo {
    collection: FavoriteCollection;
    content?: FavoriteCollectionContent;
    /** 富文本 content_type 为 1/2 时，解压后的 HTML。 */
    html?: string;
}

export interface FavoriteGetCollectionListMsgRsp {
    collection_list: FavoriteCollection[];
    total_count?: number;
    result?: number;
}

export interface FavoriteGetCollectionFullInfoMsgRsp {
    collection_full_info_list: FavoriteCollectionFullInfo[];
}

export interface FavoriteCustomGroupInfo {
    custom_group_id?: number;
    name?: string;
    create_time?: number;
    modify_time?: number;
    total_count?: number;
}

export interface FavoriteGetCustomGroupMsgRsp {
    modi_groupid_time?: number;
    total_count?: number;
    modi_group_time?: number;
    customgroupinfo_list: FavoriteCustomGroupInfo[];
    max_group_count?: number;
}

export interface FavoriteGetCollectorUserInfoRsp {
    toatal_space?: FavoriteInteger;
    used_space?: FavoriteInteger;
}

export interface FavoriteListOptions {
    type?: number;
    bid?: number;
    category?: number;
    /** 毫秒时间戳。 */
    start_time?: number;
    start_pos?: number;
    /** 1~100，默认 20。 */
    page_size?: number;
    order_type?: 0 | 1;
    sync_policy?: number;
}
export type FavoriteInput = ({ type?: "text"; text: string } |
    { type: "link"; url: string; title?: string; publisher?: string; brief?: string } |
    { type: "rich"; html: string; title?: string; brief?: string }) & {
    bid?: number; category?: number; custom_group_id?: number;
};
export interface FavoriteChanges {
    text?: string;
    html?: string;
    url?: string;
    title?: string;
    publisher?: string;
    brief?: string;
    category?: number;
    custom_group_id?: number;
    star_mark?: boolean;
}
export interface FavoriteItemResults {
    /** 批量请求可能部分失败，必须检查 success 和每项 result。 */
    success: boolean;
    results: { id: string | number; result: number }[];
}

/** 收藏文件资源的临时下载凭据；headers 应随资源请求发送。 */
export interface FavoriteDownload {
    /** 收藏 ID。 */
    cid: string;
    /** 文件 ID。 */
    fid: string;
    /** 收藏的原始协议类型，例如 5 视频、6 文件。 */
    type: number;
    /** 原始文件名。 */
    name: string;
    /** 文件大小，单位为字节；大整数以十进制字符串表示。 */
    size: FavoriteInteger;
    /** 临时资源地址，过期后应重新调用 getFavoriteFileUrl。 */
    url: string;
    /** 资源专用鉴权头，应与 url 一起使用。 */
    headers: Record<string, string>;
    /** 服务端是否要求下载后重命名文件。 */
    rename_file: boolean;
    /** 服务端返回的风险提示。 */
    risk_tips: string;
}

/**
 * 方法不会reject或抛出异常，使用retcode判断是否成功
 * @see {Ret}
 */
export class Client extends EventEmitter {

    readonly uid?: string;
    readonly uin: number;
    readonly password_md5?: Buffer;
    readonly nickname: string;
    readonly needSignCmd: Array<string>;
    readonly sex: Gender;
    readonly age: number;
    readonly bkn: number; //csrf token
    readonly cookies: {[k in Domain]: string};
    readonly sig: Sig;
    /** 在线状态 */
    readonly online_status: number;
    /** 好友列表 */
    readonly fl: ReadonlyMap<number, FriendInfo>;
    /** 陌生人列表 */
    readonly sl: ReadonlyMap<number, StrangerInfo>;
    /** 群列表 */
    readonly gl: ReadonlyMap<number, GroupInfo>;
    /** 群员列表缓存 */
    readonly gml: ReadonlyMap<number, ReadonlyMap<number, MemberInfo>>;
    /** uid转uin列表 */
    readonly uid2uin_map: ReadonlyMap<string, number>;
    /** uin转uid列表 */
    readonly uin2uid_map: ReadonlyMap<number, string>;
    /** 黑名单 */
    readonly blacklist: ReadonlySet<number>;
    /** 日志记录器 */
    readonly logger: log4js.Logger;
    /** 当前账号本地存储路径 */
    readonly dir: string;
    /** 配置信息(大部分参数支持热修改) */
    readonly config: ConfBot;
    /** 数据统计信息 */
    readonly stat: Statistics;

    constructor(uin: number, config?: ConfBot);

    /**
     * @param password 明文或md5后的密码，使用扫码登录可无需传入此参数
     */
    login(password?: Uint8Array | string): void;

    /** 提交滑动验证码ticket */
    sliderLogin(ticket: string): Promise<void>;
    /** 先下线再关闭连接 */
    logout(): Promise<void>;
    /** 直接关闭连接 */
    terminate(): void;
    isOnline(): boolean;

    /** 发验证码给密保手机，用于发短信过设备锁 */
    sendSMSCode(): void;
    /** 提交收到的短信验证码 */
    submitSMSCode(code: string): Promise<void>;

    /**
     * 设置在线状态
     * @param status 11我在线上 31离开 41隐身 50忙碌 60Q我吧 70请勿打扰
     */
    setOnlineStatus(status: number): Promise<Ret>;

    /** 获取群员列表 */
    getGroupMemberList(group_id: number, no_cache?: boolean): Promise<Ret<ReadonlyMap<number, MemberInfo>>>;
    /** 获取群员资料 */
    getGroupMemberInfo(group_id: number, user_id: number, no_cache?: boolean): Promise<Ret<MemberInfo>>;
    /** 获取陌生人资料 */
    getStrangerInfo(user_id: number, no_cache?: boolean): Promise<Ret<StrangerInfo>>;
    /** 获取群资料(该方法一般用于刷新群资料缓存，从缓存中获取直接访问 this.gl.get(gid) 即可) */
    getGroupInfo(group_id: number, no_cache?: boolean): Promise<Ret<GroupInfo>>;

    /** 互联分享 */
    sendJsonMsg(recv_id: number, json: string, group: boolean, sign: string): Promise<Ret>;
    /** 私聊 */
    sendPrivateMsg(user_id: number, message: Sendable, auto_escape?: boolean): Promise<Ret<{ message_id: string }>>;
    sendFile(user_id: number, file: MediaFile, name?: string, process?: (percentage: string) => void): Promise<Ret<{ message_id: string }>>;
    /** 发送原生闪传卡片；group=true 为群聊，返回逐目标状态，不提供 message_id */
    sendFlashTransferMsg(recv_id: number | string, fileset_id: string, group?: boolean): Promise<Ret<{
        fileset_id: string;
        send_status: FlashTransferMessageStatus[];
    }>>;
    /** 上传单个文件或数组到同一文件集并发送闪传卡片；name为单文件名或批量文件集名称，group=true为群聊，不提供message_id */
    sendFlashTransferFile(recv_id: number | string, file: MediaFile | MediaFile[], group?: boolean, name?: string, process?: (percentage: string) => void): Promise<Ret<FlashTransferUploadResult & {
        send_status: FlashTransferMessageStatus[];
    }>>;
    /** 群聊 */
    sendGroupMsg(group_id: number, message: Sendable, auto_escape?: boolean): Promise<Ret<{ message_id: string }>>;
    /** 群临时会话，大多数时候可以使用私聊达到同样效果 */
    sendTempMsg(group_id: number, user_id: number, message: Sendable, auto_escape?: boolean): Promise<Ret<{ message_id: string }>>;
    /** 讨论组 */
    sendDiscussMsg(discuss_id: number, message: Sendable, auto_escape?: boolean): Promise<Ret>;
    /** 撤回 */
    deleteMsg(message_id: string): Promise<Ret>;
    /** 置消息已读(message_id及之前的消息将全部变为已读) */
    reportReaded(message_id: string): Promise<Ret>;
    /** 获取一条消息(无法获取被撤回的消息) */
    getMsg(message_id: string): Promise<Ret<PrivateMessageEventData | GroupMessageEventData>>;

    /**
     * 获取message_id往前的count条消息(群聊未撤回时必包括自身，私聊不包括自身)
     * 无法获取被撤回的消息，因此返回的数量并不一定为count
     * count默认为20，不能超过20
     * 
     * 若要获取最新的20条消息，参考https://github.com/takayama-lily/oicq/wiki/93.%E8%A7%A3%E6%9E%90%E6%B6%88%E6%81%AFID
     * 自行构造消息id，除群号外其余位补0
     */
    getChatHistory(message_id: string, count?: number): Promise<Ret<PrivateMessageEventData[] | GroupMessageEventData[]>>;

    /**
     * 获取转发消息
     * resid在xml消息中，需要自行解析xml获得
     * 暂不支持套娃转发解析
     */
    getForwardMsg(resid: string, fileName?: string): Promise<Ret<Array<{
        group_id?: number,
        user_id: number,
        nickname: string,
        time: number,
        seq: number,
        head_img?: string,
        message: MessageElem[],
        raw_message: string,
        bubble_id: number,
    }>>>;

    /**
     * 制作一个合并转发消息，得到的XmlElem可直接发送
     * @param dm 默认(false)以群模式上传图片，设为true则以私聊模式上传图片
     * @param target 指定合并转发来源
     * @param nt 默认(true)使用NT协议上传，设为false则使用旧协议
     */
    makeForwardMsg(fakes: FakeMessage | Iterable<FakeMessage>, dm?: boolean, target?: number, nt?: boolean): Promise<Ret<XmlElem>>;

    /** 发简易群公告 */
    sendGroupNotice(group_id: number, content: string): Promise<Ret>;
    /** 设置群名 */
    setGroupName(group_id: number, group_name: string): Promise<Ret>;
    /** 开启或关闭匿名 */
    setGroupAnonymous(group_id: number, enable?: boolean): Promise<Ret>;
    /** 全员禁言 */
    setGroupWholeBan(group_id: number, enable?: boolean): Promise<Ret>;
    /** 设置管理员 */
    setGroupAdmin(group_id: number, user_id: number, enable?: boolean): Promise<Ret>;
    /** 设置群头衔 */
    setGroupSpecialTitle(group_id: number, user_id: number, special_title?: string, duration?: number): Promise<Ret>;
    /** 设置群名片 */
    setGroupCard(group_id: number, user_id: number, card?: string): Promise<Ret>;
    /** 踢人(不支持批量) */
    setGroupKick(group_id: number, user_id: number, reject_add_request?: boolean): Promise<Ret>;
    /** 禁言 */
    setGroupBan(group_id: number, user_id: number, duration?: number): Promise<Ret>;
    /** 禁言匿名玩家 */
    setGroupAnonymousBan(group_id: number, flag: string, duration?: number): Promise<Ret>;
    /** 退群(注意dismiss参数可能无效，如果你是群主无论如何群都会立即解散) */
    setGroupLeave(group_id: number, dismiss?: boolean): Promise<Ret>;
    /** 戳一戳(可以对好友使用) */
    sendGroupPoke(group_id: number, user_id: number): Promise<Ret>;
    /** 群打卡 */
    sendGroupSign(group_id: number): Promise<Ret>;
    /** 设置群备注名 */
    setGroupRemark(group_id: number, remark: string): Promise<Ret>;
    /** 按关键词搜索 QQ 表情 */
    searchEmoticons(keyword: string, options?: EmoticonSearchOptions): Promise<Ret<EmoticonSearchPage>>;
    /** 设置群消息表情回应 */
    setEmojiReaction(group_id: number, msg_seq: number, id: string, type?: number, set?: boolean): Promise<Ret>;
    /** 获取群消息指定表情的所有回应人员 */
    getEmojiReaction(group_id: number, msg_seq: number, id: string, type?: number): Promise<Ret<GroupMessageReactionDetails>>;
    /** 群机器人按钮回调 */
    sendButtonCallback(group_id: number, msg_seq: number, appid: number, id: string, data: string): Promise<Ret>

    /** 处理好友请求 */
    setFriendAddRequest(flag: string, approve?: boolean, remark?: string, block?: boolean): Promise<Ret>;
    /** 处理群请求 */
    setGroupAddRequest(flag: string, approve?: boolean, reason?: string, block?: boolean): Promise<Ret>;
    /** 获取未处理的请求 */
    getSystemMsg(): Promise<Ret<Array<FriendAddEventData | GroupAddEventData | GroupInviteEventData>>>;

    /** 该接口风控 */
    addGroup(group_id: number, comment?: string): Promise<Ret>;
    /** 添加好友，只能添加群友 */
    addFriend(group_id: number, user_id: number, comment?: string): Promise<Ret>;
    /** 删除好友 */
    deleteFriend(user_id: number, block?: boolean): Promise<Ret>;
    /** 邀请好友入群(不支持陌生人和批量) */
    inviteFriend(group_id: number, user_id: number): Promise<Ret>;
    /** 点赞(times默认1，支持陌生人)  */
    sendLike(user_id: number, times?: number): Promise<Ret>;
    /** 设置好友备注名 */
    setFriendRemark(user_id: number, remark: string): Promise<Ret>;

    /** 设置昵称 */
    setNickname(nickname: string): Promise<Ret>;
    /** 设置性别(0未知 1男 2女) */
    setGender(gender: 0 | 1 | 2): Promise<Ret>;
    /** 设置生日(20110202的形式) */
    setBirthday(birthday: string | number): Promise<Ret>;
    /** 设置个人说明 */
    setDescription(description?: string): Promise<Ret>;
    /** 设置个人签名 */
    setSignature(signature?: string): Promise<Ret>;
    /** 获取个人签名 */
    getSignature(): Promise<Ret<string>>;
    /** 设置个人头像 */
    setPortrait(file: MediaFile): Promise<Ret>; //
    /** 设置群头像 */
    setGroupPortrait(group_id: number, file: MediaFile): Promise<Ret>;

    /**
     * @deprecated
     * 预先上传图片以备发送
     * 通常图片在发送时一并上传
     * 提前上传可用于加快发送速度，实现秒发
     */
    preloadImages(files: Iterable<MediaFile>): Promise<Ret<string[]>>;

    /** 获取漫游表情 */
    getRoamingStamp(no_cache?: boolean): Promise<Ret<string[]>>;

    /** 根据NT图fileid获取URL */
    getNTPicURLbyFileid(fileid: string): Promise<Ret<string>>;

    /** 获取已登录的设备 */
    getDevLoginInfo(): Promise<Ret<Object[]>>;

    /** 踢出已登录的设备 */
    delDevLoginInfo(flag: string): Promise<Ret>;

    /** 根据fileid获取私聊文件URL */
    getC2CFileUrl(fileid: string): Promise<Ret<string>>;

    /** 清除 image 和 record 文件夹下的缓存文件 */
    cleanCache(type?: "image" | "record"): Promise<Ret>;

    /** 进入群文件系统 */
    acquireGfs(group_id: number): Gfs;

    //----------QQ 收藏----------
    /**
     * 获取一页 QQ 收藏摘要，需要登录票据包含 weiyun.com 的 p_skey。
     * @param options 筛选条件及分页参数；默认每页 20 条，时间使用毫秒。
     * @returns 当前页收藏列表、总数及同步状态；result=215000 表示部分同步。
     */
    getFavoriteList(options?: FavoriteListOptions): Promise<Ret<FavoriteGetCollectionListMsgRsp>>;

    /**
     * 获取指定收藏的完整元数据和正文。
     * @param cid 收藏 ID。
     * @returns 收藏信息和正文；富文本 content_type 为 1/2 时额外返回解码后的 html。
     */
    getFavorite(cid: string): Promise<Ret<FavoriteCollectionFullInfo>>;

    /**
     * 增加文本、链接或 HTML 收藏。
     * @param favorite 收藏内容；字符串按纯文本处理，对象可指定类型及所属分组。
     * @returns 新收藏的 cid 与 collect_time。
     */
    addFavorite(favorite: FavoriteInput | string): Promise<Ret<{ cid: string; collect_time: FavoriteInteger }>>;

    /**
     * 编辑收藏，先读取详情再合并指定字段，保留其余元数据和资源。
     * @param cid 收藏 ID。
     * @param changes 需要修改的字段；type=1 支持文本正文，type=2 支持链接字段，type=8 支持 HTML。
     * @returns 收藏 ID 与修改时间；其他类型支持元数据编辑。
     */
    editFavorite(cid: string, changes: FavoriteChanges): Promise<Ret<{ cid: string; modify_time: FavoriteInteger }>>;

    /**
     * 删除收藏，单次支持 1~10 项。
     * @param cid 单个收藏 ID 或收藏 ID 列表。
     * @returns 整体 success 与逐项 result；协议请求成功时仍可能存在部分失败。
     */
    deleteFavorite(cid: string | string[]): Promise<Ret<FavoriteItemResults>>;

    /**
     * 获取收藏分组及分组同步信息。
     * @returns 分组列表、数量、同步时间及分组数量上限。
     */
    getFavoriteGroups(): Promise<Ret<FavoriteGetCustomGroupMsgRsp>>;

    /**
     * 增加收藏分组。
     * @param name 非空分组名称。
     * @returns 新分组 ID 与创建时间。
     */
    addFavoriteGroup(name: string): Promise<Ret<{ custom_group_id: number; create_time: number }>>;

    /**
     * 修改收藏分组名称。
     * @param custom_group_id 分组 ID。
     * @param name 新的非空分组名称。
     * @returns 分组修改时间。
     */
    editFavoriteGroup(custom_group_id: number, name: string): Promise<Ret<{ modify_time: number }>>;

    /**
     * 删除收藏分组，单次支持 1~10 项。
     * @param custom_group_id 单个分组 ID 或分组 ID 列表。
     * @returns 删除时间、整体 success 与逐项 result；需检查部分失败。
     */
    deleteFavoriteGroup(custom_group_id: number | number[]): Promise<Ret<FavoriteItemResults & { del_time?: number }>>;

    /**
     * 设置收藏的所属分组，单次支持 1~10 条收藏。
     * @param cid 单个收藏 ID 或收藏 ID 列表。
     * @param custom_group_id 目标分组 ID。
     * @returns 整体 success 与逐项 result；需检查部分失败。
     */
    setFavoriteGroup(cid: string | string[], custom_group_id: number): Promise<Ret<FavoriteItemResults>>;

    /**
     * 获取收藏文件或视频的临时下载地址，需同时使用返回的资源鉴权头。
     * 语音与高清音频存储为内联音频数据，不适用此接口。
     * @param cid 收藏 ID。
     * @param fid 文件 ID；多附件收藏必须指定。
     * @returns 下载链接、文件信息、资源鉴权头及服务端重命名要求。
     */
    getFavoriteFileUrl(cid: string, fid?: string): Promise<Ret<FavoriteDownload>>;

    /**
     * 获取收藏空间使用情况。
     * @returns 空间总量 total_space 与已用量 used_space，单位为字节。
     */
    getFavoriteSpace(): Promise<Ret<{ total_space: FavoriteInteger; used_space: FavoriteInteger }>>;

    /** 进入 QQ 闪传协议接口 */
    acquireFlashTransfer(options?: FlashTransferOptions): FlashTransfer;

    on<T extends keyof EventMap>(event: T, listener: EventMap[T]): this;
    on<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, listener: (this: Client, ...args: any[]) => void): this;

    once<T extends keyof EventMap>(event: T, listener: EventMap[T]): this;
    once<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, listener: (this: Client, ...args: any[]) => void): this;

    prependListener<T extends keyof EventMap>(event: T, listener: EventMap[T]): this;
    prependListener(event: string | symbol, listener: (this: Client, ...args: any[]) => void): this;
    prependOnceListener<T extends keyof EventMap>(event: T, listener: EventMap[T]): this;
    prependOnceListener(event: string | symbol, listener: (this: Client, ...args: any[]) => void): this;

    /**
     * 重载好友列表和群列表
     * 完成之前无法调用任何api，也不会上报任何事件
     */
    reloadFriendList(): Promise<Ret>;
    reloadGroupList(): Promise<Ret>;

    /** @deprecated 该方法已废弃，请直接访问 this.fl */
    getFriendList(): Ret<Client["fl"]>;
    /** @deprecated 该方法已废弃，请直接访问 this.sl */
    getStrangerList(): Ret<Client["sl"]>;
    /** @deprecated 该方法已废弃，请直接访问 this.gl */
    getGroupList(): Ret<Client["gl"]>;
    /** @deprecated 该方法已废弃，参考web-api.md自行获取 */
    getGroupNotice(group_id: number): Promise<Ret<any[]>>;
    /** @deprecated 该方法已废弃，参考web-api.md自行获取 */
    getLevelInfo(user_id?: number): Promise<Ret<any>>;
    /** @deprecated 该方法已废弃，请使用 this.cookies[domain] */
    getCookies(domain?: Domain): Promise<Ret<{ cookies: string }>>;
    /** @deprecated 该方法已废弃，请使用 this.bkn */
    getCsrfToken(): Promise<Ret<{ token: number }>>;
    /** @deprecated 该方法已废弃，请使用 this.stat */
    getStatus(): Ret<Status>;
    /** @deprecated */
    captchaLogin(captcha: string): void;
    /** @deprecated */
    canSendImage(): Ret;
    /** @deprecated */
    canSendRecord(): Ret;
    /** @deprecated */
    getVersionInfo(): Ret<any>;
    /** @deprecated */
    getLoginInfo(): Ret<LoginInfo>;

    //----------以下为隐藏方法，可用于扩展协议----------\\
    /** 发送一个未加密的uni包 */
    sendUni(cmd: string, body: Uint8Array, timeout?: number, options?: SsoOptions): Promise<Buffer>;
    /** 写入一个未加密的uni包 */
    writeUni(cmd: string, body: Buffer, seq?: number, options?: SsoOptions): Promise<void>;
    /** 发送一个未加密的oidb包 */
    sendOidb(cmd: string, body: Uint8Array): Promise<Buffer>;
    /** 发送一个未加密的OidbSvcTrpcTcp包 */
    sendOidbSvcTrpcTcp(cmd: string, body: Uint8Array, useUid?: boolean): Promise<Ret<any>>;
    /** 触发一个oicq标准事件 */
    em(name: string, data?: any): void;
}

/** 工厂方法 */
export function createClient(uin: number, config?: ConfBot): Client;

/**
 * 生成消息元素的快捷函数
 */
export namespace segment {
    /** @deprecated 普通文本 */
    function text(text: string): TextElem;
    /** at */
    function at(qq: number | "all", text?: string, dummy?: boolean): AtElem;
    /** 经典表情 */
    function face(id: number, text?: string): FaceElem;
    /** 小表情 */
    function sface(id: number, text?: string): FaceElem;
    /** 原创表情 */
    function bface(file: string): BfaceElem;
    /** 猜拳 */
    function rps(id?: number): MfaceElem;
    /** 骰子 */
    function dice(id?: number): MfaceElem;
    /** 图片(后三个参数在下载网络图片时有效) */
    function image(file: MediaFile, cache?: boolean, timeout?: number, headers?: OutgoingHttpHeaders): ImgPttElem;
    /** 闪照 */
    function flash(file: MediaFile, cache?: boolean, timeout?: number, headers?: OutgoingHttpHeaders): ImgPttElem;
    /** 语音 */
    function record(file: MediaFile, cache?: boolean, timeout?: number, headers?: OutgoingHttpHeaders): ImgPttElem;
    /** 视频 */
    function video(file: string): VideoElem;
    /** 位置分享 */
    function location(lat: number, lng: number, address: string, id?: string): LocationElem;
    /** 音乐分享 */
    function music(type: MusicType, id: string): MusicElem;
    /** JSON消息 */
    function json(data: any): JsonElem;
    /** XML消息 */
    function xml(data: string, type?: number): XmlElem;
    /** 内容分享 */
    function share(url: string, title: string, image?: string, content?: string): ShareElem;
    /** 窗口抖动 */
    function shake(): ShakeElem;
    /** 戳一戳 */
    function poke(type: number, id?: number): PokeElem;
    /** 引用回复 */
    function reply(id: string): ReplyElem;
    /** 转发节点 */
    function node(id: string): NodeElem;
    /** 匿名 */
    function anonymous(ignore?: boolean): AnonymousElem;
    /** 只有mirai系客户端可以解析的消息 */
    function mirai(data: string): MiraiElem;

    /** 将元素转换到CQ码字符串(CQ码字符串无法逆转换到元素，因为类型会丢失) */
    function toCqcode(elem: MessageElem): string;
    function toCqcode(elems: Iterable<MessageElem>): string;
}

/**
 * 生成CQ码字符串的快捷函数
 */
export namespace cqcode {
    /** @deprecated */
    function text(text: string): string;
    function at(qq: number | "all", text?: string, dummy?: boolean): string;
    function face(id: number, text?: string): string;
    function sface(id: number, text?: string): string;
    function bface(file: string): string;
    function rps(id?: number): string;
    function dice(id?: number): string;
    function image(file: string, cache?: boolean, timeout?: number, headers?: string): string;
    function flash(file: string, cache?: boolean, timeout?: number, headers?: string): string;
    function record(file: string, cache?: boolean, timeout?: number, headers?: string): string;
    function video(file: string): string;
    function location(lat: number, lng: number, address: string, id?: string): string;
    function music(type: MusicType, id: string): string;
    function json(data: string): string;
    function xml(data: string, type?: number): string;
    function share(url: string, title: string, image?: string, content?: string): string;
    function shake(): string;
    function poke(type: number, id?: number): string;
    function reply(id: string): string;
    function node(id: string): string;
    function anonymous(ignore?: boolean): string;
    function mirai(data: string): string;
}

export namespace constants {
    const PLATFORM_ANDROID = 1;
    const PLATFORM_APAD = 2;
    const PLATFORM_WATCH = 3;
    const PLATFORM_IMAC = 4;
    const PLATFORM_IPAD = 5;
    const STATUS_ONLINE = 11;
    const STATUS_ABSENT = 31;
    const STATUS_INVISIBLE = 41;
    const STATUS_BUSY = 50;
    const STATUS_QME = 60;
    const STATUS_NODISTURB = 70;
}

export interface FakeMessage {
    user_id: number,
    message: Sendable, //可转发的有效元素理论上只有[文字、表情、图片]，不支持CQ码
    nickname?: string,
    time?: number, //时间戳(秒)，默认：当前时间
    id?: string, //消息id，用于获取消息气泡，默认不使用气泡
    consistent?: boolean, //是否让消息seq和random与id保持一致，如果id为空则无视，默认：false
    bubble_id?: number, //用于插入消息气泡，可覆盖id获取的气泡，如果id不存在且不指定则不使用气泡
}

export namespace pb {
    function encode(o: Object): Uint8Array;
    function decode(buf: Buffer): import("./lib/ref").Proto;
}

export namespace jce {
    function decode(blob: Buffer): any;
    function decodeNested(blob: Buffer): {[k: number]: any};
    function encode(object: {[k: number]: any}|any[], struct: {[k: string]: number}): Buffer;
    function encodeWrapper(map: Object, extra: {
        version: number,
        pkt_type: number,
        msg_type: number,
        req_id: number,
        service: number,
        method: number,
        payload: number,
        timeout: number,
        context: number,
        status: number,
    }): Buffer;
    function encodeStruct(nested: Object|Array<any>, struct: Object|undefined): Buffer;
    function encodeNested(nested: {[k: number]: any}|any[], struct: {[k: string]: number}): any;
}
