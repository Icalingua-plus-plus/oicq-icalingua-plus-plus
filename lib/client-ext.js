/**
 * 扩展Client类
 */
"use strict";

const { randomBytes } = require("crypto");
const { Client } = require("./client");
const tea = require("./algo/tea");
const pb = require("./algo/pb");
const { timestamp, uin2code, BUF16, BUF0, log } = require("./common");
const { TimeoutError } = require("./exception");
const { parseC2CMsg } = require("./message/parser");
const Writer = require("./wtlogin/writer");
const { buildUrl, getCommonParams, qsignGet, qsignPost, executeWithRetry, sleep } = require("./qsign-api");

const localSigners = new Map();
const supportsLocalSigner = Number(process.versions.node.split(".")[0]) >= 16;
const whitelist_920 = [
    "MessageSvc.PbSendMsg",
    "trpc.o3.ecdh_access.EcdhAccess.SsoEstablishShareKey",
    "trpc.o3.ecdh_access.EcdhAccess.SsoSecureAccess",
    "trpc.o3.ecdh_access.EcdhAccess.SsoSecureA2Access",
    "trpc.o3.ecdh_access.EcdhAccess.SsoSecureA2Establish",
    "trpc.o3.report.Report.SsoReport",
    "wtlogin.login",
    "wtlogin.trans_emp",
    "wtlogin.exchange_emp",
    "wtlogin.name2uin",
    "OidbSvcTrpcTcp.0x55f_0",
    "OidbSvc.0x758",
    "OidbSvc.0x758_0",
    "OidbSvc.0x758_1",
    "OidbSvc.oidb_0x758",
    "friendlist.AddFriendReq",
    "OidbSvc.0x8a1_0",
    "OidbSvc.0x8a1_7",
    "OidbSvc.0x89a_0",
    "OidbSvc.0x88d_0",
    "ProfileService.Pb.ReqSystemMsgAction.Group",
    "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.PublishFeed",
    "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoLike",
    "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoFollow",
    "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoComment",
    "SQQzoneSvc.publishmood",
    "SQQzoneSvc.shuoshuo",
    "SQQzoneSvc.like",
    "SQQzoneSvc.addComment",
    "SQQzoneSvc.addReply",
    "SQQzoneSvc.forward",
    "OidbSvc.0x4ff_9",
    "QChannelSvr.trpc.qchannel.commwriter.ComWriter.PublishFeed",
    "OidbSvcTrpcTcp.0x1100_1",
    "QChannelSvr.trpc.qchannel.commwriter.ComWriter.DoComment",
    "QChannelSvr.trpc.qchannel.commwriter.ComWriter.DoReply",
    "OidbSvcTrpcTcp.0x1107_1",
    "OidbSvcTrpcTcp.0x1105_1",
    "OidbSvcTrpcTcp.0xf88_1",
    "OidbSvcTrpcTcp.0xf89_1",
    "OidbSvcTrpcTcp.0xf57_1",
    "OidbSvcTrpcTcp.0xf57_106",
    "OidbSvcTrpcTcp.0xf57_9",
    "OidbSvcTrpcTcp.0xf55_1",
    "OidbSvcTrpcTcp.0xf67_1",
    "OidbSvcTrpcTcp.0xf67_5",
    "trpc.qlive.relationchain_svr.RelationchainSvr.Follow",
    "trpc.qlive.word_svr.WordSvr.NewPublicChat",
    "ProfileService.GroupMngReq",
    "ProfileService.getGroupInfoReq",
    "FeedCloudSvr.trpc.videocircle.circleprofile.CircleProfile.SetProfile",
    "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoPush",
    "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoReply",
    "FeedCloudSvr.trpc.feedcloud.commwriter.ComWriter.DoBarrage",
    "friendlist.addFriend",
    "OidbSvc.0x4ff_9_IMCore",
    "trpc.springfestival.redpacket.LuckyBag.SsoSubmitGrade",
    "trpc.qqhb.qqhb_proxy.Handler.sso_handle",
    "wtlogin.register",
    "wtlogin.qrlogin",
    "wtlogin.device_lock",
    "OidbSvc.0x8ba",
    "OidbSvc.0x89b_1",
    "OidbSvc.0x9fa",
    "OidbSvc.0x56c_6",
    "qidianservice.269",
    "qidianservice.207",
    "qidianservice.290",
    "qidianservice.135",
    "friendlist.ModifyGroupInfoReq",
    "trpc.group_pro.msgproxy.sendmsg",
    "OidbSvcTrpcTcp.0x101e_1",
    "OidbSvcTrpcTcp.0x101e_2",
    "OidbSvcTrpcTcp.0xfa5_1",
    "OidbSvcTrpcTcp.0xf65_1",
    "OidbSvcTrpcTcp.0xf65_10",
    "OidbSvcTrpcTcp.0xf6e_1",
    "OidbSvcTrpcTcp.0x1102_1",
    "ConnAuthSvr.fast_qq_login",
    "ConnAuthSvr.sdk_auth_api",
    "ConnAuthSvr.sdk_auth_api_emp",
    "MsgProxy.SendMsg",
    "trpc.login.ecdh.EcdhService.SsoNTLoginPasswordLoginUnusualDevice",
    "trpc.passwd.manager.PasswdManager.SetPasswd",
    "trpc.passwd.manager.PasswdManager.VerifyPasswd",
    "wtlogin_device.login",
    "wtlogin_device.tran_sim_emp",
    "OidbSvcTrpcTcp.0x6d9_4",
    "OidbSvc.0x6d9_4",
    "trpc.login.ecdh.EcdhService.SsoQRLoginGenQr",
    "QQConnectLogin.get_promote_page",
    "QQConnectLogin.get_promote_page_emp",
    "QQConnectLogin.submit_promote_page",
    "QQConnectLogin.submit_promote_page_emp",
    "QQConnectLogin.pre_auth",
    "QQConnectLogin.pre_auth_emp",
    "ConnAuthSvr.get_app_info",
    "ConnAuthSvr.get_app_info_emp",
    "QQConnectLogin.auth",
    "QQConnectLogin.auth_emp",
    "ConnAuthSvr.get_auth_api_list",
    "ConnAuthSvr.get_auth_api_list_emp",
    "trpc.commercial.dataworks.UserActionReport_sso.SsoReport",
    "trpc.lplan.user_manager_svr.User.SsoSetProfile",
    "trpc.lplan.feed_svr.StatusWrite.SsoComment",
    "trpc.lplan.feed_svr.StatusWrite.SsoReply",
    "trpc.lplan.feed_svr.StatusWrite.SsoPostStatus",
    "trpc.lplan.like_svr.Like.SsoDoLike",
    "trpc.lplan.map_svr.Map.SsoReportLocation",
    "trpc.qmeta.mob_proxy_svr.MobProxy.SsoHandle",
    "QQStranger.login_svr.SsoLoginInfoReport",
    "QQStranger.UserInfo.SsoSetMiniUserInfo",
    "QQStranger.FeedPlazaSvr.SsoFeedPublish",
    "QQStranger.InteractiveMsgSvr.SsoSendInterMsg",
    "trpc.qqstranger.common_proxy.CommonProxy.SsoHandle",
    "QQStranger.FeedSvr.SsoFeedPublish",
    "OidbSvcTrpcTcp.0x9176_1",
    "LightAppSvc.mini_app_userapp.GetDropdownAppList",
    "OidbSvcTrpcTcp.0xfd4_1",
    "OidbSvc.0xb3c_add",
    "OidbSvc.0xb3c_get_undone",
    "OidbSvc.0xb3c_get_done",
    "OidbSvc.0xb3c_get_by_id",
    "OidbSvc.0xb3c_update",
    "OidbSvc.0xb3c_delete",
    "OidbSvc.0xb3c_share",
    "OidbSvc.0xb3c_get_done_count",
    "OidbSvc.0xb3c",
    "OidbSvc.0xb3c_1",
    "OidbSvc.0xb3c_2",
    "OidbSvc.0xb3c_3",
    "OidbSvc.0xb3c_4",
    "OidbSvc.0xb3c_5",
    "OidbSvc.0xb3c_6",
    "OidbSvc.0xb3c_7",
    "OidbSvc.0xb3c_8",
    "OidbSvc.0x592",
    "OidbSvc.0x592_1",
    "OidbSvc.0x592_2",
    "OidbSvc.0x592_3",
    "OidbSvc.0x592_4",
    "OidbSvc.0x592_5",
    "OidbSvc.0x592_6",
    "OidbSvc.0x592_7",
    "OidbSvc.0x592_8",
    "OidbSvc.0x592_9",
    "OidbSvc.0x592_10",
    "OidbSvc.0x592_11",
    "OidbSvc.0x592_12",
    "OidbSvc.0x592_19",
    "OidbSvc.0x592_13",
    "OidbSvc.0x592_15",
    "OidbSvc.0x592_16",
    "OidbSvc.0x592_17",
    "OidbSvc.0x592_18",
    "OidbSvc.0xb3c_update_5",
    "OidbSvcTrpcTcp.0x8a1_7",
    "OidbSvcTrpcTcp.0x11ec_1",
    "OidbSvcTrpcTcp.0x758_1",
    "OidbSvcTrpcTcp.0x7c2_5",
    "OidbSvcTrpcTcp.0x10db_1",
    "trpc.qpay.midas_order.Order.SsoMakeOrder",
    "trpc.qpay.red_pack_skin.Skin.SsoAddSkin",
    "trpc.qpay.sso.web.Do",
    "WalletGestureSvc.GetPassword",
    "WalletGestureSvc.GetSignV2",
    "WalletGestureSvc.SetPassword",
    "trpc.qpay.encryptedtransfer.Encryption.SsoUINEncrypt",
    "trpc.qlive.qlive_proxy_svr.TrpcProxy.*",
    "trpc.down.intercept.Intercept.SsoGetInterceptFile",
    "trpc.down.intercept.Intercept.SsoGetDownloadTips",
    "trpc.down.joint_operation_game_intercept.JointOperationGameIntercept.SsoCheck",
    "trpc.down.joint_operation_game_intercept.JointOperationGameIntercept.SsoQueryConfig",
    "OidbSvcTrpcTcp.0x92e4_0",
    "miniapp.trpc.minigame.sdk_qgroup_svr.sdk_qgroup_svr.JoinGroup",
    "gcbindgroupsso.get_appid",
    "gcbindgroupsso.unbind_group",
    "GDCTrpcProxy.service",
    "GDCTrpcProxy.down",
    "OidbSvcTrpcTcp.0x930d_0",
    "OidbSvcTrpcTcp.0x92eb_0",
    "OidbSvcTrpcTcp.0x930e_0",
    "MQUpdateSvc_com_qq_qzone_act.web.OidbSvcTrpcJsapiTcp.0x9377_0",
    "OidbSvc.0xcd5",
    "OidbSvcTrpcTcp.0xcd5",
    "trpc.login.ecdh.EcdhService.SsoNTLoginPasswordLogin",
    "trpc.login.ecdh.EcdhService.SsoNTLoginGetSaltList",
    "trpc.login.ecdh.EcdhService.SsoNTLoginCheckA1List",
    "trpc.login.ecdh.EcdhService.SsoNTLoginAuthNewDevice",
    "trpc.login.ecdh.EcdhService.SsoNTLoginRefreshTicket",
    "trpc.login.ecdh.EcdhService.SsoNTLoginOptimusLogin",
    "trpc.login.ecdh.EcdhService.SsoNTLoginCheckGateWayCode",
    "trpc.login.ecdh.EcdhService.SsoNTLoginCheckThirdCode",
    "trpc.login.ecdh.EcdhService.SsoNTLoginGetSms",
    "trpc.login.ecdh.EcdhService.SsoNTLoginCheckSms",
    "trpc.login.ecdh.EcdhService.SsoOIDB0x916a",
    "trpc.login.ecdh.EcdhService.SsoOIDB0x916b",
    "trpc.login.ecdh.EcdhService.SsoOIDB0x916c",
    "trpc.login.ecdh.EcdhService.SsoOIDB0x916d",
    "trpc.login.ecdh.EcdhService.SsoNTLoginRapidLogin",
    "trpc.login.ecdh.EcdhService.SsoNTLoginRefreshA2",
    "trpc.login.ecdh.EcdhService.SsoKeyExchange",
    "trpc.login.ecdh.EcdhService.SsoQRLoginAuthQr",
    "trpc.login.ecdh.EcdhService.SsoQRLoginRejectQr",
    "trpc.login.ecdh.EcdhService.SsoQRLoginCancleQr",
    "OidbSvcTrpcTcp.0x91b6_1",
    "OidbSvc.0xb77_9",
    "OidbSvc.0xb77_48",
    "OidbSvc.0xb77_46",
    "OidbSvc.0xb77_34",
    "OidbSvc.0xdc2_9",
    "OidbSvc.0xdc2_34",
    "OidbSvcTrpcTcp.0x10c8_2",
    "OidbSvcTrpcTcp.0x9144_1",
    "OidbSvcTrpcTcp.0x911a_19",
    "OidbSvcTrpcTcp.0x911a_22",
    "MQUpdateSvc_com_qq_ti.web.OidbSvcTrpcJsapiTcp.0x9047_0",
    "OidbSvcTrpcTcp.0x93d7_1",
    "OidbSvcTRPCTcp.0xf67_1",
    "OidbSvcTRPCTcp.0x758_1",
    "OidbSvcTrpcTcp.0xb77_57",
    "OidbSvcTrpcTcp.0x9076_1",
    "OidbSvcTrpcTcp.0x9078_1",
    "OidbSvcTrpcTcp.0x112e_1",
    "AvatarInfoSvr.QQHeadUrlReq",
    "CertifiedAccountSvc.certified_account_read.GetFollowList",
    "FeedCloudSvr.trpc.circlesearch.exhibition.ExhibitionSvr.ExhibitionSuggestion",
    "FeedCloudSvr.trpc.feedcloud.commreader.ComReader.GetBusiInfo",
    "FeedCloudSvr.trpc.feedcloud.commreader.ComReader.GetCommentList",
    "FeedCloudSvr.trpc.feedcloud.commreader.ComReader.GetFeedList",
    "FeedCloudSvr.trpc.feedcloud.commreader.ComReader.GetMainPageBasicData",
    "FeedCloudSvr.trpc.feedcloud.commreader.ComReader.GetMainPageCommData",
    "FeedCloudSvr.trpc.feedcloud.commreader.ComReader.GetRelationGroupList",
    "FeedCloudSvr.trpc.feedcloud.commreader.ComReader.GetReplyList",
    "FeedCloudSvr.trpc.feedcloud.commreader.ComReader.GetRerankedFeedList",
    "GameCenterMsg.GetUserInfo",
    "IncreaseURLSvr.QQHeadUrlReq",
    "LightAppSvc.mini_app_cloudstorage.GetUserCloudStorage",
    "LightAppSvc.mini_app_privacy.GetPrivacyInfo",
    "MessageSvc.PbBindUinGetMsg",
    "MessageSvc.PbGetGroupMsg",
    "MessageSvc.PbGetMsg",
    "MessageSvc.PbGetRoamMsg",
    "NowSummaryCard.NearbyMiniCardReq",
    "OidbSvc.0x42d",
    "OidbSvc.0x42d_4",
    "OidbSvc.0x480_9",
    "OidbSvc.0x480_9_IMCore",
    "OidbSvc.0x515_2",
    "OidbSvc.0x53c_2",
    "OidbSvc.0x570_8",
    "OidbSvc.0x580_1",
    "OidbSvc.0x587_123",
    "OidbSvc.0x587_normalNightSet",
    "OidbSvc.0x58b",
    "OidbSvc.0x5d0_1",
    "OidbSvc.0x5eb_15",
    "OidbSvc.0x5eb_22",
    "OidbSvc.0x5eb_42073",
    "OidbSvc.0x5eb_42261",
    "OidbSvc.0x5eb_43",
    "OidbSvc.0x5eb_96",
    "OidbSvc.0x5eb_99",
    "OidbSvc.0x5eb_ForTheme",
    "OidbSvc.0x5eb_cn_switch",
    "OidbSvc.0x5eb_common",
    "OidbSvc.0x6d6_0",
    "OidbSvc.0x6d6_2",
    "OidbSvc.0x6d6_3",
    "OidbSvc.0x6d7_0",
    "OidbSvc.0x787_0",
    "OidbSvc.0x787_1",
    "OidbSvc.0x787_11",
    "OidbSvc.0x7a2_0",
    "OidbSvc.0x7df_3",
    "OidbSvc.0x852_35",
    "OidbSvc.0x852_48",
    "OidbSvc.0x88d_1",
    "OidbSvc.0x88d_1_2",
    "OidbSvc.0x88d_7",
    "OidbSvc.0x899_0",
    "OidbSvc.0x899_9",
    "OidbSvc.0x8a0_0",
    "OidbSvc.0x8a4",
    "OidbSvc.0x8f1",
    "OidbSvc.0xbbb",
    "OidbSvc.0xbcb",
    "OidbSvc.0xbe8",
    "OidbSvc.0xc26_0",
    "OidbSvc.0xc33_42220",
    "OidbSvc.0xc6b",
    "OidbSvc.0xcdd",
    "OidbSvc.0xe27",
    "OidbSvc.0xe3e",
    "OidbSvc.0xe61",
    "OidbSvc.0xe63_1",
    "OidbSvc.0xe72",
    "OidbSvc.0xef0_1",
    "OidbSvc.0xf7e_1",
    "OidbSvcTcp.0x102a",
    "OidbSvcTcp.0x88d_0",
    "OidbSvcTcp.0x88d_1",
    "OidbSvcTcp.0xef0_1",
    "OidbSvcTrpcTcp.0x1017_1",
    "OidbSvcTrpcTcp.0x105b_1",
    "OidbSvcTrpcTcp.0x10c0_1",
    "OidbSvcTrpcTcp.0x10c0_2",
    "OidbSvcTrpcTcp.0x10c8_1",
    "OidbSvcTrpcTcp.0x10d8_1",
    "OidbSvcTrpcTcp.0x10ed_1",
    "OidbSvcTrpcTcp.0x10f4_1",
    "OidbSvcTrpcTcp.0x110d_1",
    "OidbSvcTrpcTcp.0x1130_1",
    "OidbSvcTrpcTcp.0x116c_1",
    "OidbSvcTrpcTcp.0x116d_1",
    "OidbSvcTrpcTcp.0x1194_1",
    "OidbSvcTrpcTcp.0x11c4_100",
    "OidbSvcTrpcTcp.0x11c4_200",
    "OidbSvcTrpcTcp.0x11c5_100",
    "OidbSvcTrpcTcp.0x11c5_200",
    "OidbSvcTrpcTcp.0x11e9_100",
    "OidbSvcTrpcTcp.0x11e9_200",
    "OidbSvcTrpcTcp.0x11ea_200",
    "OidbSvcTrpcTcp.0x1224_0",
    "OidbSvcTrpcTcp.0x1225_0",
    "OidbSvcTrpcTcp.0x1250_0",
    "OidbSvcTrpcTcp.0x1258_1",
    "OidbSvcTrpcTcp.0x125b_500",
    "OidbSvcTrpcTcp.0x1262_19",
    "OidbSvcTrpcTcp.0x126d_200",
    "OidbSvcTrpcTcp.0x126e_200",
    "OidbSvcTrpcTcp.0x127a_0",
    "OidbSvcTrpcTcp.0x1289_1",
    "OidbSvcTrpcTcp.0x12a9_200",
    "OidbSvcTrpcTcp.0x5cf_11",
    "OidbSvcTrpcTcp.0x644_1",
    "OidbSvcTrpcTcp.0x6d6_2",
    "OidbSvcTrpcTcp.0x6d6_3",
    "OidbSvcTrpcTcp.0x6d9_2",
    "OidbSvcTrpcTcp.0x787_1",
    "OidbSvcTrpcTcp.0x88d_111",
    "OidbSvcTrpcTcp.0x899_0",
    "OidbSvcTrpcTcp.0x899_1",
    "OidbSvcTrpcTcp.0x899_9",
    "OidbSvcTrpcTcp.0x8f9_14",
    "OidbSvcTrpcTcp.0x8fc_3",
    "OidbSvcTrpcTcp.0x901f_1",
    "OidbSvcTrpcTcp.0x902e_1",
    "OidbSvcTrpcTcp.0x9124_0",
    "OidbSvcTrpcTcp.0x9127_1",
    "OidbSvcTrpcTcp.0x972_6",
    "OidbSvcTrpcTcp.0x9a2_12",
    "OidbSvcTrpcTcp.0xa80_1",
    "OidbSvcTrpcTcp.0xaf6_0",
    "OidbSvcTrpcTcp.0xe37_1200",
    "OidbSvcTrpcTcp.0xe37_1700",
    "OidbSvcTrpcTcp.0xe37_700",
    "OidbSvcTrpcTcp.0xe37_800",
    "OidbSvcTrpcTcp.0xf59_2",
    "OidbSvcTrpcTcp.0xf5b_1",
    "OidbSvcTrpcTcp.0xf5d_1",
    "OidbSvcTrpcTcp.0xf5d_11",
    "OidbSvcTrpcTcp.0xfe1",
    "OidbSvcTrpcTcp.0xfe1_2",
    "OidbSvcTrpcTcp.0xfe1_8",
    "OidbSvcTrpcTcp.0xfe5_2",
    "OidbSvcTrpcTcp.0xfe7_2",
    "OidbSvcTrpcTcp.0xfe7_3",
    "OidbSvcTrpcTcp.0xfe7_4",
    "OidbSvc_device.0x633",
    "OidbSvc_device.0x9f5",
    "PbMessageSvc.PbUnReadMsgSeq",
    "ProfileService.SimpleInfo",
    "PushService.settoken",
    "QChannelSvr.trpc.qchannel.commreader.ComReader.BatchGetFeedDetail",
    "QQRTCSvc.RoomManager-GetRoomInfo",
    "QQStranger.UserInfo.SsoBatchGetMiniUserInfo",
    "QQStranger.UserInfo.SsoGetMiniUserInfo",
    "QSec.AVEng",
    "ResourceConfig.ClientReq",
    "ResourceConfig.GetResourceReq",
    "SQQzoneSvc.Custom.getFacade",
    "SQQzoneSvc.GetCate",
    "SQQzoneSvc.get",
    "SQQzoneSvc.getAIONewestFeeds",
    "SQQzoneSvc.getActiveFeeds",
    "SQQzoneSvc.getPhotoComment",
    "SQQzoneSvc.getPhotoWall",
    "SQQzoneSvc.getProfile",
    "SQQzoneSvc.getProfileFeeds",
    "SQQzoneSvc.getVisitorNotify",
    "SQQzoneSvc.get_all_feedsphoto_ex",
    "SQQzoneSvc.mobileqboss.get",
    "SQQzoneSvc.photo",
    "SQQzoneSvc.preGetPassiveFeeds",
    "SecuritySvc.GetConfig",
    "SsoSnsSession.Cmd0x3_SubCmd0x1_FuncGetBlockList",
    "StatSvc.GetOnlineStatus",
    "StatSvc.register",
    "SummaryCard.ReqSummaryCard",
    "VisitorSvc.ReqFavorite",
    "account.RequestQueryQQMobileContactsV3",
    "friendlist.GetFriendListReq",
    "friendlist.GetLastLoginInfoReq",
    "friendlist.GetMultiTroopInfoReq",
    "friendlist.GetSimpleOnlineFriendInfoReq",
    "friendlist.GetTroopAppointRemarkReq",
    "friendlist.GetTroopListReqV2",
    "friendlist.GetTroopMemberList",
    "friendlist.GetTroopMemberListReq",
    "friendlist.getFriendGroupList",
    "friendlist.getTroopMemberList",
    "group_member_card.get_group_member_card_info",
    "group_member_statistic.get_group_member_statistic",
    "oidb_0x42e_3",
    "oidb_0x43c_4",
    "oidb_0x43c_5",
    "oidb_0x5d0_1",
    "oidb_0x5d6_19",
    "oidb_0x5d6_21",
    "oidb_0x7a2_0",
    "oidb_0x7c4_0",
    "oidb_0x7df_3",
    "oidb_0x9045_1",
    "oidb_0x9072_0",
    "oidb_0xcf3_0",
    "oidb_0xcf4_0",
    "oidb_0xd9c_11",
    "oidb_0xdc2_34",
    "oidb_0xe37_1200",
    "oidb_0xe37_800",
    "oidb_0xe61_1",
    "oidb_0xe8c_0",
    "oidb_0xeb1_1",
    "oidb_0xf7e_1",
    "oidb_0xfd4_1",
    "qzoneh5.h5.wnshtml",
    "trpc.QQService.CommonLogic.StatusService.SsoGetLikeList",
    "trpc.g_qqrtc.qq_mav_room_state_read.GetRoomState.SsoGetInfoByUin",
    "trpc.msg.msg_svc.MsgService.SsoGetPeerSeq",
    "trpc.msg.register_proxy.RegisterProxy.PushParams",
    "trpc.qqva.vipdata.Vipdata.SsoGetUserData",
    "SQQzoneSvc.getMainPage",
    "trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg",
    "OidbSvcTrpcTcp.0x89a_0",
    "OidbSvcTrpcTcp.0x88d_0",
    "OidbSvcTrpcTcp.0x88d_14",
    "OidbSvcTrpcTcp.0x102a_0",
    "OidbSvcTrpcTcp.0x102a_1",
    "OidbSvcTrpcTcp.0x1092_0",
    "OidbSvcTrpcTcp.0x121e_0",
    "trpc.msg.register_proxy.RegisterProxy.SsoInfoSync",
    "OidbSvcTrpcTcp.0xfc9_1",
    "SQQzoneSvc.getUndealCount",
    "RegPrxySvc.infoSync",
    "ProfileService.Pb.ReqSystemMsgNew.Group",
    "StatSvc.SimpleGet",
    "trpc.group_pro.synclogic.SyncLogic.SyncFirstView",
    "RegPrxySvc.infoLogin",
    "OidbSvcTrpcTcp.0x9a2_8",
    "OidbSvc.0x59f",
    "OidbSvcTrpcTcp.0xf59_1",
    "StatSvc.SetStatusFromClient",
    "StatSvc.GetDevLoginInfo",
    "PubAccountSvc.get_follow_list",
    "OidbSvc.0x6de",
    "trpc.qq_new_tech.status_svc.StatusService.Register",
    "OidbSvc.0x8a8",
    "OidbSvcTrpcTcp.0x123c_1",
    "OidbSvcTrpcTcp.0x1277_0",
    "OidbSvcTrpcTcp.0xfe4_2",
    "LightAppSvc.mini_app_userapp.GetDropdownAppList",
    "OidbSvcTrpcTcp.0xfd4_1"
];

