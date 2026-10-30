#include "roast/modbus.hpp"
#include <cmath>
#include <cstring>
namespace roast {
namespace {
uint16_t be16(const uint8_t* b){return uint16_t((uint16_t(b[0])<<8)|b[1]);}
void put16(uint8_t* b,uint16_t v){b[0]=uint8_t(v>>8);b[1]=uint8_t(v);}
size_t exception(const uint8_t* request,uint8_t* out,size_t capacity,uint8_t code){
 if(capacity<9)return 0;
 std::memcpy(out,request,7);put16(out+4,3);out[7]=request[7]|0x80;out[8]=code;return 9;
}
bool temperature(float value,uint16_t& reg){
 if(!std::isfinite(value)||value<-3276.8f||value>3276.7f)return false;
 const int32_t deci=int32_t(std::lround(value*10.0f));
 if(deci<-32768||deci>32767)return false;
 reg=uint16_t(deci);return true;
}
}
size_t handleModbus(const uint8_t* request,size_t size,uint8_t* out,size_t capacity,Controller& controller,uint32_t now){
 if(!request||!out||size<8||size>kMaxTcpFrame||be16(request+2)!=0||be16(request+4)!=size-6||request[6]!=1)return 0;
 const uint8_t function=request[7];
 if(function!=3&&function!=6)return exception(request,out,capacity,1);
 if(size!=12)return exception(request,out,capacity,3);
 const uint16_t address=be16(request+8),value=be16(request+10);
 if(function==6){
  if(address<100||address>104)return exception(request,out,capacity,2);
  const int32_t signedValue=value>=0x8000?int32_t(value)-65536:int32_t(value);
  if((address==100&&value!=0)||(address==101&&(signedValue<-200||signedValue>2800))||
     ((address==102||address==103)&&value>1000)||(address==104&&value!=1))return exception(request,out,capacity,3);
  if(capacity<12)return 0; // No command side effect without space for acknowledgement.
  const char* error=nullptr;
  if(!controller.modbusWrite(address,value,now,error)){
   const uint8_t code=error&&!std::strcmp(error,"invalid_address")?2:error&&!std::strcmp(error,"invalid_value")?3:4;
   return exception(request,out,capacity,code);
  }
  std::memcpy(out,request,12);return 12;
 }
 if(value==0||value>12)return exception(request,out,capacity,3);
 if(address>11||value>12-address)return exception(request,out,capacity,2);
 const auto snapshot=controller.snapshot(now);
 uint16_t registers[12]{};
 const bool active=snapshot.state==State::Running||snapshot.state==State::Manual||snapshot.state==State::ArtisanPower||snapshot.state==State::ArtisanSv;
 registers[4]=uint16_t(8|(snapshot.sensorFresh?1:0)|(active?2:0)|(snapshot.state==State::Fault?4:0)|(kDemoBuild?0x8000:0));
 registers[5]=static_cast<uint16_t>(snapshot.state);registers[6]=uint16_t(snapshot.elapsedMs/1000);registers[7]=1;
 registers[9]=static_cast<uint16_t>(snapshot.owner);registers[10]=static_cast<uint16_t>(snapshot.controlMode);registers[11]=uint16_t(snapshot.authorizationRemainingMs/1000);
 for(uint16_t reg=address;reg<address+value;++reg){
  if(reg<2){if(!snapshot.sensorFresh||!temperature(reg==0?snapshot.sensor.bt:snapshot.sensor.et,registers[reg]))return exception(request,out,capacity,4);}
  else if(reg==2){if(!snapshot.targetValid||!temperature(snapshot.target,registers[reg]))return exception(request,out,capacity,4);}
  else if(reg==3||reg==8){const float percent=reg==3?snapshot.requested:snapshot.fanRequested;if(!std::isfinite(percent)||percent<0||percent>100)return exception(request,out,capacity,4);registers[reg]=uint16_t(std::lround(percent*10));}
 }
 const size_t responseSize=9+2*value;if(capacity<responseSize)return 0;
 std::memcpy(out,request,7);put16(out+4,uint16_t(3+2*value));out[7]=3;out[8]=uint8_t(2*value);
 for(uint16_t i=0;i<value;++i)put16(out+9+2*i,registers[address+i]);
 return responseSize;
}
TcpFramer::Result TcpFramer::feed(uint8_t byte,uint32_t now){
 if(rejected_||complete_){rejected_=true;return Result::Rejected;}
 if(expire(now))return Result::Rejected;
 if(size_==0)startedAt_=now;
 if(size_>=kMaxTcpFrame){rejected_=true;return Result::Rejected;}
 bytes_[size_++]=byte;
 if(size_==6){
  const auto length=be16(bytes_+4);
  if(be16(bytes_+2)!=0||length<2||length>254){rejected_=true;return Result::Rejected;}
  expected_=6+length;
 }
 if(expected_&&size_==expected_){complete_=true;return Result::Complete;}
 return Result::None;
}
bool TcpFramer::expire(uint32_t now){
 if(!size_||complete_||rejected_||uint32_t(now-startedAt_)<1000)return false;
 rejected_=true;return true;
}
void TcpFramer::reset(){size_=0;expected_=0;startedAt_=0;rejected_=false;complete_=false;}
}
