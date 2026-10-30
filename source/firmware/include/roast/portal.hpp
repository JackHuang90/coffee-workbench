#pragma once
#include "roast/provisioning.hpp"
namespace roast::net {
/** 功能：独立解析门户HTTP，保留旧命令解析器的255字节容量。
 * 首次编写日期：2026-10-29；变更日期：2026-10-29
 * 修改记录：2026-10-29：首次编写，限制头部2048和表单4096字节。 */
class PortalRequest {
 public:
 /** 功能：描述逐字节解析结果。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 enum class Result { Pending, Complete, BadRequest, TooLarge, Timeout, Legacy };
 /** 功能：接收一个请求字节。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 Result feed(char,uint32_t);
 /** 功能：执行3秒组帧超时。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 Result expire(uint32_t);
 /** 功能：为新连接清空所有请求信息。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 void reset();
 /** 功能：同时校验配网模式、实际本地接口、Host及写入来源/会话值。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool authorized(bool apInterface,const char* apIp,const char* token,bool setup)const;
 /** 功能：读取请求路径。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 const char* path()const{return path_;}
 /** 功能：读取完整的有界表单。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 const char* body()const{return body_;}
 /** 功能：区分写入与读取请求。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool post()const{return post_;}
 private:
 char headers_[2049]{}; // 原始头部，解析后原地分割。
 char body_[4097]{}; // URL编码表单，不与旧命令缓冲共享。
 char path_[128]{}; // 已校验路径。
 char host_[128]{}; // 请求主机，限制到AP地址及可选80端口。
 char origin_[256]{}; // 写入来源必须等于AP页面来源。
 char token_[65]{}; // 每次门户会话的随机值。
 size_t used_=0; // 已收头部长度。
 size_t received_=0; // 已收正文长度。
 size_t expected_=0; // 声明的正文长度。
 bool started_=false; // 是否已有首字节。
 bool headersDone_=false; // 是否正在接收正文。
 bool post_=false; // 是否为POST。
 uint32_t since_=0; // 首字节时间。
 Result result_=Result::Pending; // 首个终结结果保持不变。
 /** 功能：检查请求行及防止重复敏感头、分块传输和超长正文。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 Result parse();
};
/** 功能：主循环独占的有界表单解码；拒绝重复字段和无效URL转义，失败保留原候选。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写，用静态工作区限制栈，不可重入。 */
Error parseForm(const char*,Config&);
/** 功能：原地构造单问题门户DNS响应，拒绝压缩问题和越界报文；IPv6查询返回空答案。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
size_t captiveDnsReply(uint8_t*,size_t,size_t,uint32_t);
}