function usesLocalSigner(client) {
    return supportsLocalSigner && client.apk.ver === "9.2.0" && !client.config.sign_api_addr;
}

async function getLocalSigner(client) {
    const guid = Buffer.isBuffer(client.device.guid) || client.device.guid instanceof Uint8Array
        ? Buffer.from(client.device.guid).toString("hex")
        : String(client.device.guid).toLowerCase();
    const key = `${client.uin}:${String(client.device.android_id).toLowerCase()}:${guid}`;
    let pending = localSigners.get(key);
    if (!pending) {
        const signer = require("./signer").createSigningSystem();
        pending = Promise.resolve().then(async () => {
            await signer.register({
                uin: client.uin,
                androidid: client.device.android_id,
                guid: client.device.guid,
                qua: client.apk.qua,
                client,
            });
            return signer;
        });
        localSigners.set(key, pending);
        pending.catch(() => {
            if (localSigners.get(key) === pending) localSigners.delete(key);
            if (typeof signer.close === "function") {
                Promise.resolve().then(() => signer.close()).catch(() => {});
            }
        });
    }
    return pending;
}

/**
 * seqid递增并返回
 */
Client.prototype.nextSeq = function() {
    if (++this.seq_id >= 0x8000)
        this.seq_id = 1145 + Math.round(Math.random() * 1419);
    return this.seq_id;
};

