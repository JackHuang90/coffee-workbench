/** 功能：实现热点请求隔离与表单边界。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写；公开契约见头文件。 */
#include "roast/portal.hpp"
#include <cstring>
#include <cstdio>
#include <cctype>
namespace roast::net {
size_t captiveDnsReply(uint8_t* data,size_t length,size_t capacity,uint32_t address){
 if(length<17||length>512||length>capacity||(data[2]&0xf8)||data[4]||data[5]!=1||data[6]||data[7]||data[8]||data[9])return 0;
 size_t cursor=12;while(cursor<length&&data[cursor]){const size_t label=data[cursor++];if(label>63||label>length-cursor)return 0;cursor+=label;}
 if(cursor>=length||cursor-12>254||length-cursor<5)return 0;
 ++cursor;const unsigned type=(unsigned(data[cursor])<<8)|data[cursor+1];if(data[cursor+2]||data[cursor+3]!=1)return 0;cursor+=4;
 const bool answer=type==1||type==255;const size_t end=cursor+(answer?16:0);if(end>capacity)return 0;
 data[2]=static_cast<uint8_t>(0x84|(data[2]&1));data[3]=0;data[6]=0;data[7]=answer?1:0;data[8]=data[9]=data[10]=data[11]=0;
 if(answer){const uint8_t record[]={0xc0,0x0c,0,1,0,1,0,0,0,0,0,4,static_cast<uint8_t>(address>>24),static_cast<uint8_t>(address>>16),static_cast<uint8_t>(address>>8),static_cast<uint8_t>(address)};std::memcpy(data+cursor,record,sizeof(record));}
 return end;
}
namespace {
/** 功能：复制经过容量检查的HTTP文本。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
template<size_t N> bool copy(char (&out)[N],const char* s){if(std::strlen(s)>=N)return false;std::strcpy(out,s);return true;}
/** 功能：解码单个十六进制数字。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
int hex(char c){if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;if(c>='A'&&c<='F')return c-'A'+10;return -1;}
/** 功能：有界表单值解码，禁止NUL和控制字符（来源列表换行除外）。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
bool decode(const char* begin,const char* end,char* out,size_t capacity,bool lines){size_t n=0;while(begin<end){unsigned char c=static_cast<unsigned char>(*begin++);if(c=='+')c=' ';else if(c=='%'){if(end-begin<2||hex(begin[0])<0||hex(begin[1])<0)return false;c=static_cast<unsigned char>(hex(begin[0])*16+hex(begin[1]));begin+=2;}if(!c||(c<32&&!(lines&&(c=='\r'||c=='\n')))||c==127||n+1>=capacity)return false;out[n++]=static_cast<char>(c);}out[n]=0;return true;}
}
void PortalRequest::reset(){
 std::memset(headers_,0,sizeof(headers_));std::memset(body_,0,sizeof(body_));std::memset(path_,0,sizeof(path_));std::memset(host_,0,sizeof(host_));std::memset(origin_,0,sizeof(origin_));std::memset(token_,0,sizeof(token_));
 used_=received_=expected_=0;started_=headersDone_=post_=false;since_=0;result_=Result::Pending;
}
PortalRequest::Result PortalRequest::expire(uint32_t now){if(started_&&result_==Result::Pending&&static_cast<uint32_t>(now-since_)>3000)result_=Result::Timeout;return result_;}
PortalRequest::Result PortalRequest::feed(char c,uint32_t now){
 if(expire(now)!=Result::Pending)return result_;
 if(!started_){started_=true;since_=now;}
 if(headersDone_){if(c<32||static_cast<unsigned char>(c)>126)return result_=Result::BadRequest;body_[received_++]=c;if(received_==expected_)result_=Result::Complete;return result_;}
 if(used_>=2048)return result_=Result::TooLarge;
 if((static_cast<unsigned char>(c)<32&&c!='\r'&&c!='\n')||static_cast<unsigned char>(c)>126)return result_=Result::BadRequest;
 if((c=='\n'&&(!used_||headers_[used_-1]!='\r'))||(used_&&headers_[used_-1]=='\r'&&c!='\n'))return result_=Result::BadRequest;
 headers_[used_++]=c;
 if(used_>=4&&!std::memcmp(headers_+used_-4,"\r\n\r\n",4)){result_=parse();headersDone_=true;if(result_==Result::Pending&&!expected_)result_=Result::Complete;}return result_;
}
PortalRequest::Result PortalRequest::parse(){
 char* end=std::strstr(headers_,"\r\n");if(!end)return Result::BadRequest;*end=0;
 char* path=nullptr;if(!std::strncmp(headers_,"GET ",4))path=headers_+4;else if(!std::strncmp(headers_,"POST ",5)){path=headers_+5;post_=true;}else if(!std::strncmp(headers_,"OPTIONS /api/",13))return Result::Legacy;else return Result::BadRequest;
 if(!std::strncmp(path,"/api/",5))return Result::Legacy;
 char* version=std::strchr(path,' ');if(!version||std::strcmp(version," HTTP/1.1"))return Result::BadRequest;*version=0;if(!copy(path_,path))return Result::TooLarge;
 unsigned seen=0;char* line=end+2;
 while(*line){end=std::strstr(line,"\r\n");if(!end)return Result::BadRequest;*end=0;if(!*line)break;char* colon=std::strchr(line,':');if(!colon||line==colon)return Result::BadRequest;*colon=0;
  for(char* p=line;*p;++p){if(!std::isalnum(static_cast<unsigned char>(*p))&&*p!='-')return Result::BadRequest;*p=static_cast<char>(std::tolower(static_cast<unsigned char>(*p)));}
  char* value=colon+1;while(*value==' ')++value;char* tail=value+std::strlen(value);while(tail>value&&tail[-1]==' ')*--tail=0;
  unsigned bit=0;if(!std::strcmp(line,"host")){bit=1;if(!copy(host_,value))return Result::TooLarge;}
  else if(!std::strcmp(line,"origin")){bit=2;if(!copy(origin_,value))return Result::TooLarge;}
  else if(!std::strcmp(line,"x-setup-token")){bit=4;if(!copy(token_,value))return Result::TooLarge;}
  else if(!std::strcmp(line,"content-length")){bit=8;if(!*value)return Result::BadRequest;for(char* p=value;*p;++p){if(*p<'0'||*p>'9')return Result::BadRequest;expected_=expected_*10+static_cast<size_t>(*p-'0');if(expected_>4096)return Result::TooLarge;}}
  else if(!std::strcmp(line,"content-type")){bit=16;if(std::strcmp(value,"application/x-www-form-urlencoded"))return Result::BadRequest;}
  else if(!std::strcmp(line,"transfer-encoding")||!std::strcmp(line,"expect"))return Result::BadRequest;
  if(bit&&(seen&bit))return Result::BadRequest;
  seen|=bit;line=end+2;
 }
 if(!post_&&expected_)return Result::BadRequest;
 if(post_&&(!(seen&8)||(expected_&&!(seen&16))))return Result::BadRequest;
 return Result::Pending;
}
bool PortalRequest::authorized(bool apInterface,const char* apIp,const char* token,bool setup)const{
 if(result_!=Result::Complete||!apInterface||!setup)return false;
 char host[64];std::snprintf(host,sizeof(host),"%s:80",apIp);if(std::strcmp(host_,apIp)&&std::strcmp(host_,host))return false;
 if(!post_)return true;
 char origin[64];std::snprintf(origin,sizeof(origin),"http://%s",apIp);if(std::strcmp(origin_,origin)||std::strlen(token)<32)return false;
 const size_t a=std::strlen(token_),b=std::strlen(token);unsigned diff=static_cast<unsigned>(a^b);for(size_t i=0;i<a;++i)diff|=static_cast<unsigned char>(token_[i])^(i<b?static_cast<unsigned char>(token[i]):0);return diff==0;
}
Error parseForm(const char* body,Config& output){
 // Only the main loop invokes this parser. Static bounded scratch keeps the ESP
 // loop stack below its existing per-function budget; never call from callbacks.
 static Config config;static char origins[2049];config=Config{};std::memset(origins,0,sizeof(origins));
 unsigned seen=0;char mode[8]{};
 const char* cursor=body;
 while(*cursor){const char* end=cursor+std::strcspn(cursor,"&");const char* equals=static_cast<const char*>(std::memchr(cursor,'=',static_cast<size_t>(end-cursor)));if(!equals)return Error::Ssid;
  const char* names[]={"ssid","password","mode","ip","mask","gateway","dns","origins"};char* outputs[]={config.ssid,config.password,mode,config.ip,config.mask,config.gateway,config.dns,origins};const size_t capacities[]={sizeof(config.ssid),sizeof(config.password),sizeof(mode),16,16,16,16,sizeof(origins)};
  unsigned index=0;for(;index<8;++index)if(std::strlen(names[index])==static_cast<size_t>(equals-cursor)&&!std::memcmp(cursor,names[index],static_cast<size_t>(equals-cursor)))break;
  if(index==8||(seen&(1u<<index))||!decode(equals+1,end,outputs[index],capacities[index],index==7))return Error::Ssid;
  seen|=1u<<index;cursor=*end?end+1:end;
 }
 if(!std::strcmp(mode,"static"))config.staticIp=true;else if(std::strcmp(mode,"dhcp"))return Error::Address;
 if(!config.staticIp){config.ip[0]=config.mask[0]=config.gateway[0]=config.dns[0]=0;}
 char* line=origins;while(*line){char* end=line+std::strcspn(line,"\r\n");char* next=end;while(*next=='\r'||*next=='\n')++next;*end=0;while(*line==' ')++line;while(end>line&&end[-1]==' ')*--end=0;
  if(*line){if(config.originCount==4||!normalizeOrigin(line,config.origins[config.originCount]))return Error::Origin;++config.originCount;}line=next;
 }
 const Error result=validate(config);if(result==Error::None)output=config;
 return result;
}
}
