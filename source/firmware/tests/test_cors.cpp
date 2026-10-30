/** 功能：验证真实HTTP解析器的精确来源与预检边界。
 * 首次编写日期：2026-10-29；变更日期：2026-10-29
 * 修改记录：2026-10-29：首次编写，防止来源许可泄漏到命令入口。 */
#include "roast/http.hpp"
#include "roast/provisioning.hpp"
#include <cassert>
#include <cstring>
#include <string>
#include <iostream>
/** 功能：执行有来源/无来源状态请求及拒绝跨域控制。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
int main(){
 using P=roast::HttpRequest;using R=P::Result;
 roast::net::Config config{};config.originCount=1;std::strcpy(config.origins[0],"https://coffee.example");
 const auto parse=[&](const std::string& s,P& p){R r=R::Pending;for(char c:s)r=p.feed(c,1,"not-a-real-secret-test-token",&config);return r;};
 P p;assert(parse("GET /api/v1/status HTTP/1.1\r\nOrigin: https://coffee.example\r\n\r\n",p)==R::Complete);assert(std::strcmp(p.corsOrigin(),"https://coffee.example")==0);
 p.reset();assert(parse("OPTIONS /api/v1/status HTTP/1.1\r\nOrigin: https://coffee.example\r\nAccess-Control-Request-Method: GET\r\nAccess-Control-Request-Private-Network: true\r\n\r\n",p)==R::Complete);assert(p.preflight()&&p.privateNetwork());
 for(const char* origin:{"null","https://coffee.example.evil","http://coffee.example","https://coffee.example:443"}){p.reset();assert(parse(std::string("GET /api/v1/status HTTP/1.1\r\nOrigin: ")+origin+"\r\n\r\n",p)==R::Forbidden);}
 p.reset();assert(parse("OPTIONS /api/v1/status HTTP/1.1\r\nOrigin: https://coffee.example\r\nAccess-Control-Request-Method: POST\r\n\r\n",p)==R::Forbidden);
 p.reset();assert(parse("OPTIONS /api/v1/status HTTP/1.1\r\nOrigin: https://coffee.example\r\nAccess-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: authorization\r\n\r\n",p)==R::Forbidden);
 p.reset();assert(parse("POST /api/v1/command HTTP/1.1\r\nOrigin: https://coffee.example\r\nAuthorization: Bearer not-a-real-secret-test-token\r\nContent-Length: 5\r\n\r\nHELLO",p)==R::Forbidden);
 p.reset();assert(parse("GET /api/v1/status HTTP/1.1\r\nOrigin: https://coffee.example\r\nOrigin: https://coffee.example\r\n\r\n",p)==R::BadRequest);
 p.reset();assert(parse("GET /api/v1/status HTTP/1.1\r\nHost: local\r\n\r\n",p)==R::Complete);assert(!p.corsOrigin()[0]);
 std::cout<<"CORS boundary passed\n";
}
