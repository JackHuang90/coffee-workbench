#include "roast/rtu.hpp"
#include <cmath>
namespace roast {
uint16_t modbusCrc(const uint8_t* bytes,size_t length) {
 uint16_t crc=0xFFFF;
 if(!bytes && length) return 0;
 for(size_t i=0;i<length;++i){crc^=bytes[i];for(unsigned bit=0;bit<8;++bit)crc=(crc&1)?uint16_t((crc>>1)^0xA001):uint16_t(crc>>1);}
 return crc;
}
size_t RtuReader::start(const RtuProfile& p,uint32_t now,uint8_t* request,size_t capacity) {
 if(pending_) return 0;
 sample_={};size_=0;expected_=0;
 if(!request||capacity<8||p.slave<1||p.slave>247||(p.function!=3&&p.function!=4)||
    !std::isfinite(p.scale)||p.scale<=0||p.scale>1000||!std::isfinite(p.offset)||
    !std::isfinite(p.minimum)||!std::isfinite(p.maximum)||p.minimum>=p.maximum||
    p.timeoutMs<20||p.timeoutMs>2000){sample_.error=RtuError::InvalidProfile;return 0;}
 profile_=p;startedAt_=now;pending_=true;
 request[0]=p.slave;request[1]=p.function;request[2]=uint8_t(p.pvRegister>>8);request[3]=uint8_t(p.pvRegister);
 request[4]=0;request[5]=1;const auto crc=modbusCrc(request,6);request[6]=uint8_t(crc);request[7]=uint8_t(crc>>8);return 8;
}
RtuReader::Result RtuReader::reject(RtuError error) {
 pending_=false;sample_.valid=false;sample_.error=error;return Result::Rejected;
}
bool RtuReader::expire(uint32_t now) {
 if(!pending_||uint32_t(now-startedAt_)<profile_.timeoutMs)return false;
 reject(RtuError::Timeout);return true;
}
RtuReader::Result RtuReader::feed(uint8_t byte,uint32_t now) {
 if(!pending_)return reject(RtuError::Unexpected);
 if(expire(now))return Result::Rejected;
 if(size_>=sizeof(bytes_))return reject(RtuError::Length);
 bytes_[size_++]=byte;
 if(size_==1&&byte!=profile_.slave)return reject(RtuError::WrongSlave);
 if(size_==2){
  if(byte==profile_.function)expected_=7;
  else if(byte==uint8_t(profile_.function|0x80))expected_=5;
  else return reject(RtuError::WrongFunction);
 }
 if(size_==3&&bytes_[1]==profile_.function&&byte!=2)return reject(RtuError::Length);
 if(!expected_||size_<expected_)return Result::None;
 const uint16_t received=uint16_t(bytes_[size_-2])|(uint16_t(bytes_[size_-1])<<8);
 if(modbusCrc(bytes_,size_-2)!=received)return reject(RtuError::Crc);
 if(bytes_[1]&0x80){sample_.exception=bytes_[2];return reject(RtuError::Exception);}
 const uint16_t raw=(uint16_t(bytes_[3])<<8)|bytes_[4];
 // Explicit two's-complement decode, independent of implementation-defined casts.
 const int32_t integer=profile_.signedValue && raw>=0x8000?int32_t(raw)-65536:int32_t(raw);
 const float value=float(integer)*profile_.scale+profile_.offset;
 if(!std::isfinite(value)||value<profile_.minimum||value>profile_.maximum)return reject(RtuError::Range);
 sample_={value,now,true,RtuError::None,0};pending_=false;return Result::Complete;
}
}
