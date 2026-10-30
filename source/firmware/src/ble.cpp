/** 功能：编码有界BLE状态通知。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
#include "roast/ble.hpp"
#include <algorithm>
#include <cstring>
namespace roast::ble {
/** 功能：判定排队通知的最终发送边界。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
Delivery assessDelivery(const Session& session,uint32_t epoch,size_t length,uint32_t queuedAt,uint32_t now){
 if(session.connection==65535||!session.subscribed||session.epoch!=epoch)return Delivery::Drop;
 if(session.mtu<23||length<9||length>std::min(size_t{244},size_t(session.mtu-3))||uint32_t(now-queuedAt)>100)return Delivery::Close;
 return Delivery::Send;
}
/** 功能：接受单一客户端并初始化最小MTU。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
bool Session::connect(uint16_t id){if(connection!=65535||id==65535)return false;connection=id;subscribed=false;mtu=23;++epoch;return true;}
/** 功能：断开匹配客户端并废弃旧代际。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void Session::disconnect(uint16_t id){if(connection!=id||id==65535)return;connection=65535;subscribed=false;mtu=23;++epoch;}
/** 功能：只对当前客户端切换订阅并失效旧片段。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void Session::subscribe(uint16_t id,bool enabled){if(connection!=id||id==65535||subscribed==enabled)return;subscribed=enabled;++epoch;}
/** 功能：同步连接状态，边界变化取消快照。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void Stream::observe(const Session& session){if(session.epoch!=session_.epoch||!session.subscribed||session.connection==65535){length_=offset_=prepared_=0;sent_=false;}session_=session;}
/** 功能：检查1秒开始频率及订阅状态。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
bool Stream::due(uint32_t now)const{return session_.subscribed&&session_.connection!=65535&&!length_&&(!started_||uint32_t(now-startedAt_)>=1000);}
/** 功能：保存稳定JSON并分配回绕序号。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
bool Stream::begin(const char* json,size_t length,uint32_t now){if(!json||!length||length>sizeof(json_)||!due(now))return false;std::memcpy(json_,json,length);length_=length;offset_=prepared_=0;++sequence_;started_=true;startedAt_=now;return true;}
/** 功能：以最小5ms间隔准备一片，不提前确认。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
size_t Stream::next(uint32_t now,uint8_t* out,size_t capacity){if(!length_||expired(now)||(sent_&&int32_t(now-sentAt_)<5))return 0;const size_t n=encodeFragment(json_,length_,sequence_,offset_,session_.mtu,out,capacity);prepared_=n?n-8:0;return n;}
/** 功能：确认一片入队，完成后释放快照。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
void Stream::accepted(uint32_t now){if(!prepared_)return;offset_+=prepared_;prepared_=0;sent_=true;sentAt_=now;if(offset_==length_)length_=offset_=0;}
/** 功能：拒绝寿命超过1.5秒的不完整快照。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
bool Stream::expired(uint32_t now)const{return length_&&uint32_t(now-startedAt_)>=1500;}
/** 功能：编码通知。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
size_t encodeFragment(const uint8_t* json,size_t length,uint16_t sequence,size_t offset,uint16_t mtu,uint8_t* out,size_t capacity){
 if(!json||!out||!length||length>1023||offset>=length||mtu<23)return 0;
 const size_t count=std::min(length-offset,std::min(size_t{244},size_t(mtu-3))-8);
 if(capacity<count+8)return 0;
 out[0]=0x52;out[1]=1;out[2]=uint8_t(sequence);out[3]=uint8_t(sequence>>8);
 out[4]=uint8_t(length);out[5]=uint8_t(length>>8);out[6]=uint8_t(offset);out[7]=uint8_t(offset>>8);
 std::memcpy(out+8,json+offset,count);return count+8;
}
}
