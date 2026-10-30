#pragma once
#include "core.hpp"
namespace roast {
constexpr size_t kMaxLine=255,kResponseSize=1024;
// Caller must provide one complete line without CR/LF. No unbounded parsing.
size_t respond(Controller& controller,const char* line,size_t size,uint32_t now,char* out,size_t capacity,CommandSource source);
size_t statusJson(const Controller& controller,uint32_t now,char* out,size_t capacity);
class LineFramer {
 public:
 enum class Result { None,Line,Rejected };
 Result feed(char byte,uint32_t now);
 bool expire(uint32_t now);
 const char* data()const{return buffer_;} size_t size()const{return length_;}
 void reset();
 private:char buffer_[kMaxLine+1]{};size_t length_=0;uint32_t since_=0;bool started_=false,dropping_=false,delivered_=false;
};
}