const ERROR_TIMEOUT = new TimeoutError("package timeout");

const allowedCallbackCmds = [
    "trpc.o3.ecdh_access.EcdhAccess.SsoEstablishShareKey",
    "trpc.o3.ecdh_access.EcdhAccess.SsoSecureA2Access",
    "trpc.o3.ecdh_access.EcdhAccess.SsoSecureA2Establish",
    "trpc.o3.ecdh_access.EcdhAccess.SsoSecureAccess",
    //"trpc.o3.report.Report.SsoReport",
];

/**
 * 发送一个包并返回响应包
 */
Client.prototype.send = function (packet, timeout = 5, seq_id = this.seq_id) {
    ++this.stat.sent_pkt_cnt;
    return new Promise((resolve, reject) => {
        this._socket.write(packet, () => {
            const id = setTimeout(() => {
                this.handlers.delete(seq_id);
                ++this.stat.lost_pkt_cnt;
                reject(ERROR_TIMEOUT);
            }, timeout * 1000);
            this.handlers.set(seq_id, (data, error) => {
                clearTimeout(id);
                this.handlers.delete(seq_id);
                if (error) return reject(error);
                resolve(data);
            });
        });
    });
};

/**
 * 发送一个uni包
 * 除login包之外都是uni包，以0x0b开头
 * login包以0x0a开头
 */
