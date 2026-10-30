#pragma once
#include <cstddef>
#include <cstdint>
namespace roast {
namespace net { struct Config; }
/** 功能：解析固定状态/命令HTTP，不支持分块或持久连接。
 * 首次编写日期：未知（历史代码）；变更日期：2026-10-29
 * 修改记录：2026-10-29：仅状态GET/OPTIONS允许精确配置来源，命令继续拒绝Origin。 */
class HttpRequest {
 public:
 /** 功能：表示增量解析结果。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：保留旧错误结果。 */
 enum class Result { Pending, Complete, BadRequest, TooLarge, Forbidden, MethodNotAllowed, NotFound, Timeout };
 /** 功能：接收请求字节，并在头部完成后检查来源。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：加入可选精确来源配置。 */
 Result feed(char c,uint32_t now,const char* token,const net::Config* origins=nullptr);
 /** 功能：检查原有一秒接收超时。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：保留计时回绕语义。 */
 Result expire(uint32_t now);
 /** 功能：清空解析与CORS信息。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：增加来源字段重置。 */
 void reset();
 /** 功能：标识命令请求。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：保留原契约。 */
 bool command()const{return command_;}
 /** 功能：只返回经许可的状态来源。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 const char* corsOrigin()const{return result_==Result::Complete?origin_:"";}
 /** 功能：标识已校验的预检。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool preflight()const{return preflight_;}
 /** 功能：报告浏览器请求的私有网络预检。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
 bool privateNetwork()const{return privateNetwork_;}
 /** 功能：读取命令正文。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：保留原容量。 */
 const char* body()const{return body_;}
 /** 功能：读取已接收正文长度。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：保留原契约。 */
 size_t bodySize()const{return bodyUsed_;}
 private:
 char header_[1025]{}; // 有界HTTP头部。
 char body_[256]{}; // 原命令正文容量保持不变。
 char origin_[256]{}; // 请求的精确来源，未授权时不可作为响应许可。
 size_t headerUsed_=0; // 已收头部长度。
 size_t bodyUsed_=0; // 已收正文长度。
 size_t bodyExpected_=0; // Content-Length声明。
 bool started_=false; // 是否收到首字节。
 bool headersDone_=false; // 是否开始正文。
 bool command_=false; // 是否为命令端点。
 bool preflight_=false; // 是否为状态OPTIONS。
 bool privateNetwork_=false; // 是否请求旧版PNA许可。
 uint32_t since_=0; // 首字节毫秒。
 Result result_=Result::Pending; // 保持首个终结结果。
 /** 功能：验证请求行、敏感头、令牌与状态来源。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：加入只读CORS检查。 */
 Result parse(const char* token,const net::Config* origins);
};
}
