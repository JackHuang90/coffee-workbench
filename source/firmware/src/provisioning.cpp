/** 功能：实现有界配网核心，不依赖Wi-Fi、NVS或GPIO。
 * 首次编写日期：2026-10-29；变更日期：2026-10-30
 * 修改记录：2026-10-29：首次编写。各公开函数契约及日期见同名头文件。
 * - 2026-10-30：来源规范化增加明确本机/私有IPv4 HTTP，并拒绝浏览器数值地址别名。 */
#include "roast/provisioning.hpp"
#include <cstring>
#include <cstdio>
#include <cctype>
#include <algorithm>
namespace roast::net {
uint32_t apGateway(uint32_t current,uint32_t station,uint32_t mask){
 const uint32_t choices[]={current,0xc0a80401u,0xc0a82501u,0xac1ff001u,0x0a4d0001u};
 for(uint32_t value:choices)if(value&&(!station||((value&mask)!=(station&mask)&&(value&0xffffff00u)!=(station&0xffffff00u))))return value;
 return 0;
}
namespace {
/** 功能：检查固定容量文本终止符。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
template<size_t N> bool terminated(const char (&s)[N]){return std::memchr(s,0,N)!=nullptr;}
/** 功能：检查可用单播IPv4。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
bool unicast(uint32_t ip){return (ip>>24)!=0&&(ip>>24)!=127&&(ip>>24)<224&&ip!=0xffffffff;}
/** 功能：对完整记录有效负载计算FNV损坏校验。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
uint32_t checksum(const Record& r){uint32_t h=2166136261u;const auto* p=reinterpret_cast<const uint8_t*>(&r);for(size_t i=0;i<offsetof(Record,checksum);++i){h^=p[i];h*=16777619u;}return h;}
/** 功能：识别浏览器会当作IPv4的末尾数值标签，避免保存未规范化地址别名。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
bool numericHost(const char* begin,const char* end){
 const char* last=begin;for(const char* p=begin;p<end;++p)if(*p=='.')last=p+1;
 bool decimal=last<end;for(const char* p=last;p<end;++p)if(*p<'0'||*p>'9')decimal=false;
 if(decimal)return true;
 if(end-last<2||last[0]!='0'||(last[1]!='x'&&last[1]!='X'))return false;
 for(const char* p=last+2;p<end;++p)if(!std::isxdigit(static_cast<unsigned char>(*p)))return false;
 return true;
}
}
bool ipv4(const char* s,uint32_t& out){
 out=0;if(!s)return false;
 for(unsigned part=0;part<4;++part){unsigned n=0,digits=0;const bool zero=*s=='0';while(*s>='0'&&*s<='9'){n=n*10+static_cast<unsigned>(*s++-'0');if(++digits>3||n>255)return false;}if(!digits||(zero&&digits>1))return false;out=(out<<8)|n;if(part<3){if(*s++!='.')return false;}else if(*s)return false;}return true;
}
/** 功能：从HTTPS或受限HTTP URL提取标准来源；HTTP仅允许localhost、127/8及RFC1918。
 * 首次编写日期：2026-10-29；变更日期：2026-10-30
 * 修改记录：2026-10-29：首次编写，规范化HTTPS来源。
 * - 2026-10-30：扩展明确本机/内网HTTP，按协议去除默认端口并拒绝模糊数值主机。 */
bool normalizeOrigin(const char* input,char (&out)[256]){
 out[0]=0;if(!input)return false;const size_t length=std::strlen(input);if(length>1024)return false;
 for(const unsigned char* p=reinterpret_cast<const unsigned char*>(input);*p;++p)if(*p<=32||*p>=127||*p=='\\')return false;
 char scheme[9]{};for(size_t i=0;i<std::min(length,size_t{8});++i)scheme[i]=static_cast<char>(std::tolower(static_cast<unsigned char>(input[i])));
 const bool secure=!std::strcmp(scheme,"https://");if(!secure&&std::strncmp(scheme,"http://",7))return false;
 const size_t prefix=secure?8:7;const unsigned defaultPort=secure?443:80;
 const char* begin=input+prefix;const char* end=begin+std::strcspn(begin,"/?#");if(begin==end||end-begin>static_cast<ptrdiff_t>(255-prefix))return false;
 const char* port=nullptr;for(const char* p=begin;p<end;++p){if(*p==':'){if(port)return false;port=p;}if(*p=='@'||*p=='*')return false;}
 const char* hostEnd=port?port:end;size_t label=0;
 for(const char* p=begin;p<hostEnd;++p){if(*p=='.'){if(!label||p[-1]=='-')return false;label=0;}else {if(!(std::isalnum(static_cast<unsigned char>(*p))||*p=='-')||(!label&&*p=='-')||++label>63)return false;}}
 if(!label||hostEnd[-1]=='-')return false;
 unsigned number=defaultPort;if(port){number=0;if(port+1==end)return false;for(const char* p=port+1;p<end;++p){if(*p<'0'||*p>'9')return false;number=number*10+static_cast<unsigned>(*p-'0');if(number>65535)return false;}if(!number)return false;}
 size_t n=prefix;std::memcpy(out,secure?"https://":"http://",prefix);for(const char* p=begin;p<hostEnd;++p)out[n++]=static_cast<char>(std::tolower(static_cast<unsigned char>(*p)));out[n]=0;
 uint32_t address=0;const bool numeric=numericHost(begin,hostEnd);const bool strictIp=ipv4(out+prefix,address);
 if(numeric&&!strictIp){out[0]=0;return false;}
 const bool local=(!std::strcmp(out+prefix,"localhost"))||(strictIp&&((address>>24)==127||(address>>24)==10||(address&0xfff00000u)==0xac100000u||(address&0xffff0000u)==0xc0a80000u));
 if(!secure&&!local){out[0]=0;return false;}
 if(number!=defaultPort){const int written=std::snprintf(out+n,256-n,":%u",number);if(written<0||static_cast<size_t>(written)>=256-n){out[0]=0;return false;}}return true;
}
Error validate(const Config& c){
 if(!terminated(c.ssid)||!c.ssid[0])return Error::Ssid;
 if(!terminated(c.password))return Error::Password;
 const size_t pass=std::strlen(c.password);if(pass&&pass<8)return Error::Password;if(pass==64){for(char ch:c.password)if(ch&&!std::isxdigit(static_cast<unsigned char>(ch)))return Error::Password;}
 if(!terminated(c.ip)||!terminated(c.mask)||!terminated(c.gateway)||!terminated(c.dns))return Error::Address;
 if(c.staticIp){uint32_t ip,mask,gateway,dns;if(!ipv4(c.ip,ip)||!ipv4(c.mask,mask)||!ipv4(c.gateway,gateway)||!ipv4(c.dns,dns))return Error::Address;const uint32_t inverse=~mask;
  if(!mask||inverse<3||(inverse&(inverse+1))||!unicast(ip)||!unicast(gateway)||!unicast(dns)||(ip&inverse)==0||(ip&inverse)==inverse||(gateway&inverse)==0||(gateway&inverse)==inverse||(ip&mask)!=(gateway&mask)||ip==gateway)return Error::Address;}
 if(c.originCount>4)return Error::Origin;
 for(unsigned i=0;i<c.originCount;++i){char normalized[256];if(!terminated(c.origins[i])||!normalizeOrigin(c.origins[i],normalized)||std::strcmp(c.origins[i],normalized))return Error::Origin;for(unsigned j=0;j<i;++j)if(!std::strcmp(c.origins[i],c.origins[j]))return Error::Origin;}
 return Error::None;
}
bool originAllowed(const Config& c,const char* origin){if(!origin||!origin[0]||c.originCount>4)return false;for(unsigned i=0;i<c.originCount;++i)if(terminated(c.origins[i])&&!std::strcmp(c.origins[i],origin))return true;return false;}
Record makeRecord(const Config& config,uint32_t sequence,bool present){Record r;auto* bytes=reinterpret_cast<unsigned char*>(&r);std::fill(bytes,bytes+sizeof(r),0);r.version=1;r.sequence=sequence;r.present=present?1:0;if(present)r.config=config;r.checksum=checksum(r);return r;}
bool recordValid(const Record& r){return r.version==1&&r.present<=1&&r.checksum==checksum(r)&&(!r.present||validate(r.config)==Error::None);}
int selectRecord(const Record* a,const Record* b){const bool av=a&&recordValid(*a),bv=b&&recordValid(*b);if(!av)return bv?1:-1;if(!bv)return 0;return static_cast<int32_t>(b->sequence-a->sequence)>0?1:0;}
bool ResetButton::update(bool pressed,uint32_t now){
 if(initial_){initial_=false;raw_=pressed;changed_=now;}
 if(pressed!=raw_){raw_=pressed;changed_=now;}
 if(static_cast<uint32_t>(now-changed_)>=50){
  if(!released_&&!raw_){released_=true;stable_=false;}
  else if(released_&&stable_!=raw_){stable_=raw_;if(stable_){pressed_=now;armed_=false;}else {const bool confirmed=armed_;shortPress_=!confirmed&&uint32_t(now-pressed_)>=50&&uint32_t(now-pressed_)<5000;armed_=false;return confirmed;}}
 }
 if(released_&&stable_&&raw_&&static_cast<uint32_t>(now-pressed_)>=5000)armed_=true;
 return false;
}
void Machine::begin(bool saved,uint32_t now){*this=Machine{};state_=saved?State::Connecting:State::Setup;pending_=saved;at_=now;}
void Machine::test(uint32_t now){state_=State::Testing;pending_=true;trying_=false;at_=now;closeAp_=false;if(!++revision_)++revision_;}
Action Machine::tick(uint32_t now,bool connected){
 if(pending_){pending_=false;trying_=true;at_=now;return state_==State::Testing?Action::ConnectCandidate:Action::ConnectSaved;}
 if(state_==State::Testing){if(connected){state_=State::Ready;trying_=false;}else if(static_cast<uint32_t>(now-at_)>=30000){state_=State::Failed;trying_=false;return Action::Disconnect;}return Action::None;}
 if(canSave()){if(!connected)state_=State::Failed;return Action::None;}
 if(state_==State::Saved){if(closeAp_&&static_cast<uint32_t>(now-at_)>=30000){closeAp_=false;state_=State::Online;return Action::CloseAp;}return Action::None;}
 if(state_==State::Setup||state_==State::Failed)return Action::None;
 if(connected){state_=State::Online;trying_=false;wait_=1000;return Action::None;}
 if(state_==State::Online){state_=State::Connecting;trying_=false;at_=now;}
 if(trying_&&static_cast<uint32_t>(now-at_)>=30000){trying_=false;state_=State::Offline;at_=now;return Action::Disconnect;}
 if(!trying_&&static_cast<uint32_t>(now-at_)>=wait_){trying_=true;state_=State::Connecting;at_=now;wait_=std::min(wait_*2,uint32_t{30000});return Action::ConnectSaved;}return Action::None;
}
void Machine::saved(bool success,uint32_t now){if(!canSave())return;state_=success?State::Saved:State::SaveFailed;if(success){closeAp_=true;at_=now;}}
Light light(State state,bool armed,uint32_t now){if(armed)return now%240<120?Light::Purple:Light::Off;if(state==State::Online||state==State::Ready||state==State::Saved)return Light::Green;if(state==State::Failed||state==State::SaveFailed||state==State::Offline)return now%1500<250?Light::Red:Light::Off;if(state==State::Connecting||state==State::Testing)return now%600<300?Light::Yellow:Light::Off;return now%1600<800?Light::Blue:Light::Off;}
}
