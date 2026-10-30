/** 功能：实现有界HTTP及只读状态CORS。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：按头文件契约扩展状态预检，命令仍拒绝跨域。 */
#include "roast/http.hpp"
#include "roast/provisioning.hpp"
#include <cstring>
#include <cctype>
namespace roast {
namespace {
/** 功能：不区分大小写匹配HTTP头名。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：保留头名规则。 */
bool nameEq(const char* a,const char* b){while(*a&&*b){if(std::tolower(static_cast<unsigned char>(*a++))!=std::tolower(static_cast<unsigned char>(*b++)))return false;}return *a==*b;}
/** 功能：比较令牌而不按首个不同字节提前返回。首次编写日期：未知（历史代码）；变更日期：2026-10-29；修改记录：2026-10-29：保留本地命令认证。 */
bool equalToken(const char* supplied,const char* token){size_t a=std::strlen(supplied),b=std::strlen(token);unsigned diff=static_cast<unsigned>(a^b);for(size_t i=0;i<a;i++)diff|=static_cast<unsigned char>(supplied[i])^(i<b?static_cast<unsigned char>(token[i]):0);return diff==0;}
}
void HttpRequest::reset(){*this=HttpRequest{};}
HttpRequest::Result HttpRequest::expire(uint32_t now){if(started_&&result_==Result::Pending&&static_cast<uint32_t>(now-since_)>1000)result_=Result::Timeout;return result_;}
HttpRequest::Result HttpRequest::feed(char c,uint32_t now,const char* token,const net::Config* origins){
 if(expire(now)!=Result::Pending)return result_;
 if(!started_){started_=true;since_=now;}
 if(headersDone_){
  if(c<' '||c>'~')return result_=Result::BadRequest;
  if(bodyUsed_>=255)return result_=Result::TooLarge;
  body_[bodyUsed_++]=c;body_[bodyUsed_]=0;
  if(bodyUsed_==bodyExpected_)result_=Result::Complete;
  return result_;
 }
 if(headerUsed_>=1024)return result_=Result::TooLarge;
 if((static_cast<unsigned char>(c)<32&&c!='\r'&&c!='\n')||static_cast<unsigned char>(c)>126)return result_=Result::BadRequest;
 if(c=='\n'&&(headerUsed_==0||header_[headerUsed_-1]!='\r'))return result_=Result::BadRequest;
 if(headerUsed_&&header_[headerUsed_-1]=='\r'&&c!='\n')return result_=Result::BadRequest;
 header_[headerUsed_++]=c;header_[headerUsed_]=0;
 if(headerUsed_>=4&&std::memcmp(header_+headerUsed_-4,"\r\n\r\n",4)==0){
  result_=parse(token,origins);headersDone_=true;
  if(result_==Result::Pending&&bodyExpected_==0)result_=Result::Complete;
 }
 return result_;
}
HttpRequest::Result HttpRequest::parse(const char* token,const net::Config* origins){
 char* end=std::strstr(header_,"\r\n");if(!end)return Result::BadRequest;*end=0;
 if(std::strcmp(header_,"GET /api/v1/status HTTP/1.1")==0)command_=false;
 else if(std::strcmp(header_,"OPTIONS /api/v1/status HTTP/1.1")==0)preflight_=true;
 else if(std::strcmp(header_,"POST /api/v1/command HTTP/1.1")==0)command_=true;
 else {if(std::strncmp(header_,"GET ",4)!=0&&std::strncmp(header_,"POST ",5)!=0)return Result::MethodNotAllowed;return Result::NotFound;}
 bool lengthSeen=false,authSeen=false,auth=false,originSeen=false,methodSeen=false,headersSeen=false,privateSeen=false;
 char* line=end+2;
 while(*line){
  end=std::strstr(line,"\r\n");if(!end)return Result::BadRequest;*end=0;
  if(!*line)break;
  if(*line==' '||*line=='\t')return Result::BadRequest;
  char* colon=std::strchr(line,':');if(!colon||colon==line)return Result::BadRequest;*colon=0;
  for(char* p=line;*p;p++)if(!std::isalnum(static_cast<unsigned char>(*p))&&*p!='-')return Result::BadRequest;
  char* value=colon+1;while(*value==' ')value++;
  char* tail=value+std::strlen(value);while(tail>value&&tail[-1]==' ')*--tail=0;
  if(nameEq(line,"origin")){if(originSeen)return Result::BadRequest;originSeen=true;if(std::strlen(value)>=sizeof(origin_))return Result::TooLarge;std::strcpy(origin_,value);}
  if(nameEq(line,"access-control-request-method")){if(methodSeen)return Result::BadRequest;methodSeen=true;if(std::strcmp(value,"GET"))return Result::Forbidden;}
  if(nameEq(line,"access-control-request-headers")){if(headersSeen)return Result::BadRequest;headersSeen=true;if(!nameEq(value,"accept"))return Result::Forbidden;}
  if(nameEq(line,"access-control-request-private-network")){if(privateSeen)return Result::BadRequest;privateSeen=true;if(std::strcmp(value,"true"))return Result::Forbidden;privateNetwork_=true;}
  if(nameEq(line,"transfer-encoding")||nameEq(line,"expect"))return Result::BadRequest;
  if(nameEq(line,"content-length")){
   if(lengthSeen||!*value)return Result::BadRequest;
   lengthSeen=true;
   for(char* p=value;*p;p++){if(*p<'0'||*p>'9')return Result::BadRequest;bodyExpected_=bodyExpected_*10+static_cast<size_t>(*p-'0');if(bodyExpected_>255)return Result::TooLarge;}
  }
  if(nameEq(line,"authorization")){
   if(authSeen)return Result::BadRequest;
   authSeen=true;
   if(token&&std::strlen(token)>=16&&std::strncmp(value,"Bearer ",7)==0)auth=equalToken(value+7,token);
  }
  line=end+2;
 }
 if(originSeen&&(command_||!origins||!net::originAllowed(*origins,origin_)))return Result::Forbidden;
 if(preflight_&&(!originSeen||!methodSeen))return Result::Forbidden;
 if(!preflight_&&(methodSeen||headersSeen||privateSeen))return Result::BadRequest;
 if(command_){if(!auth)return Result::Forbidden;if(!lengthSeen||bodyExpected_==0)return Result::BadRequest;}
 else if(bodyExpected_!=0)return Result::BadRequest;
 return Result::Pending;
}
}