Client.prototype.writeUni = async function (cmd, body, seq = 0, options = {}) {
    ++this.stat.sent_pkt_cnt;
    const packet = await this._buildUniPacket(cmd, body, seq, options);
    this._socket.write(packet);
};

/**
 * 发送一个uni包并返回响应包
 */
Client.prototype.sendUni = async function (cmd, body, timeout = 5, options = {}) {
    const seq = this.nextSeq();
    const packet = await this._buildUniPacket(cmd, body, seq, options);
    return this.send(packet, timeout, seq);
};

/**
 * 发送一个oidb包并返回响应包
 * 是uni包的一个封装
 */
Client.prototype.sendOidb = function (cmd, body) {
    const sp = cmd //OidbSvc.0x568_22
        .replace("OidbSvc.", "")
        .replace("oidb_", "")
        .split("_");
    const type1 = parseInt(sp[0], 16),
        type2 = parseInt(sp[1]);
    body = pb.encode({
        1: type1,
        2: isNaN(type2) ? 1 : type2,
        3: 0,
        4: body,
        6: "android " + this.apk.ver,
    });
    return this.sendUni(cmd, body);
};

/**
 * 发送一个OidbSvcTrpcTcp包并返回响应数据
 * 是uni包的一个封装
 */
Client.prototype.sendOidbSvcTrpcTcp = async function (cmd, body, useUid = false) {
	const sp = cmd //OidbSvcTrpcTcp.0xf5b_1
		.replace("OidbSvcTrpcTcp.", "")
		.split("_");
	const type1 = parseInt(sp[0], 16), type2 = parseInt(sp[1]);
    body = pb.encode({
        1: type1,
        2: isNaN(type2) ? 1 : type2,
        4: body,
        12: 0,
    });
    const options = useUid ? { trace_parent: true, nt_core: true } : { };
    const seq = this.nextSeq();
    const packet = await this._buildUniPacket(cmd, body, seq, options);
    const payload = await this.send(packet, 5, seq);
    const rsp = pb.decode(payload);
    if (rsp[3] === 0) return rsp[4];
    throw new Error(`${rsp[5]} (${rsp[3]})`);
};

