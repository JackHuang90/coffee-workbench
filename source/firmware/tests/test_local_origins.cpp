/** 功能：验证显式本机/内网HTTP来源从表单、持久记录到只读CORS的行为。
 * 首次编写日期：2026-10-30；变更日期：2026-10-30
 * 修改记录：2026-10-30：首次编写，防止公网HTTP、数值地址别名和跨域控制被放开。 */
#include "roast/provisioning.hpp"
#include "roast/portal.hpp"
#include "roast/http.hpp"
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
using namespace roast::net;
/** 功能：逐字节驱动实际HTTP状态解析器。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
static roast::HttpRequest::Result parse(roast::HttpRequest& request,const Config& config,const std::string& wire){
 auto result=roast::HttpRequest::Result::Pending;
 for(char c:wire)result=request.feed(c,1,"native-test-token-not-a-secret",&config);
 return result;
}
/** 功能：校验不同协议的主机、端口与URL规范化边界。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
static void normalization(){
 const char* accepted[][2]={
  {"http://localhost:5173/path?q=1#part","http://localhost:5173"},
  {"HTTP://LOCALHOST:80/path","http://localhost"},
  {"http://localhost:443","http://localhost:443"},
  {"http://127.0.0.1:3000/index.html","http://127.0.0.1:3000"},
  {"http://127.255.255.255:65535","http://127.255.255.255:65535"},
  {"http://10.0.0.1:80","http://10.0.0.1"},
  {"http://10.255.255.255:1","http://10.255.255.255:1"},
  {"http://172.16.0.1","http://172.16.0.1"},
  {"http://172.31.255.255:8080/","http://172.31.255.255:8080"},
  {"http://192.168.0.1:80/","http://192.168.0.1"},
  {"http://192.168.255.255:8080","http://192.168.255.255:8080"},
  {"HTTPS://Example.COM:443/path","https://example.com"},
  {"https://example.com:80/path","https://example.com:80"},
  {"https://8.8.8.8:443","https://8.8.8.8"},
  {"https://2026.example.com","https://2026.example.com"}
 };
 char out[256];for(const auto& row:accepted){assert(normalizeOrigin(row[0],out));assert(!std::strcmp(out,row[1]));}
 const char* rejected[]={
  "http://example.com","http://8.8.8.8","http://100.64.0.1","http://169.254.1.1",
  "http://126.255.255.255","http://128.0.0.1","http://172.15.255.255","http://172.32.0.1",
  "http://192.167.255.255","http://192.169.0.1","http://0.0.0.0","http://255.255.255.255",
  "http://app.localhost","http://localhost.","http://device.local","http://localhost.evil.test",
  "http://127.1","http://2130706433","http://0x7f000001","http://0x7f.0.0.1","http://127.000.0.1",
  "http://010.0.0.1","http://192.168.01.2","http://[::1]","http://%6cocalhost",
  "https://2130706433","https://127.1","https://0x7f000001","https://0x7f.0.0.1","https://127.000.0.1",
  "http://user@localhost","http://*.localhost","http://localhost:0","http://localhost:65536",
  "http://localhost:","http://localhost:-1","http://localhost:8x","http://localhost\\evil",
  "http://localhost/\r\nInjected:yes","http://local\thost","file:///localhost","null"
 };
 for(const char* value:rejected)assert(!normalizeOrigin(value,out));
}
/** 功能：验证表单规范化、持久化往返及无效重试保留原候选。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
static Config savedConfiguration(){
 Config c{};
 assert(parseForm("ssid=router&password=test-pass&mode=dhcp&origins=http%3A%2F%2FLOCALHOST%3A5173%2Fapp%0Ahttp%3A%2F%2F127.0.0.1%3A3000%0Ahttp%3A%2F%2F192.168.1.4%3A8080%0Ahttps%3A%2F%2Fprod.test%3A443%2Fpage",c)==Error::None);
 assert(c.originCount==4&&!std::strcmp(c.origins[0],"http://localhost:5173")&&!std::strcmp(c.origins[3],"https://prod.test"));
 assert(validate(c)==Error::None);
 const Record committed=makeRecord(c,9,true);unsigned char bytes[sizeof(Record)]{};std::memcpy(bytes,&committed,sizeof(bytes));
 Record restored{};std::memcpy(&restored,bytes,sizeof(restored));assert(recordValid(restored));
 assert(originAllowed(restored.config,"http://localhost:5173"));assert(originAllowed(restored.config,"http://192.168.1.4:8080"));assert(!originAllowed(restored.config,"http://localhost:5174"));
 assert(!originAllowed(Config{},"http://localhost:5173"));assert(!originAllowed(restored.config,"http://10.0.0.1"));
 assert(parseForm("ssid=changed&mode=dhcp&origins=http%3A%2F%2Fpublic.example",c)==Error::Origin);assert(!std::strcmp(c.ssid,"router"));assert(!std::strcmp(c.origins[0],"http://localhost:5173"));
 Config duplicate{};assert(parseForm("ssid=router&mode=dhcp&origins=http%3A%2F%2Flocalhost%0Ahttp%3A%2F%2FLOCALHOST%3A80%2Fpath",duplicate)==Error::Origin);
 return restored.config;
}
/** 功能：校验已保存HTTP来源的GET/OPTIONS和精确端口边界，拒绝控制与配网。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
static void readOnlyCors(const Config& config){
 using Request=roast::HttpRequest;using Result=Request::Result;
 Request request;
 for(const char* origin:{"http://localhost:5173","http://127.0.0.1:3000","http://192.168.1.4:8080","https://prod.test"}){
  request.reset();assert(parse(request,config,std::string("GET /api/v1/status HTTP/1.1\r\nOrigin: ")+origin+"\r\n\r\n")==Result::Complete);assert(!std::strcmp(request.corsOrigin(),origin));
  request.reset();assert(parse(request,config,std::string("OPTIONS /api/v1/status HTTP/1.1\r\nOrigin: ")+origin+"\r\nAccess-Control-Request-Method: GET\r\n\r\n")==Result::Complete);assert(request.preflight());
 }
 for(const char* origin:{"http://localhost","http://localhost:5174","http://127.0.0.2:3000","http://192.168.1.4:8081","https://localhost:5173","http://example.com"}){
  request.reset();assert(parse(request,config,std::string("GET /api/v1/status HTTP/1.1\r\nOrigin: ")+origin+"\r\n\r\n")==Result::Forbidden);
  request.reset();assert(parse(request,config,std::string("OPTIONS /api/v1/status HTTP/1.1\r\nOrigin: ")+origin+"\r\nAccess-Control-Request-Method: GET\r\n\r\n")==Result::Forbidden);
 }
 request.reset();assert(parse(request,config,"POST /api/v1/command HTTP/1.1\r\nOrigin: http://localhost:5173\r\nAuthorization: Bearer native-test-token-not-a-secret\r\nContent-Length: 5\r\n\r\nHELLO")==Result::Forbidden);
 request.reset();assert(parse(request,config,"OPTIONS /api/v1/status HTTP/1.1\r\nOrigin: http://localhost:5173\r\nAccess-Control-Request-Method: POST\r\n\r\n")==Result::Forbidden);
 PortalRequest portal;const std::string token(32,'a');const std::string setup="POST /setup/save HTTP/1.1\r\nHost: 192.168.4.1\r\nOrigin: http://localhost:5173\r\nX-Setup-Token: "+token+"\r\nContent-Length: 0\r\n\r\n";
 for(char c:setup)portal.feed(c,1);
 assert(!portal.authorized(true,"192.168.4.1",token.c_str(),true));
}
/** 功能：执行来源策略到真实解析器的集成回归。首次编写日期：2026-10-30；变更日期：2026-10-30；修改记录：2026-10-30：首次编写。 */
int main(){normalization();readOnlyCors(savedConfiguration());std::cout<<"Local HTTP origin policy passed\n";}
