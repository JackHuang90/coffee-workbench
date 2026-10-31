#include "roast/ble_setup.hpp"
#include <cstring>
namespace roast::ble {
size_t setupFrame(uint16_t seq,size_t total,size_t offset,const uint8_t* data,size_t payload,uint8_t* out,size_t cap){
 if(!total||total>kSetupMax||offset>=total||!payload||payload>total-offset||payload+8>cap)return 0;
 out[0]=0x52;out[1]=1;out[2]=seq&255;out[3]=seq>>8;out[4]=total&255;out[5]=total>>8;out[6]=offset&255;out[7]=offset>>8;std::memcpy(out+8,data,payload);return payload+8;
}
void SetupAssembler::clear(){std::memset(bytes_,0,sizeof(bytes_));total_=used_=0;}
bool SetupAssembler::push(const uint8_t* p,size_t n,uint32_t now){
 if(n<9||n>244||p[0]!=0x52||p[1]!=1){clear();return false;}
 const size_t total=p[4]|(size_t(p[5])<<8),offset=p[6]|(size_t(p[7])<<8);const uint16_t seq=p[2]|(uint16_t(p[3])<<8);
 if(total_&&uint32_t(now-started_)>=10000){clear();return false;}
 if(!total||total>kSetupMax||offset>=total||n-8>total-offset){clear();return false;}
 if(!total_){if(offset)return false;total_=total;sequence_=seq;started_=now;}
 else if(!offset||seq!=sequence_||total!=total_||offset!=used_){clear();return false;}
 // Embedded NUL cannot enter a URL form or bypass request parsing.
 if(std::memchr(p+8,0,n-8)){clear();return false;}
 std::memcpy(bytes_+used_,p+8,n-8);used_+=n-8;return used_==total_;
}
void SetupAuthorization::close(){pending_=granted_=false;}
void SetupAuthorization::observe(uint32_t epoch,bool connected,uint32_t now){if(epoch!=epoch_||!connected)close();epoch_=epoch;connected_=connected;if(granted_&&!authorized(now))close();if(pending_&&uint32_t(now-at_)>=120000)close();}
void SetupAuthorization::request(uint32_t now){if(connected_){pending_=true;granted_=false;at_=now;}}
void SetupAuthorization::confirm(uint32_t now){if(connected_&&pending_){pending_=false;granted_=true;at_=now;}}
}