/**
 * 构造一个uni包
 * @param {string} cmd 
 * @param {Buffer} body 
 * @param {number} seq
 * @param {import("./ref").SsoOptions} options
 */
Client.prototype._buildUniPacket = async function (cmd, body, seq = 0, options = {}) {
    seq = seq ? seq : this.nextSeq();
    const startTime = Date.now();
    const reserveFields = await this.buildSSOReserveField(cmd, Buffer.from(body), seq, options);
    const costTime = Date.now() - startTime;
    this.logger.trace(`send:${cmd} seq:${seq} signCost:${costTime}ms`);
    const type = cmd === "wtlogin.exchange_emp" ? 2 : 1;
 
    let len = cmd.length + 20;
    let sso = new Writer()
        .writeWithLength(cmd)
        .writeWithLength(this._wt.session_id)
        .writeWithLength(reserveFields)
        .read();
    sso = new Writer().writeWithLength(sso).writeWithLength(body).read();
 
    const encrypted = tea.encrypt(sso, type === 1 ? this.sig.d2key : BUF16);
    const uin = String(this.uin);
    len = encrypted.length + uin.length + 18;
    const pkt = Buffer.allocUnsafe(len);
    pkt.writeUInt32BE(len, 0);
    pkt.writeUInt32BE(0x0B, 4);
    pkt.writeUInt8(type, 8);
    pkt.writeInt32BE(seq, 9);
    pkt.writeUInt8(0, 13);
    pkt.writeUInt32BE(uin.length + 4, 14);
    pkt.fill(uin, 18);
    pkt.fill(encrypted, uin.length + 18);
    return pkt;
}

