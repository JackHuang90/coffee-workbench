/** 功能：验证热点接口隔离、防伪与有界表单解析。
 * 首次编写日期：2026-10-29；变更日期：2026-10-29
 * 修改记录：2026-10-29：首次编写，拒绝路由器侧写入和跨站请求。 */
#include "roast/portal.hpp"
#include <cassert>
#include <cstring>
#include <string>
#include <iostream>
using namespace roast::net;
/** 功能：逐字节驱动真实门户解析器。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
static PortalRequest::Result feed(PortalRequest& p,const std::string& wire){auto r=PortalRequest::Result::Pending;for(char c:wire)r=p.feed(c,100);return r;}
/** 功能：验证AP边界、请求容量及表单解码。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
int main(){
 const std::string token="123456789abcdef0123456789abcdef0";
 const std::string form="ssid=Hidden%20%3Cnetwork%3E&password=private%26secret&mode=dhcp&origins=https%3A%2F%2FExample.com%2Fpage%0Ahttps%3A%2F%2Fother.test%3A8443";
 const std::string headers="POST /setup/test HTTP/1.1\r\nHost: 192.168.4.1\r\nOrigin: http://192.168.4.1\r\nX-Setup-Token: "+token+"\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: "+std::to_string(form.size())+"\r\n\r\n";
 PortalRequest p;assert(feed(p,headers+form)==PortalRequest::Result::Complete);
 assert(p.authorized(true,"192.168.4.1",token.c_str(),true));assert(!p.authorized(false,"192.168.4.1",token.c_str(),true));assert(!p.authorized(true,"192.168.4.1",token.c_str(),false));assert(!p.authorized(true,"192.168.4.1","wrong",true));assert(!p.authorized(true,"10.0.0.1",token.c_str(),true));
 Config c{};assert(parseForm(p.body(),c)==Error::None);assert(std::strcmp(c.ssid,"Hidden <network>")==0);assert(std::strcmp(c.password,"private&secret")==0);assert(c.originCount==2);assert(std::strcmp(c.origins[0],"https://example.com")==0);
 assert(parseForm("ssid=a&ssid=b&mode=dhcp",c)!=Error::None);assert(parseForm("ssid=a%00b&mode=dhcp",c)!=Error::None);assert(parseForm("ssid=%GG&mode=dhcp",c)!=Error::None);assert(parseForm("ssid=a&mode=invalid",c)!=Error::None);
 assert(parseForm("ssid=a&mode=static&ip=10.0.0.2&mask=255.255.255.0&gateway=10.0.0.1&dns=1.1.1.1",c)==Error::None);assert(c.staticIp);
 assert(parseForm("ssid=a&mode=dhcp",c)==Error::None);assert(!c.staticIp&&c.ip[0]==0);
 assert(parseForm("ssid=changed&mode=static&ip=bad",c)!=Error::None);assert(std::strcmp(c.ssid,"a")==0&&!c.staticIp);
 p.reset();assert(feed(p,"POST /setup/save HTTP/1.1\r\nHost: 192.168.4.1\r\nOrigin: https://evil.test\r\nContent-Length: 0\r\n\r\n")==PortalRequest::Result::Complete);assert(!p.authorized(true,"192.168.4.1",token.c_str(),true));
 p.reset();assert(feed(p,"POST /setup/test HTTP/1.1\r\nHost: x\r\nHost: y\r\nContent-Length: 0\r\n\r\n")==PortalRequest::Result::BadRequest);
 p.reset();assert(feed(p,"POST /setup/test HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n")==PortalRequest::Result::BadRequest);
 p.reset();assert(feed(p,"POST /setup/test HTTP/1.1\r\nContent-Length: 9999999999999\r\n\r\n")==PortalRequest::Result::TooLarge);
 p.reset();assert(feed(p,"GET /setup/state HTTP/1.1\r\nHost: 192.168.4.1\r\n\r\n")==PortalRequest::Result::Complete);assert(p.authorized(true,"192.168.4.1",token.c_str(),true));assert(!p.authorized(false,"192.168.4.1",token.c_str(),true));
 p.reset();p.feed('G',UINT32_MAX-100);assert(p.expire(3000)==PortalRequest::Result::Timeout);
 uint8_t dns[512]={0x12,0x34,1,0,0,1,0,0,0,0,0,0,7,'e','x','a','m','p','l','e',3,'c','o','m',0,0,1,0,1};
 assert(captiveDnsReply(dns,29,sizeof(dns),0xc0a80401)==45);assert(dns[0]==0x12&&dns[1]==0x34&&dns[7]==1&&dns[41]==192&&dns[42]==168&&dns[43]==4&&dns[44]==1);
 uint8_t malformed[512]={0,1,1,0,0,1};malformed[12]=63;assert(!captiveDnsReply(malformed,20,sizeof(malformed),0xc0a80401));malformed[12]=0xc0;assert(!captiveDnsReply(malformed,20,sizeof(malformed),0xc0a80401));
 std::cout<<"Portal boundary passed\n";
}
