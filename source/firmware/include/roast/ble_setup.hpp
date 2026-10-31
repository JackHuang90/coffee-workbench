#pragma once
#include <cstdint>
#include <cstddef>
namespace roast::ble {
constexpr size_t kSetupMax=4095;
size_t setupFrame(uint16_t sequence,size_t total,size_t offset,const uint8_t* data,size_t payload,uint8_t* out,size_t capacity);
class SetupAssembler {
 public:
 bool push(const uint8_t*,size_t,uint32_t);
 const char* data()const{return bytes_;}
 size_t size()const{return used_;}
 void clear();
 private:
 char bytes_[kSetupMax+1]{};
 size_t total_=0,used_=0;
 uint16_t sequence_=0;
 uint32_t started_=0;
};
class SetupAuthorization {
 public:
 void observe(uint32_t epoch,bool connected,uint32_t now);
 void request(uint32_t now);
 void confirm(uint32_t now);
 void close();
 bool authorized(uint32_t now)const{return granted_&&uint32_t(now-at_)<120000;}
 bool pending()const{return pending_;}
 uint32_t remaining(uint32_t now)const{return authorized(now)?120000-uint32_t(now-at_):0;}
 private:
 uint32_t epoch_=0,at_=0;
 bool connected_=false,pending_=false,granted_=false;
};
}