/**
 * 构造事件共通属性
 */
Client.prototype.parseEventType = function (name = "") {
    const slice = name.split(".");
    const post_type = slice[0], sub_type = slice[2];
    const data = {
        self_id: this.uin,
        time: timestamp(),
        post_type: post_type,
    };
    const type_name = slice[0] + "_type";
    data[type_name] = slice[1];
    if (sub_type)
        data.sub_type = sub_type;
    return data;
};

/**
 * 触发事件
 */
Client.prototype.em = function (name = "", data = {}) {
    data = Object.assign(this.parseEventType(name), data);
    while (true) {
        this.emit(name, data);
        let i = name.lastIndexOf(".");
        if (i === -1)
            break;
        name = name.slice(0, i);
    }
};

/**
 * 用于消息去重和数据统计
 */
Client.prototype.msgExists = function (from, type, seq, time) {
    if (timestamp() + this.sig.time_diff - time >= 60 || time < this.stat.start_time)
        return true;
    const id = [from, type, seq].join("-");
    const set = this.seq_cache.get(time);
    if (!set) {
        this.seq_cache.set(time, new Set([id]));
        return false;
    } else {
        if (set.has(id))
            return true;
        else
            set.add(id);
        return false;
    }
};

/**
 * 构造私聊消息cookie
 */
Client.prototype.buildSyncCookie = function () {
    const time = timestamp();
    return pb.encode({
        1: time,
        2: time,
        3: this.const1,
        4: this.const2,
        5: randomBytes(4).readUInt32BE(),
        9: randomBytes(4).readUInt32BE(),
        11: randomBytes(4).readUInt32BE(),
        12: this.const3,
        13: time,
        14: 0,
    });
};

/**
 * 消息同步
 */
Client.prototype.pbGetMsg = async function (force = false, flag = 0, count = 10) {
    if (this.config.useNT) return true;
    if (count <= 0)  {
        this.sync_cookie = null;
        return true;
    }
    if (!this.sync_cookie)
        this.sync_cookie = this.buildSyncCookie();
    let body = pb.encode({
        1: flag,
        2: this.sync_cookie,
        3: 0,
        4: 20,
        5: 3,
        6: 1,
        7: 1,
        9: 1,
    });
    try {
        const blob = await this.sendUni("MessageSvc.PbGetMsg", body);
        const rsp = pb.decode(blob);
        if (rsp[3])
            this.sync_cookie = rsp[3].toBuffer();
        if (rsp[1] !== 0) {
            // 同步爆炸了
            this.logger.warn(`消息同步失败, code: ${rsp[1]}, msg: ${rsp[2]}`);
            await sleep(1000 + Math.floor(Math.random() * 500));
            this.sync_cookie = this.buildSyncCookie();
            return await this.pbGetMsg(force);
        }
        if (rsp[1] > 0 || !rsp[5])
            return true;
        const items = [];
        if (!Array.isArray(rsp[5]))
            rsp[5] = [rsp[5]];
        for (let v of rsp[5]) {
            if (!v[4]) continue;
            if (!Array.isArray(v[4]))
                v[4] = [v[4]];
            for (let msg of v[4]) {
                const head = msg[1];
                const type = head[3];
                const item = { ...head };
                item[3] = 187;
                items.push(item);
                if (!this.sync_finished)
                    continue;
                let from_uin = head[1], to_uin = head[2];
                if (from_uin === this.uin && from_uin !== to_uin)
                    continue;
                if (![33, 38, 85, 141, 166, 167, 208, 529].includes(type))
                    continue;
                if (this.msgExists(from_uin, type, head[5], head[6]))
                    continue;

                //群员入群
                if (type === 33) {
                    (async () => {
                        const group_id = uin2code(from_uin);
                        const user_id = head[15];
                        const nickname = String(head[16]);
                        const ginfo = (await this.getGroupInfo(group_id)).data;
                        if (!ginfo) return;
                        if (user_id === this.uin) {
                            this.logger.info(`更新了群列表，新增了群：${group_id}`);
                        } else {
                            ginfo.member_count++;
                            ginfo.last_join_time = timestamp();
                            await this.getGroupMemberInfo(group_id, user_id);
                            try {
                                if (this.gml.get(group_id).size)
                                    ginfo.member_count = this.gml.get(group_id).size;
                            } catch { }
                            this.logger.info(`${user_id}(${nickname}) 加入了群 ${group_id}`);
                        }
                        this.getGroupMemberList(group_id, true);
                        this.em("notice.group.increase", {
                            group_id, user_id, nickname
                        });
                    })();
                }

                //被管理批准入群，建群
                else if (type === 85 || type === 38) {
                    (async () => {
                        const group_id = uin2code(from_uin);
                        const user_id = this.uin;
                        const nickname = this.nickname;
                        const ginfo = (await this.getGroupInfo(group_id)).data;
                        if (!ginfo) return;
                        if (user_id === this.uin) {
                            this.logger.info(`更新了群列表，新增了群：${group_id}`);
                            this.getGroupMemberList(group_id);
                        }
                        this.em("notice.group.increase", {
                            group_id, user_id, nickname
                        });
                    })();
                }

                //私聊消息
                else {
                    ++this.stat.recv_msg_cnt;
                    (async () => {
                        try {
                            const data = await parseC2CMsg.call(this, msg, true);
                            if (data && data.raw_message) {
                                data.reply = (message, auto_escape = false) => this.sendPrivateMsg(data.user_id, message, auto_escape);
                                this.logger.info(`recv from: [Private: ${data.user_id}(${data.sub_type})] ` + data.raw_message);
                                this.em("message.private." + data.sub_type, data);
                            }
                        } catch (e) {
                            this.logger.debug(e);
                        }
                    })();
                }
            }
        }

        if (items.length) {
            this.writeUni("MessageSvc.PbDeleteMsg", pb.encode({ 1: items }));
        }
        if (rsp[4] !== undefined && rsp[4] !== 2) {
            this.logger.debug("消息同步未完成，继续同步中，sync flag: " + rsp[4]);
            return await this.pbGetMsg(force, rsp[4], count - 1);
        }
        return true;
    } catch (e) {
        this.logger.debug("getMsg发生错误。");
        this.logger.debug(e);
        return false;
    }
};

class Lock {
    constructor() {
        this.queue = [];
        this.locked = false;
    }

    async acquire() {
        if (this.locked) {
            return new Promise((resolve) => this.queue.push(resolve));
        }
        this.locked = true;
    }

    release() {
        if (this.queue.length > 0) {
            const nextResolve = this.queue.shift();
            nextResolve();
        } else {
            this.locked = false;
        }
    }
}

const unsendSso = [];
const requestLock = new Lock();

/**
 * 注册qsign
 * @param {boolean} [lockAcquired=false] 调用者是否已持有requestLock
 */
Client.prototype.registerQSign = async function(lockAcquired = false) {
    if (usesLocalSigner(this)) {
        await getLocalSigner(this);
        return { code: 0, msg: "success" };
    }
    if (!this.config.sign_api_addr) return BUF0;
    const url = buildUrl(this.config.sign_api_addr, 'register');
    const params = getCommonParams.call(this);
    if (!lockAcquired) await requestLock.acquire();
    try {
        const data = await executeWithRetry(
            () => qsignGet(url, params),
            'register',
            { throwOnError: true, logger: this.logger }
        );
        return data;
    } finally {
        if (!lockAcquired) requestLock.release();
    }
};

/**
 * 发送qsign给的sso包
 * @param {Array} callbackList
 */
Client.prototype.handleSsoCallback = async function(callbackList = []) {
    if (usesLocalSigner(this)) return;
    for (let packet of callbackList) {
        try {
            const cmd = String(packet.cmd);
            if (!allowedCallbackCmds.includes(cmd)) continue;
            const body = Buffer.from(packet.body, 'hex');
            const callbackId = packet.callbackId ?? packet.callback_id;
            const payload = await this.sendUni(cmd, body);
            await this.submitSsoCallback(cmd, callbackId, payload);
        } catch (e) {
            this.logger.warn(`[qsign][sendSso] ${e.message || 'unknown error'}`);
            console.warn(e);
        }
    }
}

/**
 * 提交qsign给的sso包的返回包
 * @param {string} cmd
 * @param {number} callbackId
 * @param {Buffer} body
 */
Client.prototype.submitSsoCallback = async function(cmd, callbackId, body) {
    if (usesLocalSigner(this)) return;
    const url = buildUrl(this.config.sign_api_addr, 'submit');
    const params = getCommonParams.call(this, {
        buffer: body.toString('hex'),
        cmd: cmd,
        callback_id: callbackId,
        callbackId: callbackId,
    });
    await executeWithRetry(
        () => qsignGet(url, params),
        'submitSso',
        { throwOnError: false, logger: this.logger }
    );
}

/**
 * 刷新qsign的token
 */
Client.prototype.refreshQSignToken = async function() {
    // Local tokens are produced by sign(); there are no remote SSO callbacks.
    if (usesLocalSigner(this)) return;
    if (!this.config.sign_api_addr) return;
    if (unsendSso.length > 0) {
        await this.handleSsoCallback(unsendSso.splice(0, unsendSso.length));
    }
    const url = buildUrl(this.config.sign_api_addr, 'request_token');
    const params = getCommonParams.call(this);
    const data = await executeWithRetry(
        () => qsignGet(url, params),
        'refreshToken',
        {
            throwOnError: false,
            handleNotRegistered: true,
            onNotRegistered: async () => {
                try {
                    await this.registerQSign();
                } catch (e) {
                    this.logger.warn(`${e.message || '[qsign][register] unknown error'}`);
                    console.warn(e);
                }
                await sleep(100);
            },
            logger: this.logger,
        }
    );
    if (data.data) {
        const pkts = data.data.ssoPacketList || data.data.requestCallback || data.data;
        if (Array.isArray(pkts)) {
            await this.handleSsoCallback(pkts);
        }
    } else {
        this.logger.warn(`[qsign][refreshToken] server return invalid response: ${JSON.stringify(data)}`);
    }
}
/**
 * 组头部SSOReserveField
 * @param {string} cmd
 * @param {Buffer} body
 * @param {number} seq_id
 * @param {import("./ref").SsoOptions} options
 */
Client.prototype.buildSSOReserveField = async function(cmd, body, seq_id = this.seq_id, options = {}) {
    const qimei = this.device.qimei36 || this.device.qimei16 || "";
    const reserveFields = {
        9: 1, //flag (uint32) 0b1: wifi 0b0: mobile 0b10: weak network
        11: 2052, //locale_id (uint32) 2052: zh_CN
        12: qimei, //qimei (string)
        14: 0, //newconn_flag (uint32)
        15: null, //trace_parent (string)
        16: this.uid ? String(this.uid) : "", //uid (string)
        18: 0, //imsi (uint32)
        19: 1, //network_type (uint32)
        20: 1, //ip_stack_type (uint32)
        21: 0, //message_type (uint32)
        23: null, //trans_info (bytes)
        24: null, //sec_info (bytes)
        26: null, //nt_core_version (uint32)
        28: 3, //sso_ip_origin (uint32)
    };
    if (this.needSignCmd.includes(cmd)) {
        reserveFields[24] = await this.getSign(cmd, body, seq_id);
    }
    if (options.trace_parent) {
        reserveFields[15] = "00-00000000000000000000000000000000-0000000000000000-00";
        reserveFields[21] = 2;
        if (typeof options.trace_parent === "string") {
            reserveFields[15] = options.trace_parent;
        }
    }
    if (options.nt_core) { //此时数据包内需用uid取代uin
        reserveFields[21] |= 32;
        reserveFields[26] = 100;
    }
    if (options.trans_info) {
        reserveFields[23] = options.trans_info;
    }
    return Buffer.from(pb.encode(reserveFields));
}

/**
 * 获取头部sign
 * @param {string} cmd
 * @param {Buffer} body
 * @param {number} seq_id
 */
Client.prototype.getSign = async function(cmd, body, seq_id = this.seq_id) {
    if (usesLocalSigner(this)) {
        if (!this.apk.qua) return BUF0;
        const signer = await getLocalSigner(this);
        const data = await signer.sign({ uin: this.uin, cmd, body, seq: seq_id });
        return Buffer.from(pb.encode({ 1: data.sign, 2: data.token, 3: data.extra }));
    }
    if (!this.config.sign_api_addr || !this.apk.qua) return BUF0;
    const url = buildUrl(this.config.sign_api_addr, 'sign');
    const params = getCommonParams.call(this, {
        buffer: body.toString('hex'),
        cmd: cmd,
        seq: seq_id,
    });
    await requestLock.acquire();
    try {
        const data = await executeWithRetry(
            () => qsignPost(url, params),
            'HeadSign',
            {
                throwOnError: true,
                handleNotRegistered: true,
                onNotRegistered: () => this.registerQSign(true),
                logger: this.logger,
            }
        );
        if (!data.data.sign) {
            throw new Error(`[qsign][HeadSign] server return invalid response: ${JSON.stringify(data)}`);
        }
        if (data.data.requestCallback && data.data.requestCallback.length > 0) {
            // 成功上线register后再发送SSO包
            unsendSso.push.apply(unsendSso, data.data.requestCallback);
            if (this.isOnline()) {
                setTimeout(() => this.refreshQSignToken(), 100);
            } else {
                this.once("internal.registered", async () => {
                    await this.refreshQSignToken();
                });
            }
        }
        return Buffer.from(pb.encode({
            1: Buffer.from(data.data.sign, "hex"),
            2: Buffer.from(data.data.token, "hex"),
            3: Buffer.from(data.data.extra, "hex"),
        }));
    } finally {
        requestLock.release();
    }
};

/**
 * 获取Tlv544
 * @param {string} cmd
 */
Client.prototype.getT544 = async function(cmd) {
    if (usesLocalSigner(this)) return this.getT544CustomEnergy(cmd);
    if (!this.config.sign_api_addr || !this.apk.qua) return BUF0;
    if (this.config.force_algo_T544) return BUF0;
    // 优先使用custom_energy，避免服务器使用不正确的 salt 组装
    try {
        return await this.getT544CustomEnergy(cmd);
    } catch (e) {
        this.logger.warn(`[qsign][T544] /custom_energy failed, falling back to /energy: ${e.message || e}`);
    }
    const url = buildUrl(this.config.sign_api_addr, 'energy');
    const params = getCommonParams.call(this, {
        data: cmd,
        version: this.apk.sdkver,
    });
    const data = await executeWithRetry(
        () => qsignGet(url, params),
        'T544',
        {
            throwOnError: true,
            handleNotRegistered: true,
            onNotRegistered: () => this.registerQSign(),
            logger: this.logger,
        }
    );
    if (!data.data) {
        throw new Error(`[qsign][T544] server return invalid response: ${JSON.stringify(data)}`);
    }
    if (typeof(data.data) === 'string') {
        if (this.sig.t553 && this.sig.t553.length === 0) {
            await this.getXwDebugId();
        }
        return Buffer.from(data.data, 'hex');
    } else if (typeof(data.data.sign) === 'string') {
        if (typeof(data.data.t553) === 'string') this.sig.t553 = Buffer.from(data.data.t553, 'hex');
        return Buffer.from(data.data.sign, 'hex');
    }
    else throw new Error(`[qsign][T544] server return invalid response: ${JSON.stringify(data)}`);
};

/**
 * 获取Tlv544 custom_energy
 * @param {string} cmd
 */
Client.prototype.getT544CustomEnergy = async function(cmd) {
    if ((!usesLocalSigner(this) && !this.config.sign_api_addr) || !this.apk.qua) return BUF0;
    if (this.config.force_algo_T544) return BUF0;
    const salt = new Writer();
    const subCmd = parseInt('0x' + (cmd.split("_")[1] || 9));
    if (["810_9", "810_a", "810_d", "810_f"].includes(cmd)) {
        salt.writeU32(this.uin > 2147483647 ? 0xffffffff : 0)
        salt.writeTlv(this.device.guid)
        salt.writeTlv(this.apk.sdkver)
        salt.writeU32(subCmd)
        salt.writeU32(0)
    } else {
        salt.writeU64(this.uin)
        salt.writeTlv(this.device.guid)
        salt.writeTlv(this.apk.sdkver)
        salt.writeU32(subCmd)
    }
    if (usesLocalSigner(this)) {
        const signer = await getLocalSigner(this);
        return (await signer.energy({ uin: this.uin, data: cmd, salt: salt.read() })).sign;
    }
    const url = buildUrl(this.config.sign_api_addr, 'custom_energy');
    const params = getCommonParams.call(this, {
        data: cmd,
        salt: salt.read().toString('hex'),
    });
    const data = await executeWithRetry(
        () => qsignGet(url, params),
        'T544',
        {
            throwOnError: true,
            handleNotRegistered: true,
            onNotRegistered: () => this.registerQSign(),
            logger: this.logger,
        }
    );
    if (!data.data) {
        throw new Error(`[qsign][T544] server return invalid response: ${JSON.stringify(data)}`);
    }
    if (typeof(data.data) === 'string') {
        if (this.sig.t553 && this.sig.t553.length === 0) {
            await this.getXwDebugId();
        }
        return Buffer.from(data.data, 'hex');
    } else if (typeof(data.data.sign) === 'string') {
        if (typeof(data.data.t553) === 'string') this.sig.t553 = Buffer.from(data.data.t553, 'hex');
        return Buffer.from(data.data.sign, 'hex');
    }
    else throw new Error(`[qsign][T544] server return invalid response: ${JSON.stringify(data)}`);
};

/**
 * 从服务器获得XwDebugId
 */
Client.prototype.getXwDebugId = async function() {
    if (usesLocalSigner(this)) return;
    if (!this.config.sign_api_addr || !this.apk.qua) return;
    const url = buildUrl(this.config.sign_api_addr, 'get_xw_debug_id');
    const params = getCommonParams.call(this);
    await requestLock.acquire();
    try {
        const data = await executeWithRetry(
            () => qsignGet(url, params),
            'XwDebugId',
            {
                throwOnError: false,
                handleNotRegistered: true,
                onNotRegistered: () => this.registerQSign(true),
                logger: this.logger,
            }
        );
        if (typeof(data.data) === 'string') {
            this.sig.t553 = Buffer.from(data.data, 'hex');
            this.logger.info(`[qsign][XwDebugId] updated t553: ${data.data}`);
        }
    } finally {
        requestLock.release();
    }
};

/**
 * 从服务器拉取签名cmd名单
 */
Client.prototype.updateCmdWhiteList = async function() {
    if (usesLocalSigner(this)) {
        this.needSignCmd = whitelist_920;
        return;
    }
    if (!this.config.sign_api_addr || !this.apk.qua) return;
    const url = buildUrl(this.config.sign_api_addr, 'cmd_whitelist');
    const params = getCommonParams.call(this);
    await requestLock.acquire();
    try {
        const data = await executeWithRetry(
            () => qsignGet(url, params),
            'CmdWhiteList',
            {
                throwOnError: false,
                handleNotRegistered: true,
                onNotRegistered: () => this.registerQSign(true),
                logger: this.logger,
            }
        );
        if (data.data && Array.isArray(data.data.list) && data.data.list.length > 0) {
            this.needSignCmd = data.data.list;
            this.logger.info(`[qsign][CmdWhiteList] updated needSignCmd list, count: ${this.needSignCmd.length}`);
        }
    } finally {
        requestLock.release();
    }
};
